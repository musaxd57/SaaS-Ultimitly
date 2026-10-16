import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAutomatedSendKind, recordAutomatedSend, settleAutomatedSend } from "@/lib/automated-sends";
import { orgTimezone } from "@/lib/timezone";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import { CHECKIN_LEAD_DAYS } from "@/lib/lifecycle-window";
import { loadErasureGuard } from "@/lib/erasure";
import { LEGACY_CONVERSATION_STATUSES } from "@/lib/constants";
import { errorWithContext, reportError } from "@/lib/report-error";
import { newCorrelationId, runAsNewSystemOperation, runWithCorrelation } from "@/lib/correlation";
import { logEvent } from "@/lib/event-log";
import {
  dispatchOutbound,
  handleOutboundCredentialRejected,
  resolveOrgChannelCredential,
  resolveOutboundRoute,
  type OutboundProvider,
} from "@/lib/channels";
import { ANON_BODY } from "@/lib/data-retention";
import { isHandoffExempt, sweepExpiredHandoffExempt } from "./handoff-exempt";
import { outboxDeliveryPaused } from "./flag";
import {
  attemptsExhausted,
  backoffMs,
  classifySendResult,
  sendFailureReason,
  PROVIDER_OUTAGE_REASON,
  type OutboxStatus,
  type SendResultKind,
  canTransition,
  isOutboxStatus,
  isTerminal,
  SUPERSEDED_BY_NEWER_MESSAGE,
  triggerMessageIdOf,
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
  /** Hızlı uyandırma turu (10-16): 48 saatlik teslim etkisi onarımı ATLANIR — onu 2 dk'lık periyodik tur yapar (her elle cevapta tarama yükü olmasın). */
  skipHeal?: boolean;
  /**
   * Hızlı uyandırma turu (Opus 10-16 N5): süresi dolmuş talepleri "belirsiz"e çeviren kurtarma ATLANIR. Uyandırma turu senkron kilidinin
   * DIŞINDA koşar; kilitli periyodik turun yavaş partisinde henüz POST'u yapılmamış satırları "belirsiz" yapıp gereksiz "ulaşmış olabilir"
   * incelemesine düşürmesin. Kurtarma yalnız kilitli periyodik turda.
   */
  skipRecover?: boolean;
  /**
   * Resolve an org's channel credential token for the row's provider. Default = the Channel Layer
   * (`resolveOrgChannelCredential(orgId, provider)`, V0.8): a credential of ANOTHER provider is never returned.
   */
  tokenFor?: (organizationId: string, provider?: OutboundProvider) => Promise<string | undefined>;
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
  //             every claim stamps; settle clears it only for a no-POST deferral). window functions can't sit
  //             under FOR UPDATE, hence the separate layer.
  //   filter  — HOSPITABLE 2/min/RESERVATION (Codex P1): a SEND claim is allowed only when
  //             `rn + recent <= 2`, i.e. prior-window attempts + this row's rank stay within
  //             two. So at most two provider calls per reservation per 60s; a 3rd ready row
  //             is left for the next window. Atomic under multi-replica via the shared claim
  //             lock (above) + committed claimedAt reads. Reconcile claims (ambiguous rows)
  //             never POST, so they bypass the send cap.
  // 🚨 Y5 (10-14 dış inceleme): GENEL KAPATMA (`AUTO_REPLY_ENABLED` "1" değil) kuyruktaki OTOMATİK mesajı da durdurur — eskiden
  // yalnız kuyruğa girişte bakılıyordu. Yaşam döngüsü satırı (karşılama / giriş / çıkış) TALEP EDİLMEZ, bekler (deneme sayısı artmaz;
  // anahtar açılınca tarih vetolarıyla normal işlenir). Yapay zekâ cevabı talep edilir ve gönderim anı vetosu İPTAL eder (↓sendTimeVeto —
  // durum makinesinde pending → canceled yok). Elle cevap ("manual", eski NULL) ve belirsiz teslim uzlaştırması (POST yok) etkilenmez;
  // bekleyen otomatik satır aynı konuşmadaki elle cevabı SIRA kuralıyla tıkamaz.
  const autoAllowed = autoReplySwitchOn();
  // Bekleyen gönderimler duraklatıldıysa (kurucu 10-16, `OUTBOX_DELIVERY_PAUSED`) yalnız UZLAŞTIRMA talebi (POST yok) alınır.
  const deliveryPaused = outboxDeliveryPaused();
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
                 -- claimedAt is stamped on every claim; settle clears it ONLY for a no-POST deferral
                 -- (checkin window not open), so it is the true "last attempt" clock. (org-scoped: a Hospitable reservation UUID is
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
            AND (NOT ${deliveryPaused}::boolean OR s."status" = 'ambiguous')
            AND (${autoAllowed}::boolean OR s."status" = 'ambiguous' OR s."messageType" IS NULL OR s."messageType" IN ('manual', 'ai', 'holding_ack'))
            AND s."availableAt" <= ${now}
            AND (s."claimExpiresAt" IS NULL OR s."claimExpiresAt" <= ${now})
            AND NOT EXISTS (
              SELECT 1 FROM "MessageOutbox" e
              WHERE e."conversationId" = s."conversationId"
                AND e."id" <> s."id"
                AND e."status" IN ('pending', 'sending', 'ambiguous', 'reconciling')
                AND NOT (NOT ${autoAllowed}::boolean AND e."status" = 'pending' AND e."messageType" IS NOT NULL AND e."messageType" <> 'manual')
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
  if (newer > 0) return SUPERSEDED_BY_NEWER_MESSAGE;
  // 🚨 MODEL DÜŞÜNÜRKEN GELEN MİSAFİR MESAJI (Codex 09-30, C2). Yukarıdaki kıyas cevabın KENDİ kayıt anına göre: misafirin
  // model çalışırken yazdığı mesajın zamanı (sağlayıcı damgası) cevaptan ÖNCE kalıyor ve bayat cevap gidiyordu. Doğru çapa
  // cevabın CEVAPLADIĞI tetik mesajı: ondan sonra gelen her misafir mesajı modelin görmediği yeni turdur.
  const triggerId = triggerMessageIdOf(
    (await prisma.messageOutbox.findUnique({ where: { id: row.id }, select: { idempotencyKey: true } }))?.idempotencyKey,
    row.conversationId as string,
  );
  if (triggerId) {
    const trigger = await prisma.message.findUnique({
      where: { id: triggerId },
      select: { createdAt: true, conversationId: true },
    });
    if (trigger && trigger.conversationId === row.conversationId) {
      const newerGuest = await prisma.message.count({
        where: {
          conversationId: row.conversationId as string,
          direction: "inbound",
          id: { not: triggerId },
          OR: [{ createdAt: { gt: trigger.createdAt } }, { createdAt: trigger.createdAt, id: { gt: triggerId } }],
        },
      });
      if (newerGuest > 0) return SUPERSEDED_BY_NEWER_MESSAGE;
    }
  }
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
  // Aynı rezervasyonun kardeş satırları (yeniden bağlama sonrası çift satır) KEYFİ sırayla okunmaz (Haiku 10-14): iptal edilmiş bir
  // kopya önce dönerse canlı rezervasyonun mesajı kalıcı iptal ediliyordu. İptal OLMAYAN satır tercih edilir (en erken varış — ertelemeyle
  // aynı kural, `checkinNotYetDue`); hepsi iptalse iptal hükmü verilir.
  const siblings = await prisma.reservation.findMany({
    where: { sourceReference: row.externalReservationId, property: { organizationId: row.organizationId } },
    select: {
      id: true, status: true, arrivalDate: true, departureDate: true, welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true,
      // Org timezone for the checkout window rule below (same lookup, no extra query).
      property: { select: { organization: { select: { timezone: true } } } },
    },
    orderBy: [{ arrivalDate: "asc" }, { id: "asc" }],
  });
  // Öncelik (Haiku 10-14 son tur): satırın KENDİ rezervasyonu (iptal değilse) → onaylı kopya → iptal olmayan kopya → herhangi biri.
  // Başka mülkteki "bekliyor / tamamlandı" bir kopya ("window_passed", "reservation_completed") canlı rezervasyonun mesajını kalıcı
  // iptal etmesin — kuyruğa giriş de onaylı satırı seçer.
  const res =
    siblings.find((r) => r.id === row.reservationId && r.status !== "cancelled") ??
    siblings.find((r) => r.status === "confirmed") ??
    siblings.find((r) => r.status !== "cancelled") ??
    siblings[0] ??
    null;
  if (!res) return "reservation_gone";
  if (res.status === "cancelled") return "reservation_cancelled";
  // Açık silme (KVKK tombstone) kuyruğa girdikten SONRA geldiyse mesaj gitmez (Haiku 10-14; gövde "[ANON]" olmayabilir).
  if ((await loadErasureGuard(row.organizationId)).blocksSourceReference(row.externalReservationId)) return "erased";
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
  // TEK TARİH KURALI (`calendarDateOf`, ikinci inceleme 09-25): "yalnız tarih" değeri (D 00:00Z / D 12:00Z) org dilimine
  // ÇEVRİLMEZ — eski kıyas New York'ta çıkış gününün sabahı kuyruktaki mesajı "geçti" diye iptal ediyordu. Giriş mesajı da
  // aynı kuralla (15 ajan A08, 10-01): org gününe göre çıkış GÜNÜ başlayınca bayat — ham `departureDate < now` New York'ta
  // tek gecelik konaklamanın varış akşamı 20:00'den sonra giriş bilgisini iptal ediyordu (İstanbul'un yerel gece yarısı
  // saklama biçiminde sonuç eskisiyle aynı).
  if (type === "checkin" || type === "checkout") {
    const tz = orgTimezone(res.property?.organization?.timezone);
    const today = todayKey(now, tz);
    const departureDay = calendarDateOf(res.departureDate, tz).key;
    if (type === "checkin" && today >= departureDay) return "window_passed";
    if (type === "checkout" && today > departureDay) return "window_passed";
  }
  return null;
}

/** Genel otomatik mesaj anahtarı (`AUTO_REPLY_ENABLED`, kuyruğa giriş kapılarıyla aynı okuma). */
function autoReplySwitchOn(): boolean {
  return process.env.AUTO_REPLY_ENABLED === "1";
}

/**
 * Y4 (10-14 dış inceleme): kuyruğa girdikten sonra İLERİ tarihe taşınan rezervasyonun giriş mesajı (kapı kodu taşıyabilir) erken GİTMEZ —
 * rezervasyonun en erken onaylı varışı aday seçimiyle aynı pencerenin dışındaysa pencerenin açılacağı ana ERTELENİR. İptal
 * EDİLMEZ (Haiku: iptal + rezervasyon başına tek anahtar mesajı kalıcı yutuyordu; varış günlü anahtar ise çift gönderime açıktı).
 */
async function checkinNotYetDue(row: OutboxRow, now: Date): Promise<Date | null> {
  if (row.messageType !== "checkin" || !row.externalReservationId) return null;
  // Rezervasyonun ONAYLI satırlarının EN ERKEN varışı (kardeş çift satır sıradan / keyfi seçilmez — bir kardeşin uzak tarihi gönderici
  // her geçişte vadeyi şimdiye çekerken işçinin her seferinde ertelemesi döngüsü doğurmasın). Onaylı satır yoksa diğer vetolar karar verir.
  const earliest =
    (await prisma.reservation.findFirst({
      where: { sourceReference: row.externalReservationId, property: { organizationId: row.organizationId }, status: "confirmed" },
      orderBy: { arrivalDate: "asc" },
      select: { arrivalDate: true },
    })) ??
    // Onaylı kopya yoksa (ör. "bekliyor"a döndü) satırın KENDİ rezervasyonunun tarihi — açık kalmasın (Haiku 10-14 son tur): kapı kodu
    // haftalar önce gitmesin. İptal / tamamlanma hükmünü ↓veto verir.
    (row.reservationId
      ? await prisma.reservation.findUnique({ where: { id: row.reservationId }, select: { arrivalDate: true } })
      : null);
  if (!earliest) return null;
  const opensAt = earliest.arrivalDate.getTime() - CHECKIN_LEAD_DAYS * 86_400_000;
  return opensAt > now.getTime() ? new Date(opensAt) : null;
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
  // Y5 (10-14 dış inceleme): genel kapatma kapalıyken kuyruktaki yapay zekâ cevabı GİTMEZ ve SONRA da gitmez (Haiku: anahtar günlerce kapalı
  // kalıp açılınca bayat cevap gidiyordu) → iptal; gelen kutusunda sebep notu görünür (↓çağıran). Yaşam döngüsü satırı talep edilmez, bekler.
  if (!autoReplySwitchOn() && (type === "ai" || type === "holding_ack")) return "auto_reply_disabled";
  if (type === "welcome" || type === "checkin" || type === "checkout") return lifecycleVeto(row, now);
  return replyVeto(row, now);
}

/** K7: yaşam döngüsü satırı (karşılama / giriş / çıkış) için gönderim izi; diğer satırlar ve eksik hedef → null (en iyi çaba). */
async function traceOutboxLifecycleSend(row: OutboxRow, now: Date): Promise<string | null> {
  if (!isAutomatedSendKind(row.messageType) || !row.externalReservationId || !row.reservationId) return null;
  const reservation = await prisma.reservation
    .findUnique({ where: { id: row.reservationId }, select: { propertyId: true } })
    .catch(() => null);
  if (!reservation) return null;
  return recordAutomatedSend(prisma, {
    organizationId: row.organizationId,
    propertyId: reservation.propertyId,
    reservationId: row.reservationId,
    externalReservationId: row.externalReservationId,
    kind: row.messageType,
    body: row.body,
    sentAt: now,
  });
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
  // Öğe kipindeki insan talebi cevabı: satır içi yol kilit kurmaz; karar kuyruğa girişte işaretlendi (`handoff-exempt.ts`, Opus O1 + B1/B2).
  if (await isHandoffExempt(prisma, row.id)) return;
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
    // G10 (kurucu kararı 10-13): belirsiz sonucun son denemesi sağlayıcı 5xx'i ise sebep `provider_outage` (satır içi yolla parite;
    // davranış aynı — satır `review`e park eder, kör tekrar yok). Yalnız bu hata yolunda bir kez okunur.
    const lastErrorCode =
      kind === "ambiguous"
        ? (await prisma.messageOutbox.findUnique({ where: { id: row.id }, select: { lastErrorCode: true } }))?.lastErrorCode ?? null
        : null;
    await prisma.conversation.updateMany({
      where: { id: row.conversationId, status: "new" },
      data: {
        skippedReason: lastErrorCode && /^HTTP 5\d\d$/.test(lastErrorCode) ? PROVIDER_OUTAGE_REASON : sendFailureReason(kind),
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
    const conn = await prisma.channelConnection.findUnique({ where: { id: row.connectionId }, select: { organizationId: true, status: true } });
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
    // V0.7 — DAMGALI SATIR YALNIZ KENDİ BAĞLANTISINDAN GİDER: bağlantı revoked/disconnected
    // (ya da satırı silinmiş) ise mesaj BEKLER; org'un o an başka bir kimliği (kurucu env
    // fallback'i) olsa bile ONUNLA gönderilmez — revoked bir hesabın mesajı sessizce başka
    // kimlikle çıkmasın. Deneme tüketilmez; host yeniden bağlanınca AYNI satır aktifleşir ve
    // mesaj tam bir kez gider. Damgasız satır (env altında kuyruklanan) aşağıdaki normal yolu izler.
    if (!conn || conn.status !== "active") {
      const parked: OutboxStatus = row.status === "reconciling" ? "ambiguous" : "pending";
      await settle(row, token, row.status as OutboxStatus, {
        status: parked,
        availableAt: new Date(now.getTime() + backoffMs(row.attemptCount, row.id)),
        attemptCount: { decrement: 1 },
        lastErrorKind: "disconnected",
        lastErrorCode: "connection_inactive",
        claimedBy: null,
        claimExpiresAt: null,
      });
      acc.retried++;
      return;
    }
  }

  const rowRoute = resolveOutboundRoute(row);
  const providerToken = await deps.tokenFor(row.organizationId, rowRoute.kind === "external" ? rowRoute.destination.provider : undefined);

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
  // Gönderim öncesi okumalar (kardeş satırlar, silme kapısı, pencere) DB hatası verirse satır POST'suz GERİ bırakılır (Haiku 10-14: eskiden
  // "sending"de kalıp süre dolunca "misafire ulaşmış olabilir" incelemesine düşüyordu — hiç gönderilmemiş mesaj için yanıltıcı).
  let deferUntil: Date | null;
  let veto: string | null = null;
  try {
    deferUntil = await checkinNotYetDue(row, now);
    if (!deferUntil) veto = await sendTimeVeto(row, now);
  } catch (err) {
    void reportError(`outbox-veto-read org=${row.organizationId}`, err);
    await settle(row, token, "sending", {
      status: "pending",
      availableAt: new Date(now.getTime() + 60_000),
      attemptCount: { decrement: 1 },
      claimedBy: null,
      claimExpiresAt: null,
      claimedAt: null,
    });
    return;
  }
  if (deferUntil) {
    // Talep bırakılır, satır pencere açılınca yeniden talep edilir; bu talep bir DENEME sayılmaz (deneme tavanını yemesin).
    await settle(row, token, "sending", {
      status: "pending",
      availableAt: deferUntil,
      attemptCount: { decrement: 1 },
      claimedBy: null,
      claimExpiresAt: null,
      // POST yapılmadı: rezervasyon başına "60 sn'de en çok 2 gönderim" sayacı (claimedAt) bu talebi saymasın (Haiku 10-14).
      claimedAt: null,
    });
    return;
  }
  if (veto) {
    const canceled = await cancelRow(row, token, veto);
    acc.canceled++;
    // Y5: anahtar kapalıyken iptal edilen yapay zekâ cevabı SESSİZ kalmaz — gelen kutusunda sebep görünür ve konuşma "denendi" sayılır
    // (Haiku 10-14: anahtar açılınca aynı mesaj için model boşuna yeniden koşuyor, aynı anahtar yutunca misafire hiç cevap gitmiyordu).
    // Misafir yeniden yazarsa yeni mesaj için cevap normal üretilir.
    if (canceled && veto === "auto_reply_disabled" && row.conversationId) {
      // Damga cevabın CEVAPLADIĞI mesajın anı (Haiku 10-14: konuşmanın son mesajı alınırsa anahtar kapalıyken gelen YENİ mesajlar da
      // "karar verildi" sayılır, açılınca hiç cevaplanmazdı). Tetik bilinmiyorsa damga yok — yalnız not.
      const outbox = await prisma.messageOutbox.findUnique({ where: { id: row.id }, select: { idempotencyKey: true } });
      const triggerId = triggerMessageIdOf(outbox?.idempotencyKey, row.conversationId);
      const trigger = triggerId
        ? await prisma.message.findUnique({ where: { id: triggerId }, select: { createdAt: true, conversationId: true } })
        : null;
      const stamp = trigger && trigger.conversationId === row.conversationId ? trigger.createdAt : null;
      await prisma.conversation
        .updateMany({
          where: {
            id: row.conversationId,
            status: { in: ["new", ...LEGACY_CONVERSATION_STATUSES] },
            ...(stamp ? { OR: [{ autoReplyAttemptedAt: null }, { autoReplyAttemptedAt: { lt: stamp } }] } : {}),
          },
          data: { skippedReason: "auto_reply_disabled", ...(stamp ? { autoReplyAttemptedAt: stamp } : {}) },
        })
        .catch((err) => void reportError(`outbox-auto-reply-disabled-note org=${row.organizationId}`, err));
    }
    return;
  }

  // 🚨 Y1 (Codex 10-07): GÖVDE TALEP ALTINDA YENİDEN OKUNUR. Talep partideki satırların gövdesini belleğe alıyor; parti sıralı
  // gönderilirken (≤20 POST) bir misafirin silme işlemi talep edilmiş satırının gövdesini `[ANON]` yapar ama İPTAL ETMEZ (yalnız
  // talepsiz satırları iptal eder) → bellekteki eski özel metin gidiyordu. Gönderilen metin artık POST'tan hemen önce, bu talebin
  // hâlâ bize ait olduğu doğrulanarak okunan gövdedir; silinmişse satır iptal edilir. Kalan pencere yalnız bu okumayla POST arası
  // (milisaniye) — `erasure.ts`te belgeli "gönderim sürerken silindi" istisnası.
  const live = await prisma.messageOutbox.findFirst({
    where: { id: row.id, claimedBy: token, status: "sending" },
    select: { body: true, claimExpiresAt: true },
  });
  if (!live) return; // talep kaybedildi (süresi doldu / başka işçi aldı): bu işçi hiçbir şey göndermez
  // Talebin süresi DOLDU ama henüz kimse kurtarmadı (Opus 10-16 N5 ikinci kemer): bu satır için POST YAPILMADI — kesin "gönderilmedi".
  // Göndermek, başka bir turun aynı anda "belirsiz"e çevirip uzlaştırmasıyla yarışırdı; "belirsiz" bırakmak gereksiz "ulaşmış olabilir"
  // incelemesi doğururdu. Satır KENDİ talebimiz koşuluyla bekleyene geri bırakılır; sıradaki tur temiz gönderir.
  const liveNow = deps.now();
  if (live.claimExpiresAt != null && live.claimExpiresAt.getTime() <= liveNow.getTime()) {
    await settle(row, token, "sending", {
      status: "pending",
      availableAt: liveNow,
      // POST yapılmadı: deneme sayılmaz, rezervasyon başına "60 sn'de 2 gönderim" sayacı da bu talebi saymaz (checkin-ertele yolu ile aynı).
      attemptCount: { decrement: 1 },
      claimedBy: null,
      claimExpiresAt: null,
      claimedAt: null,
    });
    return;
  }
  if (live.body === ANON_BODY) {
    await cancelRow(row, token, "erased");
    acc.canceled++;
    return;
  }
  row = { ...row, body: live.body };

  // K7 (09-30): yaşam döngüsü satırının GÖNDERİM İZİ — POST'tan ÖNCE (`automated-sends.ts`), sonuçla kapanır: senkron aynı
  // mesajı geri getirince "ev sahibi yazdı" değil "otomatik mesaj" olur. Yalnız teslim olmuş olabilecekler eşleşmeye açık.
  const traceId = await traceOutboxLifecycleSend(row, now);
  const outcome = await deps.send(row, providerToken);
  const kind = classifySendResult(outcome);
  await settleAutomatedSend(
    prisma,
    traceId,
    kind === "definitive_success" ? "sent" : kind === "ambiguous" ? "unverified" : "failed",
    outcome.providerMessageId,
  );
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
      // V0.8: the rejected credential goes back to ITS provider's lifecycle owner (the row's own route decides which).
      const route = resolveOutboundRoute(row);
      if (route.kind === "external") {
        await handleOutboundCredentialRejected(row.organizationId, httpStatus, { provider: route.destination.provider, token: providerToken });
      }
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
    // outage (the founder org's live account is in exactly this state). Park in terminal-until-reactivated
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
  // Süresi dolmuş devir muafiyeti işaretleri (14 gün; onarıcı penceresinin çok üstünde) — fırsatçı süpürme, hata onarımı durdurmaz.
  await sweepExpiredHandoffExempt(prisma, now).catch((err) => reportError("outbox-handoff-exempt-sweep", err));

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

    // Conversation başına bu sayfadaki EN GEÇ cevap çapası. 🚨 Y3 (Codex 10-07): çapa normal yolla (`markConversationDelivered`)
    // AYNI — cevabın kendi Message'ının `createdAt`'i; `messageId` yoksa (ya da mesaj yoksa) `sentAt`. Eskiden onarıcı `sentAt`'e
    // çapalıydı: cevap yazıldıktan SONRA ama gönderimden ÖNCE gelen misafir mesajını normal yol haklı olarak açık bırakıyor,
    // onarıcı AYNI turda "answered" yapıp yeni soruyu gizliyordu.
    const replyMessageIds = [...new Set(rows.map((r) => r.messageId).filter((m): m is string => !!m))];
    const replyCreatedAt = new Map(
      replyMessageIds.length
        ? (
            await prisma.message.findMany({ where: { id: { in: replyMessageIds } }, select: { id: true, createdAt: true } })
          ).map((m) => [m.id, m.createdAt] as const)
        : [],
    );
    const latestByConv = new Map<string, Date>();
    for (const r of rows) {
      const cid = r.conversationId as string;
      const t = (r.messageId ? replyCreatedAt.get(r.messageId) : undefined) ?? r.sentAt ?? now;
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
      const deliveredAt = latestByConv.get(cid) as Date; // cevap çapası (yukarıda)
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
          // Öğe kipindeki insan talebi cevabı → onarıcı da kurmaz (aynı işaret; dolmuş pencereden SONRA — boşa sorgu yok).
          if (await isHandoffExempt(prisma, r.id)) continue;
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
    tokenFor:
      deps.tokenFor ??
      ((orgId: string, provider?: OutboundProvider) => resolveOrgChannelCredential(orgId, provider).then((c) => c?.token ?? undefined)),
  };
  const acc: DrainResult = { claimed: 0, sent: 0, failed: 0, ambiguous: 0, reconciled: 0, review: 0, retried: 0, canceled: 0, rateLimited: 0, blocked: 0 };
  const token = randomUUID();
  const nowDate = now();
  const expiry = new Date(nowDate.getTime() + CLAIM_TTL_MS);

  // Recover crashed-mid-attempt rows first (stale claim → ambiguous). Best-effort. Hızlı uyandırma turunda atlanır (N5).
  if (!deps.skipRecover) {
    try {
      await recoverStaleClaims(nowDate);
    } catch (err) {
      await reportError("outbox-recover", err);
    }
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
    // TAKİP NUMARASI (2. dilim, kurucu kararı 10-12 sabah): her satırın işlenmesi kendi numarasıyla ve satırın işletmesiyle. Olay günlüğüne
    // yalnız KESİN sonuç (gönderildi / başarısız / incelemede / iptal / park) ya da hata, satırın veritabanındaki SON durumundan okunarak
    // yazılır — sayaç farkı, gönderimden sonra fırlayan bir yan etkide "değişmedi" diyordu (Haiku incelemesi 10-12); yeniden denemeler yazılmaz
    // (hacim). Metin / kişisel veri YOK.
    await runWithCorrelation({ id: newCorrelationId(), organizationId: row.organizationId }, async () => {
      let errored = false;
      try {
        await processOne(row, token, resolved, acc);
      } catch (err) {
        errored = true;
        // Poison isolation: this row's claim will expire and be recovered later; the
        // rest of the batch continues.
        // Satır id'si CONTEXT'e değil MESAJA: `reportError` e-posta throttle'ını
          // context string'iyle anahtarlıyor, yani her satır ayrı bir kova olur ve
          // 10 dk'lık koruma kalkar — sistemik bir arızada tek drain 20 ayrı uyarı
          // e-postası + 20 ayrı Sentry Issue üretir (drain 2 dakikada bir koşar).
          await reportError(
            "outbox-row",
            errorWithContext(err, ` (row ${row.id})`),
          );
      }
      const settled = await prisma.messageOutbox.findUnique({ where: { id: row.id }, select: { status: true } }).catch(() => null);
      const status = settled?.status ?? "unknown";
      if (errored || (isOutboxStatus(status) && isTerminal(status))) {
        await logEvent("job.outbox.row", { status, errored, outboxId: row.id });
      }
    });
  }
  // Heal missed delivery side-effects (idempotent; never blocks the drain result). Hızlı uyandırma turu atlar (periyodik tur yapar).
  if (!deps.skipHeal) {
    try {
      await healDeliveryEffects(nowDate);
    } catch (err) {
      await reportError("outbox-heal", err);
    }
  }
  return acc;
}

// Test seam: `settle` is internal by design; exported ONLY so the illegal-transition
// regression test can prove the runtime state gate refuses a bad write. Not public API.
export const __internals = { settle };

// ---------------------------------------------------------------------------
// HIZLI UYANDIRMA (kurucu 10-16: "elle mesaj: kalıcı kuyruk korunsun, gönderim işi hızlı uyandırılsın; iki dakika beklemek varsayılan
// olmasın; hemen ayrı servis açmak zorunlu değil, mevcut yapıda uygulanabilir çözümü ölç"). Kuyruğa yazan istek İŞLEM COMMIT OLDUKTAN
// SONRA bunu çağırır: aynı süreçte bir boşaltma turu başlatılır (taleplerin tek sahibi `FOR UPDATE SKIP LOCKED` + talep kilidi — 2 dakikalık
// senkronla ya da başka kopyayla aynı anda koşmak güvenli; konuşma sırası ve rezervasyon başına gönderim sınırı talep sorgusunda).
// Tur sürerken gelen yeni uyandırma kaybolmaz: biri koşarken en çok bir tur daha sıraya alınır. Süreç düşerse kayıp yok — satır kalıcı,
// 2 dakikalık senkron onu alır (yedek yol). Duraklatma (`OUTBOX_DELIVERY_PAUSED`) burada da geçerli (talep sorgusu).
// ---------------------------------------------------------------------------

let kickRunning = false;
let kickAgain = false;
let kickStartedAt = 0;
let kickGeneration = 0;
let followUpMs = 61_000;
let followUpTimer: ReturnType<typeof setTimeout> | null = null;
let emptyFollowUps = 0;
/** Art arda boş takip turu tavanı: sıkışmış (ör. sırada bekleyen) bir satır yüzünden dakikada bir sonsuz uyandırma olmasın. */
const MAX_EMPTY_FOLLOW_UPS = 3;
/** Uyandırma turu bu süreden uzun dönmediyse takılmış sayılır (Opus 10-16 N6): o süreçte hızlı uyandırma sessizce ölmesin. */
const KICK_STALE_MS = 10 * 60_000;
/** Uyandırma turunun parti boyu (N5): elle cevap için birkaç satır yeter; birikmiş kuyruğu periyodik tur boşaltır. */
const KICK_BATCH = 5;

/** Hızlı uyandırma açık mı — varsayılan AÇIK; yalnız tam "0" kapatır (operasyonel kaçış; testler kapalı koşar). */
export function outboxFastWakeEnabled(): boolean {
  return process.env.OUTBOX_FAST_WAKE !== "0";
}

/** Gönderilebilir (vadesi ~1 dk içinde gelen) bekleyen ELLE cevap var mı — takip turu gerekip gerekmediği. */
async function pendingManualSoon(): Promise<boolean> {
  const row = await prisma.messageOutbox.findFirst({
    where: {
      status: "pending",
      OR: [{ messageType: null }, { messageType: "manual" }],
      availableAt: { lte: new Date(Date.now() + followUpMs) },
    },
    select: { id: true },
  });
  return row !== null;
}

export function kickOutboxDrain(
  drain: () => Promise<unknown> = () => drainOutboxOnce({ skipHeal: true, skipRecover: true, batchSize: KICK_BATCH }),
): void {
  if (!outboxFastWakeEnabled()) return;
  if (kickRunning) {
    if (Date.now() - kickStartedAt < KICK_STALE_MS) {
      kickAgain = true;
      return;
    }
    // Takılmış tur (ör. hiç dönmeyen sorgu): yeni tur başlar; eski turun `finally`si nesil farkı yüzünden durumu ezmez.
    void reportError("outbox.kick", new Error("Hızlı uyandırma turu 10 dakikadır dönmedi — yeni tur başlatıldı")).catch(() => {});
  }
  kickRunning = true;
  kickAgain = false;
  kickStartedAt = Date.now();
  const generation = ++kickGeneration;
  const loop = async (): Promise<void> => {
    let claimedAny = false;
    try {
      do {
        kickAgain = false;
        const r = (await drain()) as { claimed?: number } | undefined;
        if ((r?.claimed ?? 0) > 0) claimedAny = true;
      } while (kickAgain && generation === kickGeneration);
    } finally {
      if (generation === kickGeneration) kickRunning = false;
    }
    if (generation !== kickGeneration) return; // yerine yeni tur geçti; takip kararı onun
    // Sağlayıcı sınırı (rezervasyon başına 60 sn'de 2 gönderim) ya da yeniden deneme beklemesi yüzünden kalan ELLE cevap: ~61 sn sonra
    // bir takip turu (2 dk'lık senkronu beklemesin). Boş takip turları sınırlı; aynı anda en çok BİR takip zamanlayıcısı (N6).
    emptyFollowUps = claimedAny ? 0 : emptyFollowUps + 1;
    // Gönderim duraklatıldıysa takip turu kurulmaz (boşuna tur; anahtar kalkınca ilk uyandırma ya da periyodik tur alır).
    if (followUpTimer == null && !outboxDeliveryPaused() && emptyFollowUps <= MAX_EMPTY_FOLLOW_UPS && (await pendingManualSoon())) {
      followUpTimer = setTimeout(() => {
        followUpTimer = null;
        kickOutboxDrain(drain);
      }, followUpMs);
      followUpTimer.unref?.();
    }
  };
  // Bütün tur (takip kararı, hata raporu dahil) çağıran isteğin takip numarasını / işletmesini MİRAS ALMAZ (N6; e-posta kuyruğu
  // uyandırmasıyla aynı kural).
  // `.catch` da yeni bağlamın İÇİNDE bağlanır: söz zinciri geri çağrısı, bağlandığı andaki bağlamda koşar.
  void runAsNewSystemOperation(() =>
    loop().catch((err) => {
      void reportError("outbox.kick", err instanceof Error ? err : new Error(String(err))).catch(() => {});
    }),
  );
}

/** Test yardımcısı: takip turu gecikmesi. */
export function __setOutboxKickFollowUpMs(ms: number): void {
  followUpMs = ms;
}

/** Test yardımcısı: uyandırma durumunu sıfırla. */
export function __resetOutboxKick(): void {
  kickRunning = false;
  kickAgain = false;
  kickStartedAt = 0;
  kickGeneration++;
  if (followUpTimer) clearTimeout(followUpTimer);
  followUpTimer = null;
  emptyFollowUps = 0;
  followUpMs = 61_000;
}

/** Test yardımcısı: takılmış turu taklit etmek için başlangıç damgasını geri al. */
export function __ageOutboxKick(ms: number): void {
  kickStartedAt -= ms;
}

