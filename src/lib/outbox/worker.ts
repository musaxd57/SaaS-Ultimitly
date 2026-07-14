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

/** The subset of the row the worker needs (raw-claimed). */
export interface OutboxRow {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  reservationId: string | null;
  channel: string;
  externalReservationId: string | null;
  body: string;
  status: string;
  attemptCount: number;
}

export interface OutboxSendOutcome {
  ok: boolean;
  error?: string | null;
  providerMessageId?: string | null;
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
}

// Default single-attempt send (retries: 0 → exactly one POST). An internal thread
// (no externalReservationId) has nothing to deliver → treated as a delivered no-op.
const defaultSend: OutboxSendFn = async (row, token) => {
  if (!row.externalReservationId) return { ok: true, providerMessageId: null };
  const r = await sendMessage(row.externalReservationId, row.body, token, { retries: 0 });
  return { ok: r.ok, error: r.error, providerMessageId: r.id ?? null };
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
 * Atomically claim up to `batchSize` DUE rows for this worker token. Uses
 * FOR UPDATE SKIP LOCKED so concurrent workers/replicas each get a DISJOINT set —
 * a row is claimed by at most one worker. `pending` → `sending`; `ambiguous` →
 * `reconciling`. attemptCount is incremented on every claim. Fair order by
 * availableAt (oldest first).
 */
async function claimBatch(token: string, now: Date, expiry: Date, batchSize: number): Promise<OutboxRow[]> {
  // The DUE / claim-expiry comparisons use the worker's own `now` (injected in tests),
  // so the backoff clock and the claim clock never diverge.
  const rows = await prisma.$queryRaw<OutboxRow[]>(Prisma.sql`
    UPDATE "MessageOutbox" AS o
    SET "status" = CASE WHEN o."status" = 'pending' THEN 'sending' ELSE 'reconciling' END,
        "attemptCount" = o."attemptCount" + 1,
        "claimedBy" = ${token},
        "claimedAt" = ${now},
        "claimExpiresAt" = ${expiry},
        "updatedAt" = now()
    WHERE o."id" IN (
      SELECT s."id" FROM "MessageOutbox" s
      WHERE s."status" IN ('pending', 'ambiguous')
        AND s."availableAt" <= ${now}
        AND (s."claimExpiresAt" IS NULL OR s."claimExpiresAt" <= ${now})
        -- PER-CONVERSATION FIFO + single-in-flight (Codex #2): never claim a row while
        -- the SAME conversation has an EARLIER queued row (ordering) or an in-flight
        -- claimed row. Two replicas therefore can't send two messages of one thread in
        -- parallel or out of order; and at most one send per conversation per pass
        -- (2-min cadence) keeps well under Hospitable's 2/min/reservation limit.
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
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o."id", o."organizationId", o."conversationId", o."messageId",
              o."reservationId", o."channel", o."externalReservationId", o."body",
              o."status", o."attemptCount"
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
      if (done) await markConversationDelivered(row.conversationId, now);
      acc.reconciled++;
      return;
    }
    if (attemptsExhausted(row.attemptCount)) {
      await settle(row, token, "reconciling", { status: "review", claimedBy: null, claimExpiresAt: null });
      acc.review++;
      return;
    }
    await settle(row, token, "reconciling", { status: "ambiguous", availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)), claimedBy: null, claimExpiresAt: null });
    acc.ambiguous++;
    return;
  }

  // status === "sending": one send attempt.
  const outcome = await deps.send(row, providerToken);
  const kind = classifySendResult(outcome);
  if (kind === "definitive_success") {
    const done = await settle(row, token, "sending", { status: "sent", providerMessageId: outcome.providerMessageId ?? null, sentAt: now, lastErrorKind: null, lastErrorCode: null, claimedBy: null, claimExpiresAt: null }, outcome.providerMessageId);
    if (done) await markConversationDelivered(row.conversationId, now); // answered ONLY on confirmed delivery (#6)
    acc.sent++;
    return;
  }
  if (kind === "definitive_failure") {
    if (attemptsExhausted(row.attemptCount)) {
      await settle(row, token, "sending", { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: errorCode(outcome.error), claimedBy: null, claimExpiresAt: null });
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
  const acc: DrainResult = { claimed: 0, sent: 0, failed: 0, ambiguous: 0, reconciled: 0, review: 0, retried: 0 };
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
