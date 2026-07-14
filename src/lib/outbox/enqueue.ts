import "server-only";

import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";

// ---------------------------------------------------------------------------
// Durable Outbox — atomic enqueue (#8).
//
// Writes the local Message AND the durable send-intent (a MessageOutbox row) in
// ONE transaction, so it is impossible to end up with "the message was recorded
// but the intent to send it was lost" (or the reverse). Dedup is tenant-scoped
// via the @@unique([organizationId, idempotencyKey]) — a retry / double-submit of
// the SAME logical message produces neither a second outbox row nor a second
// Message (the whole transaction rolls back on the unique hit, so no orphan
// Message is left behind).
//
// The Message intentionally carries NO externalId here — that is written ONLY
// after the worker gets a confirmed provider id (or reconciles one), so a queued-
// but-not-yet-sent message can never be mistaken for a delivered one.
// ---------------------------------------------------------------------------

/** Whether the caller is enqueuing a host reply or an AI auto-send (drives authorType). */
export type OutboundAuthor = "host" | "ai";

/**
 * Closed set of outbox message types (migration 30). Drives the worker's DELIVERY EFFECT:
 *   manual | ai        → mark the conversation "answered" on confirmed delivery
 *   holding_ack        → deliver but KEEP the thread in "problem" (never mark answered)
 *   welcome|checkin|checkout → proactive lifecycle: stamp the reservation's *SentAt on delivery
 * A NULL type (legacy / pre-30 rolling deploy) is treated as a reply → mark answered.
 */
export const OUTBOX_MESSAGE_TYPES = [
  "manual",
  "ai",
  "holding_ack",
  "welcome",
  "checkin",
  "checkout",
] as const;
export type OutboxMessageType = (typeof OUTBOX_MESSAGE_TYPES)[number];

export interface EnqueueOutboundArgs {
  organizationId: string;
  conversationId: string;
  /** Delivery channel snapshot (manual | airbnb | booking | ...). */
  channel: string;
  /** Hospitable reservation UUID = the delivery destination (null for internal threads). */
  externalReservationId: string | null;
  reservationId?: string | null;
  /** The exact text to deliver AND store on the Message. */
  body: string;
  senderName: string;
  authorType: OutboundAuthor;
  /** Closed-set delivery-effect discriminator; omit for a plain reply (→ mark answered). */
  messageType?: OutboxMessageType;
  aiAssisted?: boolean;
  /**
   * Optional AI classification metadata, mirrored onto the Message so an auto-reply
   * enqueued through the outbox keeps the SAME reporting/audit fidelity as a direct
   * send (aiIntent/aiConfidence/aiSourcesJson). Omitted for a plain host reply.
   */
  aiIntent?: string | null;
  aiConfidence?: number | null;
  aiSourcesJson?: string | null;
  /**
   * Tenant-scoped idempotency identity of THIS logical send. The caller computes a
   * stable key (e.g. `auto:{conversationId}:{inboundMessageId}` for an AI reply, or a
   * client-supplied UUID for a manual reply). The same key never sends twice.
   */
  idempotencyKey: string;
}

export interface EnqueueResult {
  outboxId: string;
  messageId: string;
  /** True when an identical logical message was already enqueued (no new rows written). */
  deduped: boolean;
}

/**
 * Atomically record a message + its durable send intent. Idempotent on
 * (organizationId, idempotencyKey): a duplicate returns the existing outbox row
 * and writes nothing new.
 */
export async function enqueueOutbound(args: EnqueueOutboundArgs): Promise<EnqueueResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: args.conversationId,
          direction: "outbound",
          authorType: args.authorType,
          senderName: args.senderName,
          body: args.body,
          aiAssisted: args.aiAssisted ?? false,
          // AI metadata (auto-reply / holding-ack) — same fields a direct send stores,
          // so reports/audit are identical whether or not the outbox path is used.
          ...(args.aiIntent != null ? { aiIntent: args.aiIntent } : {}),
          ...(args.aiConfidence != null ? { aiConfidence: args.aiConfidence } : {}),
          ...(args.aiSourcesJson != null ? { aiSourcesJson: args.aiSourcesJson } : {}),
          // No externalId yet — set only after a CONFIRMED send (worker).
        },
        select: { id: true },
      });
      const outbox = await tx.messageOutbox.create({
        data: {
          organizationId: args.organizationId,
          conversationId: args.conversationId,
          messageId: message.id,
          reservationId: args.reservationId ?? null,
          channel: args.channel,
          externalReservationId: args.externalReservationId,
          messageType: args.messageType ?? null,
          body: args.body,
          idempotencyKey: args.idempotencyKey,
          status: "pending",
        },
        select: { id: true },
      });
      // NOTE (Codex #6): the conversation is NOT marked "answered" here. The intent is
      // durable, but the guest has NOT received anything yet — "answered/sent" is set
      // by the worker ONLY once the provider confirms delivery. So a queued-but-
      // undelivered reply never looks delivered.
      return { outboxId: outbox.id, messageId: message.id };
    });
    return { ...result, deduped: false };
  } catch (err) {
    // Dedupe-hit on the tenant-scoped idempotency key: an identical logical send is
    // already enqueued. The transaction rolled back, so NO orphan Message was left.
    if (isUniqueViolation(err, ["organizationId", "idempotencyKey"])) {
      const existing = await prisma.messageOutbox.findFirst({
        where: { organizationId: args.organizationId, idempotencyKey: args.idempotencyKey },
        select: { id: true, messageId: true },
      });
      if (existing) return { outboxId: existing.id, messageId: existing.messageId ?? "", deduped: true };
    }
    throw err;
  }
}

/**
 * Whether a terminal `failed` outbox row is safe to RESURRECT (re-queue) — true ONLY for a
 * transient/recoverable provider state: a Hospitable 402 "subscription not active" outage. A
 * validation/auth/not-found 4xx (400/401/403/404/409/422 …) is permanent for this exact request,
 * so it must never loop. `errorCode()` (worker) writes the code as "HTTP <n>".
 */
export function isRetryableFailure(lastErrorCode: string | null): boolean {
  return lastErrorCode === "HTTP 402";
}

export interface EnqueueProactiveArgs {
  organizationId: string;
  /** Hospitable reservation UUID = the delivery destination. */
  externalReservationId: string;
  reservationId: string;
  channel: string;
  /** welcome | checkin | checkout — the worker stamps the matching reservation *SentAt on delivery. */
  messageType: Extract<OutboxMessageType, "welcome" | "checkin" | "checkout">;
  body: string;
  /** Deterministic identity: {type}:{org}:{reservation-anchor} — replay/restart never sends twice. */
  idempotencyKey: string;
}

export interface EnqueueProactiveResult {
  outboxId: string;
  deduped: boolean;
}

/**
 * Enqueue a PROACTIVE lifecycle send (welcome / check-in / check-out). Unlike a reply, this
 * has NO conversation and NO local Message — it is a pure durable send-intent keyed to a
 * reservation. The reservation's *SentAt is stamped ONLY by the worker on confirmed delivery
 * (never here), and the deterministic idempotencyKey (via the tenant-scoped unique constraint)
 * makes a scheduler replay or a process restart a clean dedupe-hit rather than a second message.
 */
export async function enqueueProactive(args: EnqueueProactiveArgs): Promise<EnqueueProactiveResult> {
  try {
    const outbox = await prisma.messageOutbox.create({
      data: {
        organizationId: args.organizationId,
        conversationId: null, // proactive: no thread
        messageId: null, //      proactive: no local Message (sync re-imports it later, as today)
        reservationId: args.reservationId,
        channel: args.channel,
        externalReservationId: args.externalReservationId,
        messageType: args.messageType,
        body: args.body,
        idempotencyKey: args.idempotencyKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { outboxId: outbox.id, deduped: false };
  } catch (err) {
    if (isUniqueViolation(err, ["organizationId", "idempotencyKey"])) {
      const existing = await prisma.messageOutbox.findFirst({
        where: { organizationId: args.organizationId, idempotencyKey: args.idempotencyKey },
        select: { id: true, status: true, lastErrorCode: true },
      });
      if (existing) {
        // RESURRECT a proactive send that failed for a RETRYABLE-and-not-delivered reason — a
        // Hospitable OUTAGE / 402 "subscription not active" (Nuve's current state). The flag-OFF
        // sender retries such a booking every run until it succeeds, so the outbox must too, or
        // turning the flag ON would silently LOSE every lifecycle message queued during the outage
        // even after recovery (Review-1). STRICTLY guarded: only status `failed` AND a retryable
        // error code — a terminal validation/auth 4xx (400/401/403/404/422 …) must NOT enter a
        // resurrection loop (the request will always fail); and a `review`/ambiguous row MAY have
        // reached the guest, so it stays parked (never blind-resent). Idempotent under the status
        // guard — a concurrent claim/settle can't be clobbered.
        if (existing.status === "failed" && isRetryableFailure(existing.lastErrorCode)) {
          await prisma.messageOutbox
            .updateMany({
              where: { id: existing.id, status: "failed" },
              data: {
                status: "pending",
                attemptCount: 0,
                availableAt: new Date(),
                claimedBy: null,
                claimExpiresAt: null,
                lastErrorKind: null,
                lastErrorCode: null,
              },
            })
            .catch(() => {});
        }
        return { outboxId: existing.id, deduped: true };
      }
    }
    throw err;
  }
}
