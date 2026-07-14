import "server-only";

// ---------------------------------------------------------------------------
// Durable Outbox — state machine (#8).
//
// A persistent, DB-backed state machine for messages we send OUT to the guest's
// channel (Hospitable → Airbnb / Booking / ...). It replaces the "claim-then-send"
// guard (which is a dedup lock, NOT durable) with a row whose lifecycle survives a
// process crash, a timeout, and multiple replicas.
//
// HONEST GUARANTEE (Hospitable exposes NO idempotency key for message sends — our
// client sends none and their docs document only rate limits): this is NOT
// "exactly once". It is:
//   • the send INTENT is never lost (written durably in the same txn as the message);
//   • a DEFINITIVE failure (provider REJECTED, 4xx≠408) can be retried safely;
//   • an AMBIGUOUS failure (timeout / connection reset / 5xx — no confirmed result)
//     is NEVER blindly re-sent; it is reconciled against the provider's own message
//     history when possible, else parked for manual review;
//   • a tenant-scoped idempotencyKey + a DB unique constraint stop double-enqueue and
//     double-send of the SAME logical message.
// The residual duplicate window (provider accepted the send but the HTTP response was
// lost, AND reconciliation can't see it yet) is documented, not hidden — it cannot be
// closed without a provider idempotency key.
//
// The status set is CLOSED and every transition goes through `assertTransition`, so
// no free-string drift creeps in.
// ---------------------------------------------------------------------------

/** Closed set of outbox statuses. */
export const OUTBOX_STATUSES = [
  "pending", // enqueued, not yet attempted (or backing off before the next attempt)
  "sending", // a worker has CLAIMED this row and is mid-attempt
  "sent", // provider confirmed delivery (has a providerMessageId, or reconciled to one)
  "failed", // terminal: definitively not delivered, no more automatic attempts
  "ambiguous", // an attempt returned an UNKNOWN result — do NOT resend blindly
  "reconciling", // a worker has claimed an ambiguous row to check the provider's history
  "review", // terminal-until-human: ambiguous and not reconcilable → needs manual review
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Statuses a worker may CLAIM (transition into "sending"/"reconciling"). */
export const CLAIMABLE_STATUSES: readonly OutboxStatus[] = ["pending", "ambiguous"];

/** Terminal statuses — the worker never touches these again automatically. */
export const TERMINAL_STATUSES: readonly OutboxStatus[] = ["sent", "failed", "review"];

// The allowed transitions. Anything not listed here is a bug and throws.
//   pending      → sending      (worker claims a due row)
//   sending      → sent         (definitive success)
//   sending      → pending      (definitive failure that is safe to retry → back off)
//   sending      → failed       (definitive failure, terminal: max attempts / unconfigured)
//   sending      → ambiguous    (unknown result — no blind resend)
//   ambiguous    → reconciling  (worker claims it to check provider history)
//   reconciling  → sent         (found in provider history → it DID deliver)
//   reconciling  → ambiguous    (still unknown → back off and try reconcile later)
//   reconciling  → review       (giving up on auto-reconcile → human decides)
//   review       → pending      (a human explicitly requeues it)
const ALLOWED: Record<OutboxStatus, readonly OutboxStatus[]> = {
  pending: ["sending"],
  sending: ["sent", "pending", "failed", "ambiguous"],
  sent: [],
  failed: [],
  ambiguous: ["reconciling"],
  reconciling: ["sent", "ambiguous", "review"],
  review: ["pending"],
};

export function isOutboxStatus(v: unknown): v is OutboxStatus {
  return typeof v === "string" && (OUTBOX_STATUSES as readonly string[]).includes(v);
}

export function isTerminal(status: OutboxStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OutboxStatus, to: OutboxStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Throw on an illegal transition — the single gate every state change flows through. */
export function assertTransition(from: OutboxStatus, to: OutboxStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`outbox: illegal transition ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Send-result classification. The worker maps a provider send outcome onto one
// of three kinds; the state transition is derived from the kind (never from a
// free-form string in the calling code).
// ---------------------------------------------------------------------------

export type SendResultKind = "definitive_success" | "definitive_failure" | "ambiguous";

/**
 * Classify a provider send outcome. Mirrors the manual-reply route's existing
 * rule so behaviour is consistent: a 4xx (except 408 request-timeout) is a
 * DEFINITIVE rejection (nothing delivered → safe to retry); a timeout / network
 * reset / 5xx is AMBIGUOUS (it MAY have delivered → never blind-resend).
 * `ok:true` is a definitive success.
 */
export function classifySendResult(outcome: {
  ok: boolean;
  error?: string | null;
}): SendResultKind {
  if (outcome.ok) return "definitive_success";
  const err = outcome.error ?? "";
  const m = err.match(/HTTP (\d{3})/);
  if (m) {
    const status = Number(m[1]);
    if (status >= 400 && status < 500 && status !== 408) return "definitive_failure";
    return "ambiguous"; // 5xx / 408 → may have applied
  }
  // No HTTP status → network error / AbortSignal timeout / unknown → ambiguous.
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// Bounded exponential backoff with jitter. No infinite fast retry; a bounded
// number of attempts, then a terminal state. Deterministic given (attempt, seed)
// so tests never depend on wall-clock sleep.
// ---------------------------------------------------------------------------

export const OUTBOX_MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 30_000; // 30s, doubling
const BACKOFF_CAP_MS = 30 * 60_000; // 30 min ceiling

/**
 * Delay before the next attempt for a row that has already been attempted
 * `attemptCount` times. Bounded exponential (30s·2^n capped at 30m) plus up to
 * ±20% deterministic jitter derived from `seed` (no Math.random → resume-safe and
 * test-deterministic; pass the row id as the seed so rows spread out).
 */
export function backoffMs(attemptCount: number, seed: string): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
  // Cheap deterministic hash of the seed → [0,1) → jitter factor in [0.8, 1.2).
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const jitter = 0.8 + (h % 400) / 1000; // 0.800 .. 1.199
  return Math.round(exp * jitter);
}

/** True when `attemptCount` has hit the ceiling → the next definitive failure is terminal. */
export function attemptsExhausted(attemptCount: number): boolean {
  return attemptCount >= OUTBOX_MAX_ATTEMPTS;
}
