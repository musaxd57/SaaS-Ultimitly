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
