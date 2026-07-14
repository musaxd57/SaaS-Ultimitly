import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { sendMessage } from "@/lib/hospitable";
import {
  attemptsExhausted,
  backoffMs,
  classifySendResult,
  type OutboxStatus,
} from "./state";

// ---------------------------------------------------------------------------
// Durable Outbox — worker (#8).
//
// Drains the outbox: atomically CLAIMS due rows (PostgreSQL FOR UPDATE SKIP
// LOCKED, so two replicas never claim the same row), sends EXACTLY ONE provider
// POST per attempt, and transitions the row through the state machine. Guarantees:
//   • no lost intent (the row is durable);
//   • a definitive failure retries with bounded backoff, then terminal `failed`;
//   • an AMBIGUOUS result is NEVER blind-resent — it is reconciled against the
//     provider's own thread history (read-only); if not confidently found, it is
//     parked for manual `review` (never re-POSTed);
//   • completion is guarded by (claimedBy = our token AND expected status), so a
//     worker can never complete/clobber a row another worker recovered;
//   • one poison row can't abort the batch; a claim-query failure fails CLOSED.
//
// Deterministic + injectable: `send`, `reconcile`, `tokenFor`, `now`, `batchSize`
// are all overridable so the crash-point / concurrency tests need no wall-clock
// sleep and no real network.
// ---------------------------------------------------------------------------

const CLAIM_TTL_MS = 5 * 60_000; // a single attempt must finish within this window
const DEFAULT_BATCH = 20;

// A single Postgres advisory-lock key that SERIALIZES the whole claim phase across every
// worker / replica (Codex P1). FOR UPDATE SKIP LOCKED locks disjoint ROWS, so two separate
// transactions can each pass a reservation's `rn + recent <= 2` cap without seeing the
// other's UNCOMMITTED claimedAt (snapshot isolation) → up to 4 sends slip through. Holding a
// shared advisory xact-lock around the claim forces the rate count to read a STABLE committed
// state, so the 2/min/reservation guarantee is atomic even under real multi-connection races.
// The lock is held ONLY for the fast claim UPDATE (released at commit); the slow SEND phase
// runs afterwards, unlocked, so throughput is unaffected. Non-blocking (pg_try_*): a worker
// that can't get the lock simply does nothing this pass and retries next tick.
export const OUTBOX_CLAIM_LOCK_KEY = 185_083_927; // 0x0B0C5E17 — stable, arbitrary

/** The subset of the row the worker needs (raw-claimed). */
export interface OutboxRow {
  id: string;
  organizationId: string;
  conversationId: string | null; // null for a proactive lifecycle send (no thread)
  messageId: string | null;
  reservationId: string | null;
  channel: string;
  externalReservationId: string | null;
  messageType: string | null; // manual | ai | holding_ack | welcome | checkin | checkout | null
  body: string;
  status: string;
  attemptCount: number;
}

export interface OutboxSendOutcome {
  ok: boolean;
  error?: string | null;
  providerMessageId?: string | null;
  /** On a 429, the provider's Retry-After converted to ms — the worker defers to it. */
  retryAfterMs?: number | null;
}

export type OutboxSendFn = (row: OutboxRow, token: string | undefined) => Promise<OutboxSendOutcome>;
export type OutboxReconcileFn = (
  row: OutboxRow,
  token: string | undefined,
) => Promise<{ found: boolean; providerMessageId?: string | null }>;

export interface DrainDeps {
  now?: () => Date;
  batchSize?: number;
  /** Send exactly one provider attempt. Default = single-shot Hospitable send. */
  send?: OutboxSendFn;
  /** Best-effort reconcile of an ambiguous row against provider history. */
  reconcile?: OutboxReconcileFn;
  /** Resolve an org's Hospitable token. Default = getOrgHospitableToken. */
  tokenFor?: (organizationId: string) => Promise<string | undefined>;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  ambiguous: number;
  reconciled: number;
  review: number;
  retried: number;
  canceled: number;
  rateLimited: number;
  blocked: number;
}

// Default single-attempt send (retries: 0 → exactly one POST). An internal thread
// (no externalReservationId) has nothing to deliver → treated as a delivered no-op.
const defaultSend: OutboxSendFn = async (row, token) => {
  if (!row.externalReservationId) return { ok: true, providerMessageId: null };
  const r = await sendMessage(row.externalReservationId, row.body, token, { retries: 0 });
  return {
    ok: r.ok,
    error: r.error,
    providerMessageId: r.id ?? null,
    // A 429 carries the provider's Retry-After (seconds) → defer to its window (Codex P1).
    retryAfterMs: r.retryAfterSec != null ? r.retryAfterSec * 1000 : null,
  };
};

// PRODUCTION reconcile — deliberately CONSERVATIVE (Codex #4). Hospitable exposes NO
// idempotency key, and an ambiguous send never captured a providerMessageId (the HTTP
// response was lost), so there is NO reliable way to confirm delivery from the
// provider's history: a matching body could be a DIFFERENT message, or a genuine
// duplicate. We therefore do NOT auto-mark "sent" on body+time similarity — the row
// stays ambiguous and, once attempts are exhausted, is parked for MANUAL review.
// Internal (no external destination) rows are trivially delivered. This is injectable
// so a FUTURE reliable signal (a provider idempotency key, or a providerMessageId we
// actually captured) can confirm delivery here without changing the state machine.
const defaultReconcile: OutboxReconcileFn = async (row) => {
  if (!row.externalReservationId) return { found: true };
  return { found: false }; // no reliable provider match → do NOT auto-confirm; → review
};

/**
 * Are there any non-terminal outbox rows that still need work? Cheap indexed check.
 * The WORKER must drain the queue even when the enqueue flag is OFF — otherwise an
 * emergency rollback (flag flipped off) would strand already-queued messages forever.
 * So the scheduler drains when the flag is ON *or* when this returns true.
 */
export async function hasDrainableOutbox(): Promise<boolean> {
  const n = await prisma.messageOutbox.count({
    where: { status: { in: ["pending", "sending", "ambiguous", "reconciling"] } },
  });
  return n > 0;
}

/**
 * Recover stale claims: a row stuck in `sending`/`reconciling` whose claim window
 * lapsed (the worker crashed mid-attempt) is moved to `ambiguous` — we DON'T know
 * if the send landed, so it must be reconciled, never blind-resent. Returns the
 * number recovered.
 */
async function recoverStaleClaims(now: Date): Promise<number> {
  const res = await prisma.messageOutbox.updateMany({
    where: {
      status: { in: ["sending", "reconciling"] },
      claimExpiresAt: { not: null, lte: now },
    },
    data: {
      status: "ambiguous",
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorKind: "ambiguous",
      lastErrorCode: "claim_expired",
      availableAt: now,
    },
  });
  return res.count;
}

/**
 * Atomically claim up to `batchSize` DUE rows for this worker token. The whole claim runs
 * inside a transaction that first takes a shared advisory lock (OUTBOX_CLAIM_LOCK_KEY) so the
 * per-reservation rate cap is computed against a stable committed state — see the key's note.
 * If another worker holds the lock we return [] (this pass is a no-op; retry next tick). Uses
 * FOR UPDATE SKIP LOCKED so concurrent workers/replicas each get a DISJOINT set — a row is
 * claimed by at most one worker. `pending` → `sending`; `ambiguous` → `reconciling`.
 * attemptCount is incremented on every claim. Fair order by availableAt (oldest first).
 */
async function claimBatch(token: string, now: Date, expiry: Date, batchSize: number): Promise<OutboxRow[]> {
  return prisma.$transaction(async (tx) => {
    // Serialize the claim phase (Codex P1). Non-blocking: if a concurrent worker holds it,
    // do nothing this pass — the rate count must never race another in-flight claim.
    const gate = await tx.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${OUTBOX_CLAIM_LOCK_KEY}::bigint) AS locked`,
    );
    if (!gate[0]?.locked) return [];
    return claimBatchLocked(tx, token, now, expiry, batchSize);
  });
}

/**
 * The claim UPDATE itself — MUST run only while the caller holds OUTBOX_CLAIM_LOCK_KEY.
 */
async function claimBatchLocked(
  tx: Prisma.TransactionClient,
  token: string,
  now: Date,
  expiry: Date,
  batchSize: number,
): Promise<OutboxRow[]> {
  // The DUE / claim-expiry / rate-window comparisons all use the worker's own `now`
  // (injected in tests), so the backoff clock and the claim clock never diverge.
  //
  // Layers (inside-out):
  //   locked  — candidate rows, atomically LOCKED (FOR UPDATE SKIP LOCKED) so two
  //             replicas get disjoint sets. Guards: due, not-claimed, and per-conversation
  //             FIFO + single-in-flight (Codex #2 — never claim a row while the SAME
  //             conversation has an earlier queued row or an in-flight one).
  //   ranked  — adds, per externalReservationId: `rn` (rank of this row among the batch's
  //             candidates for that reservation) and `recent` (how many provider ATTEMPTS
  //             that reservation already made in the last 60s, counted by claimedAt — which
  //             every claim stamps and settle never clears). window functions can't sit
  //             under FOR UPDATE, hence the separate layer.
  //   filter  — HOSPITABLE 2/min/RESERVATION (Codex P1): a SEND claim is allowed only when
  //             `rn + recent <= 2`, i.e. prior-window attempts + this row's rank stay within
  //             two. So at most two provider calls per reservation per 60s; a 3rd ready row
  //             is left for the next window. Atomic under multi-replica via the shared claim
  //             lock (above) + committed claimedAt reads. Reconcile claims (ambiguous rows)
  //             never POST, so they bypass the send cap.
  const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
    UPDATE "MessageOutbox" AS o
    SET "status" = CASE WHEN o."status" = 'pending' THEN 'sending' ELSE 'reconciling' END,
        "attemptCount" = o."attemptCount" + 1,
        "claimedBy" = ${token},
        "claimedAt" = ${now},
        "claimExpiresAt" = ${expiry},
        "updatedAt" = now()
    WHERE o."id" IN (
      SELECT ranked."id" FROM (
        SELECT locked."id", locked."status", locked."externalReservationId",
               locked."availableAt", locked."createdAt",
               ROW_NUMBER() OVER (
                 PARTITION BY locked."organizationId", locked."externalReservationId"
                 ORDER BY locked."availableAt" ASC, locked."createdAt" ASC, locked."id" ASC
               ) AS rn,
               (
                 -- Prior provider ATTEMPTS for this same (org, reservation) in the last 60s.
                 -- claimedAt is stamped on every claim and never cleared by settle, so it is
                 -- the true "last attempt" clock. (org-scoped: a Hospitable reservation UUID is
                 -- globally unique in prod, but scoping to the org is stricter and cheaper.)
                 SELECT count(*) FROM "MessageOutbox" h
                 WHERE h."organizationId" = locked."organizationId"
                   AND h."externalReservationId" = locked."externalReservationId"
                   AND h."externalReservationId" IS NOT NULL
                   AND h."id" <> locked."id"
                   AND h."claimedAt" IS NOT NULL
                   AND h."claimedAt" > ${now}::timestamptz - interval '60 seconds'
               ) AS recent
        FROM (
          SELECT s."id", s."status", s."organizationId", s."externalReservationId", s."availableAt", s."createdAt"
          FROM "MessageOutbox" s
          WHERE s."status" IN ('pending', 'ambiguous')
            AND s."availableAt" <= ${now}
            AND (s."claimExpiresAt" IS NULL OR s."claimExpiresAt" <= ${now})
            AND NOT EXISTS (
              SELECT 1 FROM "MessageOutbox" e
              WHERE e."conversationId" = s."conversationId"
                AND e."id" <> s."id"
                AND e."status" IN ('pending', 'sending', 'ambiguous', 'reconciling')
                AND (
                  e."status" IN ('sending', 'reconciling')
                  OR (e."createdAt", e."id") < (s."createdAt", s."id")
                )
            )
          ORDER BY s."availableAt" ASC, s."createdAt" ASC
          FOR UPDATE SKIP LOCKED
        ) locked
      ) ranked
      WHERE ranked."status" = 'ambiguous'                        -- reconcile claim: no POST → no send cap
         OR ranked."externalReservationId" IS NULL               -- internal thread: nothing rate-limited
         OR (ranked."rn" + ranked."recent") <= 2                 -- ≤ 2 provider sends / reservation / 60s
      ORDER BY ranked."availableAt" ASC, ranked."createdAt" ASC
      LIMIT ${batchSize}
    )
    RETURNING o."id", o."organizationId", o."conversationId", o."messageId",
              o."reservationId", o."channel", o."externalReservationId", o."messageType",
              o."body", o."status", o."attemptCount"
  `);
  return rows;
}

/** Complete a row under an EXACT claim guard so a worker can only settle a row it
 *  still holds (and that is still in the expected in-flight status). Returns true
 *  when THIS worker's guarded update landed. Also heals Message.externalId on send. */
async function settle(
  row: OutboxRow,
  token: string,
  fromStatus: OutboxStatus,
  data: Prisma.MessageOutboxUpdateManyMutationInput,
  providerMessageId?: string | null,
): Promise<boolean> {
  // The guarded outbox update is the SOURCE OF TRUTH for delivery state, and must NOT be
  // coupled to the Message.externalId link. Linking is only a convenience for the sync's
  // dedup (adopt-and-heal covers a miss), so its failure — e.g. a P2002 on the
  // (conversationId, externalId) unique when a concurrent sync already linked the same
  // provider id — must NEVER roll back the "sent" transition, or the row would be
  // re-claimed and RE-SENT (a duplicate). So: settle the row first, then best-effort link.
  const upd = await prisma.messageOutbox.updateMany({
    where: { id: row.id, claimedBy: token, status: fromStatus },
    data,
  });
  if (upd.count === 1 && providerMessageId && row.messageId) {
    await prisma.message
      .updateMany({ where: { id: row.messageId, externalId: null }, data: { externalId: providerMessageId } })
      .catch(() => {});
  }
  return upd.count === 1;
}

/**
 * Provider CONFIRMED delivery → the conversation is "answered" NOW (Codex #6), never at
 * enqueue. A queued-but-undelivered reply therefore never looks delivered. Never
 * overrides a closed thread. Best-effort — the delivery truth lives on the outbox row.
 */
async function markConversationDelivered(conversationId: string, now: Date): Promise<void> {
  await prisma.conversation
    .updateMany({ where: { id: conversationId, status: { not: "closed" } }, data: { status: "answered", lastMessageAt: now } })
    .catch(() => {});
}

/**
 * SEND-TIME VETO for an AI auto-reply (Codex P2). Between enqueue and this POST the
 * world may have moved on — the host answered manually, the AI was paused / handed to a
 * human, the thread was escalated, or a newer message arrived. In any of those cases the
 * queued AI reply is STALE and must NOT be delivered: the enqueue-time safety gate is not
 * enough on its own. Only AI rows are vetoed (a manual host reply the host explicitly
 * wrote always goes). Returns a short reason code when the send must be canceled, else null.
 */
async function aiSendVeto(row: OutboxRow, now: Date): Promise<string | null> {
  if (!row.messageId || !row.conversationId) return null; // no message/thread → not a tracked AI reply
  const msg = await prisma.message.findUnique({
    where: { id: row.messageId },
    select: { authorType: true, createdAt: true },
  });
  if (!msg || msg.authorType !== "ai") return null; // manual/host send → never vetoed
  const convo = await prisma.conversation.findUnique({
    where: { id: row.conversationId },
    select: { status: true, autoReplyHoldUntil: true },
  });
  if (!convo) return "conversation_gone";
  if (convo.status === "problem" || convo.status === "closed") return "escalated_or_closed";
  if (convo.autoReplyHoldUntil && convo.autoReplyHoldUntil > now) return "ai_paused";
  // A newer message (a host's manual reply, or a newer guest message) means this AI reply
  // is no longer the current turn — the thread moved on, so the stale draft must not go.
  const newer = await prisma.message.count({
    where: { conversationId: row.conversationId, id: { not: row.messageId }, createdAt: { gt: msg.createdAt } },
  });
  if (newer > 0) return "superseded_by_newer_message";
  return null;
}

/**
 * SEND-TIME VETO for a PROACTIVE lifecycle send (welcome/checkin/checkout). Between enqueue and
 * this POST the booking may have changed: cancelled/completed, the message window passed, or the
 * same lifecycle message was already delivered (its *SentAt got stamped by an earlier attempt).
 * In any of those, no provider call is made → the row is canceled/superseded.
 */
async function lifecycleVeto(row: OutboxRow, now: Date): Promise<string | null> {
  if (!row.externalReservationId) return "no_destination";
  const res = await prisma.reservation.findFirst({
    where: { sourceReference: row.externalReservationId, property: { organizationId: row.organizationId } },
    select: { status: true, departureDate: true, welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true },
  });
  if (!res) return "reservation_gone";
  if (res.status === "cancelled") return "reservation_cancelled";
  // A completed stay is stale for welcome/check-in, but a CHECK-OUT is legitimately due the
  // evening before departure (status may already have flipped) — its `window_passed` date guard
  // below handles a truly-past departure. This keeps the flag-ON veto consistent with the
  // flag-OFF checkout query (which includes `completed`) so the two paths never disagree.
  const type = row.messageType;
  if ((type === "welcome" || type === "checkin") && res.status === "completed") return "reservation_completed";
  // Already delivered (stamp set by a prior/concurrent delivery) → never double-send.
  if (type === "welcome" && res.welcomeSentAt) return "already_sent";
  if (type === "checkin" && res.checkinSentAt) return "already_sent";
  if (type === "checkout" && res.checkoutSentAt) return "already_sent";
  // Window passed: a check-in / check-out whose stay is already over is stale.
  if ((type === "checkin" || type === "checkout") && res.departureDate < now) return "window_passed";
  return null;
}

/**
 * Dispatch the correct send-time veto by messageType: lifecycle rows use the reservation-state
 * veto; holding acknowledgements are best-effort and never vetoed; everything else (manual / ai /
 * legacy NULL) goes through the AI veto, which self-filters (a manual host reply is never vetoed).
 */
async function sendTimeVeto(row: OutboxRow, now: Date): Promise<string | null> {
  const type = row.messageType;
  if (type === "welcome" || type === "checkin" || type === "checkout") return lifecycleVeto(row, now);
  if (type === "holding_ack") return null; // soft ack — deliver, keep the thread in "problem"
  return aiSendVeto(row, now);
}

/**
 * Stamp a lifecycle reservation's *SentAt (welcome/checkin/checkout) — the CONFIRMED-DELIVERY
 * marker. Called ONLY on a provider success (or a reliable reconciliation), NEVER for an
 * ambiguous/review row (that would be a false "sent" on unverified data). The flag-OFF sender's
 * rollback dedupe is handled separately by fencing on the outbox row, not by this stamp. Stamps
 * across ALL rows of the booking (dup rows share sourceReference), only where still unstamped.
 */
async function stampLifecycleSent(row: OutboxRow, now: Date): Promise<void> {
  const type = row.messageType;
  const ext = row.externalReservationId;
  if (!ext) return;
  const scope = { sourceReference: ext, property: { organizationId: row.organizationId } };
  // Separate calls (not a ternary) so Prisma's per-model input type is inferred cleanly.
  if (type === "welcome") {
    await prisma.reservation.updateMany({ where: { ...scope, welcomeSentAt: null }, data: { welcomeSentAt: now } }).catch(() => {});
  } else if (type === "checkin") {
    await prisma.reservation.updateMany({ where: { ...scope, checkinSentAt: null }, data: { checkinSentAt: now } }).catch(() => {});
  } else if (type === "checkout") {
    await prisma.reservation.updateMany({ where: { ...scope, checkoutSentAt: null }, data: { checkoutSentAt: now } }).catch(() => {});
  }
}

/**
 * Apply the DELIVERY EFFECT for a confirmed send, derived from messageType (migration 30):
 *   welcome/checkin/checkout → stamp the reservation's *SentAt NOW (never at enqueue);
 *   holding_ack             → nothing (the thread stays in "problem" for the host);
 *   manual/ai/legacy NULL    → mark the conversation "answered" (#6).
 */
async function applyDeliveryEffect(row: OutboxRow, now: Date): Promise<void> {
  const type = row.messageType;
  if (type === "welcome" || type === "checkin" || type === "checkout") {
    await stampLifecycleSent(row, now);
    return;
  }
  if (type === "holding_ack") return; // keep the thread in "problem" — never mark answered
  if (row.conversationId) await markConversationDelivered(row.conversationId, now);
}

/**
 * Emit a SECRET-FREE operational breadcrumb for a stuck outbox row: tenant + outbox id +
 * messageType + state ONLY — never the body or any guest data. Best-effort; never throws. Fires
 * at most once per row transition (each state below is entered under a claim guard, and `blocked`
 * rows are never re-claimed) → never a per-pass storm.
 *   • review / failed: ONLY for lifecycle rows (welcome/checkin/checkout), which have no thread and
 *     so surface in no host panel; a manual/AI review/failed already shows a per-thread badge.
 *   • blocked: for ANY row type — a Hospitable 402 "subscription not active" is an ORG-WIDE
 *     integration-paused condition worth a one-time ops breadcrumb (the reactivation is silent).
 */
async function signalOutboxStuck(row: OutboxRow, state: "review" | "failed" | "blocked"): Promise<void> {
  const t = row.messageType;
  const isLifecycle = t === "welcome" || t === "checkin" || t === "checkout";
  if (state !== "blocked" && !isLifecycle) return;
  const key = state === "blocked" ? "outbox-blocked" : `outbox-lifecycle-${state}`;
  await reportError(
    key,
    new Error(`stuck outbox send: org=${row.organizationId} outbox=${row.id} type=${t ?? "reply"} state=${state}`),
  ).catch(() => {});
}

/**
 * Reactivate an org's `blocked` (Hospitable 402 "subscription not active") outbox rows: move them
 * atomically back to `pending` so the next drain tries each ONCE. Called after a SUCCESSFUL
 * Hospitable sync (scheduled-sync.ts) — a sync only succeeds when the subscription is active again —
 * and usable as a tenant-bound manual retry. Resets attemptCount/backoff/claim so the retry is
 * clean. `updateMany` is atomic + idempotent: if nothing is blocked (or a row already moved on),
 * it is a no-op. Tenant-scoped by `organizationId` so one org can never reactivate another's rows.
 * Returns the number reactivated.
 */
export async function reactivateBlockedOutbox(organizationId: string, now: Date = new Date()): Promise<number> {
  const res = await prisma.messageOutbox.updateMany({
    where: { organizationId, status: "blocked" },
    data: {
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
    },
  });
  return res.count;
}

/**
 * Cancel a vetoed AI send: move the row to the terminal `canceled` state (NEVER sent/failed)
 * under the claim guard. The draft Message is NOT deleted (no data loss — a persistent policy):
 * the outbox row's `canceled` status is the RELIABLE metadata that marks the message as
 * "never delivered". Because every guest/host view derives visibility from that single status
 * (thread + auto-reply "last message" both skip a message whose outbox row is canceled), the
 * cancellation and the invisibility are ATOMIC — the instant this guarded update lands, the
 * draft is filtered everywhere, yet stays queryable for export/audit as "not delivered".
 */
async function cancelRow(row: OutboxRow, token: string, reason: string): Promise<boolean> {
  return settle(row, token, "sending", {
    status: "canceled",
    lastErrorKind: "canceled",
    lastErrorCode: reason,
    claimedBy: null,
    claimExpiresAt: null,
  });
}

/** Short, secret-free error code from a provider error string (no raw body / tokens). */
function errorCode(error: string | null | undefined): string {
  const s = error ?? "";
  const http = s.match(/HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;
  if (/abort|timeout|ulaşılamadı|ECONN|network/i.test(s)) return "network_or_timeout";
  return "unknown";
}

async function processOne(row: OutboxRow, token: string, deps: Required<Pick<DrainDeps, "now" | "send" | "reconcile" | "tokenFor">>, acc: DrainResult): Promise<void> {
  const now = deps.now();
  const providerToken = await deps.tokenFor(row.organizationId);

  if (row.status === "reconciling") {
    const { found, providerMessageId } = await deps.reconcile(row, providerToken);
    if (found) {
      const done = await settle(row, token, "reconciling", { status: "sent", providerMessageId: providerMessageId ?? null, reconciledAt: now, sentAt: now, claimedBy: null, claimExpiresAt: null }, providerMessageId);
      if (done) await applyDeliveryEffect(row, now);
      acc.reconciled++;
      return;
    }
    if (attemptsExhausted(row.attemptCount)) {
      const done = await settle(row, token, "reconciling", { status: "review", claimedBy: null, claimExpiresAt: null });
      // AMBIGUOUS → parked for review; *SentAt is NOT stamped (unverified — never a false "sent").
      // The flag-OFF sender won't re-send it because it fences on this outbox row (see automation.ts).
      if (done) await signalOutboxStuck(row, "review");
      acc.review++;
      return;
    }
    await settle(row, token, "reconciling", { status: "ambiguous", availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)), claimedBy: null, claimExpiresAt: null });
    acc.ambiguous++;
    return;
  }

  // status === "sending": one send attempt.
  // SEND-TIME VETO (Codex P2 + FAZ 1): re-check the live state just before the POST. A stale
  // reply (host took over / AI paused / escalated / superseded) OR a lifecycle send whose
  // booking is cancelled/completed/already-sent/out-of-window is canceled — NEVER POSTed, and
  // never shown as sent or failed.
  const veto = await sendTimeVeto(row, now);
  if (veto) {
    await cancelRow(row, token, veto);
    acc.canceled++;
    return;
  }

  const outcome = await deps.send(row, providerToken);
  const kind = classifySendResult(outcome);
  if (kind === "rate_limited") {
    // 429 — nothing was delivered. Defer to the provider's Retry-After (or a bounded
    // backoff) WITHOUT consuming a terminal attempt, so a rate-limit storm can never
    // push a real message to `failed`. The claim already incremented attemptCount → undo it.
    const waitMs =
      outcome.retryAfterMs && outcome.retryAfterMs > 0 ? outcome.retryAfterMs : backoffMs(row.attemptCount, row.id);
    await settle(row, token, "sending", {
      status: "pending",
      availableAt: new Date(now.getTime() + waitMs),
      attemptCount: { decrement: 1 },
      lastErrorKind: "rate_limited",
      lastErrorCode: "HTTP 429",
      claimedBy: null,
      claimExpiresAt: null,
    });
    acc.rateLimited++;
    return;
  }
  if (kind === "blocked") {
    // HTTP 402 "subscription not active" — a PERSISTENT integration-paused state, NOT a transient
    // outage (Nuve's live account is in exactly this state). Park in terminal-until-reactivated
    // `blocked`: it is never re-claimed (so NO provider call and NO signal on later passes) and it
    // does NOT consume a terminal attempt (undo the claim's increment), so reconnecting the
    // subscription can retry it cleanly ONCE via reactivateBlockedOutbox. Nothing was delivered.
    // A secret-free ops breadcrumb fires exactly once — here, on this first (and only) transition.
    const done = await settle(row, token, "sending", {
      status: "blocked",
      attemptCount: { decrement: 1 },
      lastErrorKind: "blocked",
      lastErrorCode: "HTTP 402",
      claimedBy: null,
      claimExpiresAt: null,
    });
    if (done) await signalOutboxStuck(row, "blocked");
    acc.blocked++;
    return;
  }
  if (kind === "definitive_success") {
    const done = await settle(row, token, "sending", { status: "sent", providerMessageId: outcome.providerMessageId ?? null, sentAt: now, lastErrorKind: null, lastErrorCode: null, claimedBy: null, claimExpiresAt: null }, outcome.providerMessageId);
    if (done) await applyDeliveryEffect(row, now); // stamp lifecycle / mark answered ONLY on confirmed delivery (#6)
    acc.sent++;
    return;
  }
  if (kind === "definitive_failure") {
    if (attemptsExhausted(row.attemptCount)) {
      const done = await settle(row, token, "sending", { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: errorCode(outcome.error), claimedBy: null, claimExpiresAt: null });
      if (done) await signalOutboxStuck(row, "failed");
      acc.failed++;
    } else {
      await settle(row, token, "sending", { status: "pending", availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)), lastErrorKind: "definitive_failure", lastErrorCode: errorCode(outcome.error), claimedBy: null, claimExpiresAt: null });
      acc.retried++;
    }
    return;
  }
  // ambiguous: NEVER blind-resend → hold as ambiguous and reconcile on a later pass.
  await settle(row, token, "sending", { status: "ambiguous", availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)), lastErrorKind: "ambiguous", lastErrorCode: errorCode(outcome.error), claimedBy: null, claimExpiresAt: null });
  acc.ambiguous++;
}

/**
 * Drain one batch. Fail-CLOSED: if the CLAIM itself errors we abort (never proceed
 * blind). A single row that throws is isolated (reported) so it can't poison the
 * batch — its claim simply expires and is recovered on a later pass.
 */
export async function drainOutboxOnce(deps: DrainDeps = {}): Promise<DrainResult> {
  const now = deps.now ?? (() => new Date());
  const resolved = {
    now,
    send: deps.send ?? defaultSend,
    reconcile: deps.reconcile ?? defaultReconcile,
    tokenFor: deps.tokenFor ?? ((orgId: string) => getOrgHospitableToken(orgId).then((t) => t ?? undefined)),
  };
  const acc: DrainResult = { claimed: 0, sent: 0, failed: 0, ambiguous: 0, reconciled: 0, review: 0, retried: 0, canceled: 0, rateLimited: 0, blocked: 0 };
  const token = randomUUID();
  const nowDate = now();
  const expiry = new Date(nowDate.getTime() + CLAIM_TTL_MS);

  // Recover crashed-mid-attempt rows first (stale claim → ambiguous). Best-effort.
  try {
    await recoverStaleClaims(nowDate);
  } catch (err) {
    await reportError("outbox-recover", err);
  }

  let rows: OutboxRow[];
  try {
    rows = await claimBatch(token, nowDate, expiry, deps.batchSize ?? DEFAULT_BATCH);
  } catch (err) {
    // Fail CLOSED: with the claim query down we can't safely proceed.
    await reportError("outbox-claim", err);
    return acc;
  }
  acc.claimed = rows.length;

  for (const row of rows) {
    try {
      await processOne(row, token, resolved, acc);
    } catch (err) {
      // Poison isolation: this row's claim will expire and be recovered later; the
      // rest of the batch continues.
      await reportError(`outbox-row ${row.id}`, err);
    }
  }
  return acc;
}
