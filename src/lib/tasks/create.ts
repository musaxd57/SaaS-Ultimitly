import "server-only";

import { prisma } from "@/lib/db";
import { detectOperationalTask, buildOperationalTaskData } from "./detect";

export type CreateOperationalTaskResult =
  | { status: "created"; taskId: string; type: string }
  | { status: "duplicate" }
  | { status: "none" };

/**
 * From an inbound guest message, create ONE operational task (maintenance /
 * restock / cleaning) if the message warrants it — deduped so repeated messages
 * about the same issue at the same property on the same day don't pile up.
 *
 * Best-effort by design: the caller's escalation (mark "problem" + email the
 * host) must never depend on this. Callers should still guard with .catch, but
 * the dedupe read + create are the only DB touches and both are cheap.
 */
export async function createOperationalTaskFromMessage(ctx: {
  propertyId: string;
  message: string;
  sourceMessageId?: string | null;
  reservationId?: string | null;
  ai?: { intent?: string | null; riskType?: string | null };
  now?: Date;
}): Promise<CreateOperationalTaskResult> {
  const detected = detectOperationalTask(ctx.message, ctx.ai ?? {});
  if (!detected) return { status: "none" };

  const data = buildOperationalTaskData(detected, {
    propertyId: ctx.propertyId,
    message: ctx.message,
    now: ctx.now,
  });

  // Intra-day dedupe: skip if an OPEN task with the same key already exists. Non-
  // atomic (findFirst-then-create), matching the codebase's other task creators;
  // a rare concurrent double-escalation could still make two — acceptable at this
  // frequency, and the index keeps the lookup cheap.
  const existing = await prisma.task.findFirst({
    where: { dedupeKey: data.dedupeKey, status: { not: "done" } },
    select: { id: true },
  });
  if (existing) return { status: "duplicate" };

  const task = await prisma.task.create({
    data: {
      propertyId: ctx.propertyId,
      reservationId: ctx.reservationId ?? null,
      type: data.type,
      origin: "ai",
      title: data.title,
      description: data.description,
      dueAt: data.dueAt,
      priority: data.priority,
      status: "todo",
      dedupeKey: data.dedupeKey,
      sourceMessageId: ctx.sourceMessageId ?? null,
    },
  });
  return { status: "created", taskId: task.id, type: data.type };
}
