import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgTimezone, dateKeyInTimeZone } from "@/lib/timezone";
import { reportError } from "@/lib/report-error";
import { getOrgHospitableToken, handleProviderAuthFailure } from "@/lib/hospitable-credentials";
import { dispatchOutbound, resolveOutboundRoute } from "@/lib/channels";
import { ANON_BODY } from "@/lib/data-retention";
import {
  attemptsExhausted,
  backoffMs,
  classifySendResult,
  sendFailureReason,
  type OutboxStatus,
  type SendResultKind,
  canTransition,
  isOutboxStatus,
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
  /** V0.3: ChannelConnection this send was enqueued under (null for pre-49 / unconnected rows). */
  connectionId: string | null;
}

export interface OutboxSendOutcome {
  ok: boolean;
  error?: string | null;
  providerMessageId?: string | null;
  /** On a 429, the provider's Retry-After converted to ms — the worker defers to it. */
  retryAfterMs?: number | null;
  /**
   * V0.1: the adapter's typed outcome class. When present, classifySendResult uses it
   * instead of the "HTTP (\d{3})" text regex — a future provider's error text will not
   * be in Hospitable's format. Optional so injected test senders keep working.
   */
  kind?: SendResultKind;
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

// Default single-attempt send — V0.1: goes through the Channel Layer dispatch boundary
// (the registered provider adapter owns the single-shot POST; the worker never sees
// the provider client). A local route (no destination, or an internal `qr-chat:` thread
// — the same rule sendOnChannel always applied; the old defaultSend did not check the
// prefix, unreachable because enqueue never queues internal threads) has nothing to
// deliver → treated as a delivered no-op, exactly as before.
const defaultSend: OutboxSendFn = async (row, token) => {
  const route = resolveOutboundRoute(row);
  if (route.kind === "local") return { ok: true, providerMessageId: null };
  const r = await dispatchOutbound(route.destination, row.body, { provider: route.destination.provider, token });
  return {
    ok: r.ok,
    error: r.error,
    providerMessageId: r.providerMessageId ?? null,
    // A 429 carries the provider's Retry-After (seconds) → defer to its window (Codex P1).
    retryAfterMs: r.retryAfterSec != null ? r.retryAfterSec * 1000 : null,
    kind: r.kind,
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
              o."body", o."status", o."attemptCount", o."connectionId"
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
  // STATE GATE (Codex 07-23): every settle flows through the closed transition
  // map. A buggy caller (the reconciling→pending token-miss bug was exactly this
  // class) is REFUSED instead of corrupting the machine: nothing is written, the
  // claim simply expires (claimExpiresAt) and the row re-enters the normal flow
  // from its REAL current state; the bug is surfaced loudly (secret-free).
  const targetStatus = data.status;
  if (typeof targetStatus === "string" && (!isOutboxStatus(targetStatus) || !canTransition(fromStatus, targetStatus))) {
    await reportError(
      "outbox-illegal-transition",
      new Error(`outbox: illegal transition ${fromStatus} -> ${String(targetStatus)} (outbox=${row.id})`),
    ).catch(() => {});
    return false;
  }
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
 *
 * 🚨 KOŞULLU (Codex F05, P1). Eski hâli `status != closed → answered` KOŞULSUZDU:
 * gönderim-öncesi veto ile sağlayıcı cevabı arasında yeni bir misafir mesajı gelip
 * thread'i `problem`a çevirdiyse (ya da yalnız yeni bir soru bıraktıysa) ESKİ
 * gönderimin tamamlanması YENİ sorunu "cevaplandı" diye kapatıyordu. Teslim gerçeği
 * satırda yaşar; konuşmanın İŞ durumu ise "son söz bizim mi" sorusuna bağlıdır:
 *   · yanıtın kendi Message'ından SONRA gelen inbound varsa → dokunma (thread haklı
 *     olarak new/problem'da; healer'ın r2 #1 kuralıyla aynı çapa),
 *   · AI satırı `problem` kilidini ASLA ezmez ("thread insana ait" kilidi — CLAUDE.md),
 *     host'un kendi yanıtı ise eski bir inbound'un açtığı problem'i meşru kapatır,
 *   · `lastMessageAt` YALNIZ İLERİ yönde yazılır (onarım/uzun claim'de geriye kaymaz).
 * Tek UPDATE statement'ında ilişki filtresi → yarış penceresi DB'de kapanır.
 */
async function markConversationDelivered(row: OutboxRow, now: Date): Promise<void> {
  const conversationId = row.conversationId;
  if (!conversationId) return;
  let anchor = now;
  let isAi = row.messageType === "ai";
  if (row.messageId) {
    const msg = await prisma.message
      .findUnique({ where: { id: row.messageId }, select: { createdAt: true, authorType: true } })
      .catch(() => null);
    if (msg) {
      anchor = msg.createdAt;
      isAi = isAi || msg.authorType === "ai";
    }
  }
  await prisma.conversation
    .updateMany({
      where: {
        id: conversationId,
        status: { notIn: isAi ? ["closed", "problem"] : ["closed"] },
        messages: { none: { direction: "inbound", createdAt: { gt: anchor } } },
      },
      data: { status: "answered" },
    })
    .catch(() => {});
  await prisma.conversation
    .updateMany({ where: { id: conversationId, lastMessageAt: { lt: now } }, data: { lastMessageAt: now } })
    .catch(() => {});
}

/**
 * SEND-TIME VETO for a reply-shaped row (manual / ai / holding_ack / legacy NULL).
 * Two layers, in this order:
 *   1. TARGET EXISTS + SAME TENANT (Codex F03) — for EVERY reply type. A deleted
 *      conversation/message, or a snapshot whose org differs from the thread's org, is
 *      never POSTed. Missing ≠ "manual, let it go".
 *   2. AI STATE (Codex P2) — only for AI rows: host took over / AI paused / escalated /
 *      superseded by a newer message → the stale draft must not go. A manual host reply
 *      the host explicitly wrote is never vetoed on state.
 * Returns a short reason code when the send must be canceled, else null.
 */
async function replyVeto(row: OutboxRow, now: Date): Promise<string | null> {
  // ── HEDEF VARLIĞI + KİRACI (Codex F03, P1) — HER yanıt türü için ─────────
  // 🚨 ESKİ KOD: `if (!msg || msg.authorType !== "ai") return null` — Message
  // BULUNAMAYINCA "manuel host mesajı, veto yok" deniyor ve POST yapılıyordu.
  // Konuşma silindiğinde (rota Message+Conversation'ı siler, kuyruğa dokunmazdı)
  // kuyruktaki metin snapshot'ı yine de sağlayıcıya gidiyordu; holding_ack ise
  // varlık kontrolünden hiç geçmiyordu. Kayıp kayıt ASLA "geçsin" demek değildir:
  // hüküm "hedef hâlâ var mı, aynı kiracıya mı ait" sorusuyla başlar.
  let convo: { status: string; autoReplyHoldUntil: Date | null; property: { organizationId: string } } | null = null;
  if (row.conversationId) {
    convo = await prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: { status: true, autoReplyHoldUntil: true, property: { select: { organizationId: true } } },
    });
    if (!convo) return "conversation_gone";
    // Snapshot'ın org'u ile hedef konuşmanın org'u ayrışıyorsa bu satır yanlış
    // kiracı adına POST yapardı (yanlış çağıran / bozuk satır) — asla.
    if (convo.property.organizationId !== row.organizationId) return "tenant_mismatch";
  }
  let msg: { authorType: string | null; createdAt: Date; conversationId: string } | null = null;
  if (row.messageId) {
    msg = await prisma.message.findUnique({
      where: { id: row.messageId },
      select: { authorType: true, createdAt: true, conversationId: true },
    });
    if (!msg) return "message_gone";
    if (row.conversationId && msg.conversationId !== row.conversationId) return "message_conversation_mismatch";
  }
  // holding_ack: soft ack — deliver, keep the thread in "problem". (Varlık kontrolü
  // yukarıda ARTIK ona da uygulanıyor; durum kontrolü uygulanmıyor — tasarım.)
  if (row.messageType === "holding_ack") return null;
  // ── AI DURUM VETOSU (Codex P2) — yalnız AI satırları ──────────────────────
  // Between enqueue and this POST the world may have moved on — the host answered
  // manually, the AI was paused / handed to a human, the thread was escalated, or a
  // newer message arrived. A manual host reply the host explicitly wrote always goes.
  if (!msg || !convo || msg.authorType !== "ai") return null;
  if (convo.status === "problem" || convo.status === "closed") return "escalated_or_closed";
  if (convo.autoReplyHoldUntil && convo.autoReplyHoldUntil > now) return "ai_paused";
  // A newer message (a host's manual reply, or a newer guest message) means this AI reply
  // is no longer the current turn — the thread moved on, so the stale draft must not go.
  const newer = await prisma.message.count({
    where: { conversationId: row.conversationId as string, id: { not: row.messageId as string }, createdAt: { gt: msg.createdAt } },
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
    select: {
      status: true, departureDate: true, welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true,
      // Org timezone for the checkout window rule below (same lookup, no extra query).
      property: { select: { organization: { select: { timezone: true } } } },
    },
  });
  if (!res) return "reservation_gone";
  if (res.status === "cancelled") return "reservation_cancelled";
  // A completed stay is stale for welcome/check-in, but a CHECK-OUT is legitimately due on the
  // departure day itself (status may already have flipped) — its `window_passed` date guard
  // below handles a truly-past departure. This keeps the flag-ON veto consistent with the
  // flag-OFF checkout query (which includes `completed`) so the two paths never disagree.
  const type = row.messageType;
  if ((type === "welcome" || type === "checkin") && res.status === "completed") return "reservation_completed";
  // Already delivered (stamp set by a prior/concurrent delivery) → never double-send.
  if (type === "welcome" && res.welcomeSentAt) return "already_sent";
  if (type === "checkin" && res.checkinSentAt) return "already_sent";
  if (type === "checkout" && res.checkoutSentAt) return "already_sent";
  // Window passed. A check-in whose stay is already over is stale. A CHECK-OUT is enqueued the
  // MORNING OF departure while departureDate sits at local midnight — i.e. already "in the past"
  // at send time — so it only goes stale once the departure DAY itself is over. "Day" is the
  // ORG-TIMEZONE calendar day (same rule as sendDueCheckouts, Codex 07-23): the old fixed
  // `departureDate + 24h` canceled a queued checkout an hour EARLY on a 25-hour DST fall-back
  // day (before the local day ended) and let it linger an hour LATE on a 23-hour spring-forward
  // day. Date-key comparison is also representation-agnostic within the day.
  if (type === "checkin" && res.departureDate < now) return "window_passed";
  if (type === "checkout") {
    const tz = orgTimezone(res.property?.organization?.timezone);
    if (dateKeyInTimeZone(now, tz) > dateKeyInTimeZone(res.departureDate, tz)) return "window_passed";
  }
  return null;
}

/**
 * Dispatch the correct send-time veto by messageType: lifecycle rows use the reservation-state
 * veto; every reply-shaped row (manual / ai / holding_ack / legacy NULL) goes through
 * `replyVeto`, which FIRST verifies the target still exists and belongs to the same tenant
 * (F03), THEN applies the AI-only state vetoes (a manual host reply is never vetoed on state;
 * a holding_ack is delivered and keeps the thread in "problem").
 */
async function sendTimeVeto(row: OutboxRow, now: Date): Promise<string | null> {
  const type = row.messageType;
  if (type === "welcome" || type === "checkin" || type === "checkout") return lifecycleVeto(row, now);
  return replyVeto(row, now);
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
/**
 * İNSAN DEVRİ HOLD'U — YALNIZ ONAYLANMIŞ TESLİMATTA (denetim, 08-01 — üçüncü tur).
 *
 * Bu hold `applyChannelAutoReply`'ın outbox dalında, ENQUEUE ANINDA kuruluyordu.
 * Ama hold aynı zamanda `aiSendVeto`'nun "ai_paused" kapısıdır: worker aynı
 * geçişte drain ederken KENDİ satırımızı veto edip `canceled` yapıyordu →
 * tasarlanmış devir mesajı misafire HİÇ gitmiyor, konuşma 12 saat susuyordu.
 *
 * Artık teslimat ONAYLANDIKTAN sonra kurulur — satır içi yolun semantiğiyle
 * birebir ("önce mesaj gider, sonra AI susar"). `reconciling → sent` yolu da
 * aynı fonksiyondan geçtiği için bedava kapsanır.
 *
 * ⚠️ `aiSendVeto`'ya DOKUNULMADI: host devraldı / misafir yeni yazdı / thread
 * "problem"a düştü korumalarının hepsi birebir çalışmaya devam ediyor. Muafiyet
 * yazmak o değişmezi delerdi.
 */
async function applyHandoffHold(row: OutboxRow, now: Date): Promise<void> {
  if (!row.conversationId || !row.messageId) return;
  if (row.messageType && row.messageType !== "ai") return; // yalnız AI yanıtı
  const msg = await prisma.message.findUnique({
    where: { id: row.messageId },
    select: { authorType: true, aiIntent: true },
  });
  if (msg?.authorType !== "ai" || msg.aiIntent !== "human_request") return;
  const org = await prisma.organization.findUnique({
    where: { id: row.organizationId },
    select: { handoffHoldHours: true },
  });
  const hours = org?.handoffHoldHours ?? (Number(process.env.HUMAN_HANDOFF_HOLD_HOURS) || 12);
  try {
    await prisma.conversation.update({
      where: { id: row.conversationId },
      data: { autoReplyHoldUntil: new Date(now.getTime() + hours * 60 * 60 * 1000) },
    });
  } catch (err) {
    // Sessiz `catch {}` bu repoda belgeli anti-desen: hold yazılamazsa AI devir
    // penceresinde tekrar araya girebilir → iz bırakmadan geçmemeli.
    void reportError("outbox-handoff-hold", err);
  }
}

async function applyDeliveryEffect(row: OutboxRow, now: Date): Promise<void> {
  const type = row.messageType;
  if (type === "welcome" || type === "checkin" || type === "checkout") {
    await stampLifecycleSent(row, now);
    return;
  }
  if (type === "holding_ack") return; // keep the thread in "problem" — never mark answered
  if (row.conversationId) {
    await markConversationDelivered(row, now);
    await applyHandoffHold(row, now);
  }
}

/**
 * KALICI GÖNDERİM HATASI → KONUŞMAYA SEBEP YAZ (geri çekilme DEĞİL).
 * (Derin denetim, 2026-08-01 — üçüncü tur; ilk hâli bir REGRESYON üretti, ↓.)
 *
 * Satır içi yol kalıcı bir hatada konuşmayı `status:"new"` + sebep kodu ile
 * işaretliyordu. Kuyruk yolu ise terminal geçişlerin (`failed`/`blocked`/
 * `review`) HİÇBİRİNDE konuşmaya dokunmuyordu → konuşma `status:"new"` +
 * `skippedReason:null` kalır, taslak `Message` silinmediği için sonraki her
 * geçiş `already_answered`'da durur: misafir KALICI cevapsız, host ekranında
 * sebep YOK, alarm YOK.
 *
 * 🚨 `autoReplyHoldUntil` BURADA YAZILMAZ — DENENDİ, MESAJ KAYBETTİRİYORDU.
 * O alan aynı zamanda `aiSendVeto`'nun "ai_paused" kapısıdır. 402 → satır
 * `blocked` + konuşmaya 4 saatlik hold yazılıyordu; host aboneliğini 4 saat
 * DOLMADAN yenilediğinde `reactivateBlockedOutbox` satırı `pending` yapıyor,
 * AYNI koşunun drain'i onu claim ediyor ve veto hold'u görüp `canceled`
 * damgalıyordu. `canceled` satır `/sent/queue`'dan da yeniden denenemez
 * (`requeueFailedOutbox` YALNIZ `failed` kabul eder) → mesaj KALICI KAYIP.
 * Bu, bugün düzeltilen "enqueue'de hold" arızasıyla AYNI SINIF: hold bir
 * ZAMANLAYICI değil, bir KİLİTTİR; gönderim hatası için kullanılmaz.
 *
 * Yerine `autoReplyAttemptedAt` damgalanır — "bu mesaj için karar verildi".
 * Aday sorgusu `autoReplyAttemptedAt < lastMessageAt` istediği için misafir
 * YENİ bir mesaj yazdığında konuşma kendiliğinden yeniden uygun olur; damga
 * konuşmanın KENDİ `lastMessageAt`'inden alınır, sunucu saatinden DEĞİL
 * (sağlayıcı saatiyle karışım, geçiş sırasında gelen bir mesajı KALICI olarak
 * yutabiliyordu — `syncCursorAt` dersinin aynısı).
 *
 * ⚠️ Yalnız AI satırları: `manual` satır HOST'un kendi mesajıdır — onun
 * gönderimi düşünce konuşmaya AI atlama sebebi yazmak yanlış bilgi olurdu
 * (host zaten `/sent/queue`'da ve kendi ekranında görür).
 * ⚠️ `status: "new"` koşulu: host thread'i "problem"/"closed"a taşıdıysa o karar
 * EZİLMEZ.
 */
async function applyFailureEffect(row: OutboxRow, kind: SendResultKind): Promise<void> {
  const type = row.messageType;
  // ⚠️ `type &&` YOK (denetim, 08-01 — dördüncü tur): legacy `messageType: null`
  // satırları (m30 öncesi) o koşulla GEÇİYORDU ve fonksiyonun kendi dokümanıyla
  // çelişiyordu. Host'un eski manuel satırı düşerse konuşmaya AI atlama sebebi
  // yazılmamalı — bugün yazan dört çağrının hepsi tip veriyor, bu yalnız eski
  // satırları etkiler ama sözleşme net olmalı.
  if (type !== "ai") return;
  if (!row.conversationId) return;
  try {
    const convo = await prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: { lastMessageAt: true },
    });
    if (!convo) return;
    // ⚠️ DAHA YENİ MİSAFİR MESAJI VARSA DAMGALAMA (denetim, 08-01 — dördüncü tur).
    // `review` dalına ancak 6 tükenmiş reconcile denemesinden (30 sn → 30 dk
    // backoff) SONRA, yani saatler sonra gelinir — ve o dal `sendTimeVeto`'dan
    // GEÇMEZ, yani `aiSendVeto`'nun "daha yeni mesaj varsa iptal et" garantisi
    // orada yok. Damgayı konuşmanın GÜNCEL `lastMessageAt`'inden almak, o pencerede
    // gelmiş YENİ bir misafir mesajını da susturur. Sebep yine yazılır (host görür),
    // yalnız susturma damgası atlanır → yeni mesaj normal şekilde yanıtlanır.
    let newerInbound = 0;
    if (row.messageId) {
      const draft = await prisma.message.findUnique({
        where: { id: row.messageId },
        select: { createdAt: true },
      });
      if (draft) {
        newerInbound = await prisma.message.count({
          where: {
            conversationId: row.conversationId,
            direction: "inbound",
            createdAt: { gt: draft.createdAt },
          },
        });
      }
    }
    await prisma.conversation.updateMany({
      where: { id: row.conversationId, status: "new" },
      data: {
        skippedReason: sendFailureReason(kind),
        ...(newerInbound > 0 ? {} : { autoReplyAttemptedAt: convo.lastMessageAt }),
      },
    });
  } catch (err) {
    // Sessiz `catch {}` bu repoda belgeli anti-desen: sebep yazılamazsa host
    // yine sessiz kalır — iz bırakmadan geçmemeli.
    void reportError("outbox-failure-effect", err);
  }
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
  // ⚠️ `manual` DA dahil (denetim, 08-01 — dördüncü tur): `applyFailureEffect`
  // artık manuel satırlara dokunmuyor (host'un kendi mesajına AI atlama sebebi
  // yazmak yanlış bilgiydi), ama o değişiklik manuel satırın TEK operasyonel
  // uyarısını da kaldırıyordu. Thread rozeti ve `/sent/queue` görünürlüğü zaten
  // duruyor; bu yalnız operatöre giden kırıntı. `failed` terminal ve satır başına
  // BİR KEZ girilir → fırtına yok.
  if (state !== "blocked" && !isLifecycle && !(t === "manual" && state === "failed")) return;
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
    // İKİNCİ SAVUNMA (denetim, 08-01): gövdesi temizlenmiş bir satır ASLA
    // dirilmez. Birinci savunma süpürgelerin bu satırı `canceled` yapmasıdır
    // (ERASABLE_STATUSES); bu koşul, süpürgenin bir gün bir bağı kaçırması
    // hâlinde bile (ör. konuşma/rezervasyon bağı kopmuş yetim satır) silinmiş
    // misafire sentinel metnin gitmesini engeller. Zaten anlamsız olan bir
    // gövdeyi göndermenin hiçbir faydası yok — kaybedilen bir şey yok.
    where: { organizationId, status: "blocked", body: { not: ANON_BODY } },
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

  // TENANT ↔ CONNECTION (V0.3): a row stamped with a connection that belongs to ANOTHER
  // org must never be sent (nor reconciled) — it would use this org's credential for a
  // destination queued under someone else's connection. Defensive: enqueue stamps the
  // org's own connection; only a bug or a hand-edited row can produce this. Sending rows
  // cancel; reconciling rows go to review (the only legal exit besides ambiguous/sent).
  if (row.connectionId) {
    const conn = await prisma.channelConnection.findUnique({ where: { id: row.connectionId }, select: { organizationId: true } });
    if (conn && conn.organizationId !== row.organizationId) {
      if (row.status === "reconciling") {
        await settle(row, token, "reconciling", { status: "review", lastErrorKind: "canceled", lastErrorCode: "connection_tenant_mismatch", claimedBy: null, claimExpiresAt: null });
        acc.review++;
      } else {
        await cancelRow(row, token, "connection_tenant_mismatch");
        acc.canceled++;
      }
      await reportError(
        "outbox-connection-tenant-mismatch",
        new Error(`outbox row ${row.id} (org ${row.organizationId}) references connection ${row.connectionId} of another org`),
      ).catch(() => {});
      return;
    }
  }

  const providerToken = await deps.tokenFor(row.organizationId);

  // TENANT ISOLATION (Codex): a row whose org has NO usable token — i.e. the org
  // DISCONNECTED after enqueue — must NEVER reach the provider. Without this guard
  // the null token flows in as `undefined` and hospitableFetch falls back to the
  // GLOBAL env (founder) token → a cross-tenant send (this org's reservation via
  // the founder's Hospitable account). Park the row back to `pending` with backoff
  // — NO provider call, NO attempt spent — so it delivers once the org reconnects.
  // Applies to BOTH the reconciling and sending paths (reconcile also hits the API).
  if (!providerToken) {
    // Claimed rows are always "sending" or "reconciling" here (both hit the API).
    // THE PARK DESTINATION MATTERS (07-20 audit, P1): a `sending` row was never
    // POSTed, so `pending` is safe — it re-sends after reconnect. A `reconciling`
    // row was ALREADY POSTed once with an ambiguous outcome (timeout/5xx — the
    // guest MAY have received it): parking THAT to `pending` would make the next
    // drain claim it as a fresh send and blind-re-POST → duplicate message. It
    // must park back to `ambiguous`, whose only exit is another RECONCILE (a
    // provider read, never a blind send). Token-miss here is routine, not just a
    // real disconnect (an OAuth refresh can transiently fail near expiry).
    const parked: OutboxStatus = row.status === "reconciling" ? "ambiguous" : "pending";
    await settle(row, token, row.status as OutboxStatus, {
      status: parked,
      availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)),
      // The claim already incremented attemptCount but NO provider call happened —
      // undo it (429/402 parity), or a long disconnect would silently burn the whole
      // retry budget: the first REAL failure after reconnect would then jump straight
      // to `failed`, and an ambiguous row's first failed reconcile straight to `review`.
      attemptCount: { decrement: 1 },
      lastErrorKind: "disconnected",
      claimedBy: null,
      claimExpiresAt: null,
    });
    acc.retried++;
    return;
  }

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
      if (done) {
        await signalOutboxStuck(row, "review");
        // ⚠️ `review` = BELİRSİZ: mesaj misafire ULAŞMIŞ OLABİLİR (ambiguous
        // gönderim, sağlayıcı geçmişinden güvenle doğrulanamadı). Buraya kesin
        // hata kodu yazmak, repo hiçbir yerde sahte "sent" iddia etmezken sahte
        // "iletilemedi" iddiası doğurur — host metne bakıp ELLE yanıtlar ve
        // misafir ÇİFT mesaj alır. Ayrı, dürüst bir kod kullanılır.
        await applyFailureEffect(row, "ambiguous");
      }
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
  if (kind === "auth_revoked") {
    // HTTP 401/403 — the provider REJECTED THE CREDENTIAL (V0.3). Not a per-message
    // failure: nothing was delivered and re-sending with the same credential cannot
    // succeed. Park the row back to `pending` WITHOUT consuming an attempt (429/402
    // parity) and hand the decision to the credential store: OAuth → force a refresh
    // (the token may simply be stale), PAT / freshly-refreshed OAuth → revoke the
    // connection (org columns cleared, connection `revoked`, audit + alarm) so the host
    // is told to reconnect; from then on the row parks as `disconnected` with NO
    // provider call until the connection is active again.
    const httpStatus = /HTTP (401|403)/.exec(outcome.error ?? "")?.[1] === "403" ? 403 : 401;
    await settle(row, token, "sending", {
      status: "pending",
      availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)),
      attemptCount: { decrement: 1 },
      lastErrorKind: "auth_revoked",
      lastErrorCode: errorCode(outcome.error),
      claimedBy: null,
      claimExpiresAt: null,
    });
    try {
      await handleProviderAuthFailure(row.organizationId, httpStatus);
    } catch (err) {
      // The row is already parked safely; the lifecycle decision failing must be visible,
      // not fatal to the batch.
      await reportError("outbox-auth-failure-handling", err).catch(() => {});
    }
    acc.retried++;
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
    if (done) {
      await signalOutboxStuck(row, "blocked");
      await applyFailureEffect(row, "blocked");
    }
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
      if (done) {
        await signalOutboxStuck(row, "failed");
        await applyFailureEffect(row, "definitive_failure");
      }
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
 * DELIVERY-EFFECT HEALER (Codex 07-23). applyDeliveryEffect is deliberately
 * best-effort — delivery truth lives on the outbox row — so a crash/DB blip
 * between settle("sent") and the side-effect update can leave a DELIVERED
 * message whose effects never landed: the thread stuck in "new"/"waiting", a
 * lifecycle *SentAt still null (the flag-OFF sender would then re-send it —
 * lifecycleOutboxOwns fences that, but the stamp should still exist), or
 * Message.externalId unlinked (sync dedup falls back to adopt-and-heal).
 * Every drain re-applies those effects IDEMPOTENTLY for recently-sent rows:
 * every UPDATE is guarded (status still new/waiting; stamp still null;
 * externalId still null) so re-running is a no-op. holding_ack is excluded by
 * design (the thread must STAY "problem"). Bounded: 48h window, small take.
 * lastMessageAt is deliberately not healed (display-only since m38).
 */
async function healDeliveryEffects(now: Date): Promise<void> {
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const PAGE = 200;
  // Org → devir penceresi saati. SAYFA DÖNGÜSÜNÜN DIŞINDA: içeride kurulunca
  // 25 sayfaya kadar sıfırlanıp aynı org için tekrar tekrar sorgulanıyordu.
  const hoursByOrg = new Map<string, number>();
  const MAX_PAGES = 25; // güvenlik tavanı — 48h penceresinde 5000+ satır beklenmez

  // ---- (1) Reply satırları (manual / ai / legacy-null) ----
  // CURSOR SAYFALAMA (Codex r2 #2): sabit take, pencerede >take zaten-iyileşmiş
  // satır varken eksik-etkili satırları süresiz AÇ bırakabilirdi. Deterministik
  // id-cursor'la TÜM pencere her drain'de taranır; iyileşmiş satırların maliyeti
  // yalnız sayfa okumasıdır (etki-eksikliği ön-filtreleri aşağıda).
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows: {
      id: string;
      organizationId: string;
      conversationId: string | null;
      messageId: string | null;
      providerMessageId: string | null;
      sentAt: Date | null;
    }[] = await prisma.messageOutbox.findMany({
      where: {
        status: "sent",
        sentAt: { gte: since },
        conversationId: { not: null },
        OR: [{ messageType: { in: ["manual", "ai"] } }, { messageType: null }],
      },
      select: {
        id: true,
        organizationId: true,
        conversationId: true,
        messageId: true,
        providerMessageId: true,
        sentAt: true,
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    // Conversation başına bu sayfadaki EN GEÇ teslim anı.
    const latestByConv = new Map<string, Date>();
    for (const r of rows) {
      const cid = r.conversationId as string;
      const t = r.sentAt ?? now;
      const prev = latestByConv.get(cid);
      if (!prev || t > prev) latestByConv.set(cid, t);
    }
    const needIds = (
      await prisma.conversation.findMany({
        where: { id: { in: [...latestByConv.keys()] }, status: { in: ["new", "waiting"] } },
        select: { id: true },
      })
    ).map((c) => c.id);
    for (const cid of needIds) {
      const deliveredAt = latestByConv.get(cid) as Date;
      // (Codex r2 #1) Teslimden SONRA yeni bir INBOUND geldiyse thread HAKLI
      // olarak new/waiting'tedir — answered'a EZMEK cevaplanmamış misafir
      // mesajını gizlerdi. Guard tek UPDATE statement'ında (ilişki filtresi):
      // yalnız "teslimden yeni inbound YOK" ise iyileştir.
      await prisma.conversation.updateMany({
        where: {
          id: cid,
          status: { in: ["new", "waiting"] },
          messages: { none: { direction: "inbound", createdAt: { gt: deliveredAt } } },
        },
        data: { status: "answered" },
      });
    }
    // externalId linki: yalnız hâlâ null olan mesajlar (ön-filtre → çoğu sayfada 0 iş).
    const linkable = rows.filter((r) => r.messageId && r.providerMessageId);
    if (linkable.length > 0) {
      const missing = new Set(
        (
          await prisma.message.findMany({
            where: { id: { in: linkable.map((r) => r.messageId as string) }, externalId: null },
            select: { id: true },
          })
        ).map((m) => m.id),
      );
      for (const r of linkable) {
        if (!missing.has(r.messageId as string)) continue;
        await prisma.message.updateMany({
          where: { id: r.messageId as string, externalId: null },
          data: { externalId: r.providerMessageId },
        });
      }
    }
    // ---- Devir penceresi (human_request) — ÜÇÜNCÜ teslimat etkisi ----
    // (Denetim 08-01, üçüncü tur — İKİ ajan bağımsız olarak buldu.)
    // `applyHandoffHold` bugün eklendi ama onarıcıya bağlanmamıştı: `settle("sent")`
    // ile yan etki arasında bir çökme/DB hıçkırığı olursa mesaj TESLİM EDİLMİŞ ama
    // AI hiç susturulmamış olur → host devralmışken AI 12 saat boyunca araya
    // girebilir. Eski kodda hold enqueue'de yazıldığı için bu boşluk YOKTU.
    //
    // ⚠️ Pencere satırın GERÇEK `sentAt`'inden hesaplanır, `now`'dan DEĞİL: 20 saat
    // önce teslim edilmiş bir devrin 12 saatlik penceresi ZATEN dolmuştur; `now`
    // kullanmak sessizliği haksız yere 12 saat UZATIRDI.
    // ⚠️ Yalnız `autoReplyHoldUntil: null` satıra yazılır → idempotent; dolmuş bir
    // pencere (geçmiş tarih) null DEĞİLDİR, yeniden kurulmaz.
    const handoffRows = rows.filter((r) => r.messageId && r.conversationId && r.sentAt);
    if (handoffRows.length > 0) {
      const handoffIds = new Set(
        (
          await prisma.message.findMany({
            where: {
              id: { in: handoffRows.map((r) => r.messageId as string) },
              authorType: "ai",
              aiIntent: "human_request",
            },
            select: { id: true },
          })
        ).map((m) => m.id),
      );
      if (handoffIds.size > 0) {
        for (const r of handoffRows) {
          if (!handoffIds.has(r.messageId as string)) continue;
          let hours = hoursByOrg.get(r.organizationId);
          if (hours === undefined) {
            const org = await prisma.organization.findUnique({
              where: { id: r.organizationId },
              select: { handoffHoldHours: true },
            });
            hours = org?.handoffHoldHours ?? (Number(process.env.HUMAN_HANDOFF_HOLD_HOURS) || 12);
            hoursByOrg.set(r.organizationId, hours);
          }
          const until = new Date((r.sentAt as Date).getTime() + hours * 60 * 60 * 1000);
          if (until <= now) continue; // pencere zaten dolmuş → yazacak bir şey yok
          await prisma.conversation
            .updateMany({
              where: { id: r.conversationId as string, autoReplyHoldUntil: null },
              data: { autoReplyHoldUntil: until },
            })
            .catch(() => {});
        }
      }
    }
    if (rows.length < PAGE) break;
  }

  // ---- (2) Lifecycle satırları: *SentAt damgası (satırın GERÇEK sentAt'iyle) ----
  cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows: { id: string; reservationId: string | null; messageType: string | null; sentAt: Date | null }[] =
      await prisma.messageOutbox.findMany({
      where: {
        status: "sent",
        sentAt: { gte: since },
        reservationId: { not: null },
        messageType: { in: ["welcome", "checkin", "checkout"] },
      },
      select: { id: true, reservationId: true, messageType: true, sentAt: true },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    const stampByRes = new Map(
      (
        await prisma.reservation.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.reservationId as string))] as string[] } },
          select: { id: true, welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true },
        })
      ).map((r) => [r.id, r]),
    );
    for (const r of rows) {
      const st = stampByRes.get(r.reservationId as string);
      if (!st) continue;
      const field =
        r.messageType === "welcome" ? "welcomeSentAt" : r.messageType === "checkin" ? "checkinSentAt" : "checkoutSentAt";
      if (st[field] !== null) continue; // zaten damgalı — iş yok (ön-filtre)
      await prisma.reservation.updateMany({
        where: { id: r.reservationId as string, [field]: null },
        data: { [field]: r.sentAt ?? now },
      });
    }
    if (rows.length < PAGE) break;
  }
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
      // Satır id'si CONTEXT'e değil MESAJA: `reportError` e-posta throttle'ını
        // context string'iyle anahtarlıyor, yani her satır ayrı bir kova olur ve
        // 10 dk'lık koruma kalkar — sistemik bir arızada tek drain 20 ayrı uyarı
        // e-postası + 20 ayrı Sentry Issue üretir (drain 2 dakikada bir koşar).
        await reportError(
          "outbox-row",
          err instanceof Error
            ? new Error(`${err.message} (row ${row.id})`)
            : new Error(`${String(err)} (row ${row.id})`),
        );
    }
  }
  // Heal missed delivery side-effects (idempotent; never blocks the drain result).
  try {
    await healDeliveryEffects(nowDate);
  } catch (err) {
    await reportError("outbox-heal", err);
  }
  return acc;
}

// Test seam: `settle` is internal by design; exported ONLY so the illegal-transition
// regression test can prove the runtime state gate refuses a bad write. Not public API.
export const __internals = { settle };
