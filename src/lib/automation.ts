import "server-only";
import { prisma } from "@/lib/db";
import { classifyMessage } from "@/lib/ai";

// Simple, fixed if/then automation engine (no queue/Zapier-style builder for MVP).
// Each function represents a trigger handler.

/** Reservation created → prepare check-in & checkout cleaning tasks. */
export async function applyReservationCreatedRules(reservationId: string): Promise<void> {
  const r = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!r || r.status === "cancelled") return;

  await prisma.task.createMany({
    data: [
      {
        propertyId: r.propertyId,
        reservationId: r.id,
        type: "checkin_prep",
        title: `${r.guestName} girişi için hazırlık`,
        description: "Hoş geldin hazırlığı, anahtar/giriş kontrolü.",
        dueAt: r.arrivalDate,
        status: "todo",
        priority: "standard",
      },
      {
        propertyId: r.propertyId,
        reservationId: r.id,
        type: "cleaning",
        title: `Çıkış temizliği - ${r.guestName}`,
        description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi.",
        dueAt: r.departureDate,
        status: "todo",
        priority: "standard",
      },
    ],
  });
}

export interface InboundRuleResult {
  intent: string;
  priority: string;
  isComplaint: boolean;
}

/**
 * Inbound guest message received → classify, set conversation priority/status,
 * and on complaint, escalate (mark problem + open a maintenance task).
 */
export async function applyInboundMessageRules(
  conversationId: string,
  messageBody: string,
): Promise<InboundRuleResult> {
  const result = await classifyMessage(messageBody);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, propertyId: true, guestIdentifier: true, status: true },
  });
  if (!conversation) {
    return { intent: result.intent, priority: result.priority, isComplaint: result.isComplaint };
  }

  if (result.isComplaint) {
    await prisma.$transaction([
      prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "problem", priority: "urgent" },
      }),
      prisma.task.create({
        data: {
          propertyId: conversation.propertyId,
          type: "maintenance",
          title: `Şikayet: ${conversation.guestIdentifier}`,
          description: messageBody.slice(0, 500),
          status: "todo",
          priority: "urgent",
        },
      }),
    ]);
  } else if (conversation.status === "closed" || conversation.status === "answered") {
    // Re-open as needing attention when a new inbound arrives.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "new", priority: result.priority },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { priority: result.priority },
    });
  }

  return { intent: result.intent, priority: result.priority, isComplaint: result.isComplaint };
}
