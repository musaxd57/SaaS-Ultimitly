import "server-only";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { classifyMessage } from "@/lib/ai";
import { emailService } from "@/lib/email";
import {
  complaintEscalationEmail,
  reservationCreatedEmail,
} from "@/lib/email-templates";

// Simple, fixed if/then automation engine (no queue/Zapier-style builder for MVP).
// Each function represents a trigger handler.

/**
 * Create the standard check-in prep + checkout cleaning tasks for a reservation.
 * Idempotent: skips entirely if the reservation already has tasks (so it is safe
 * to call on every iCal re-sync). Past-dated stays are ignored — only upcoming
 * arrivals/departures generate work. Returns the number of tasks created.
 */
export async function createReservationTasks(reservationId: string): Promise<number> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      propertyId: true,
      guestName: true,
      arrivalDate: true,
      departureDate: true,
      status: true,
    },
  });
  if (!r || r.status === "cancelled") return 0;

  // Already has tasks → don't duplicate (handles repeated syncs).
  const existing = await prisma.task.count({ where: { reservationId: r.id } });
  if (existing > 0) return 0;

  const todayStart = startOfDay(new Date());
  const data: {
    propertyId: string;
    reservationId: string;
    type: string;
    title: string;
    description: string;
    dueAt: Date;
    status: string;
    priority: string;
  }[] = [];

  if (r.arrivalDate >= todayStart) {
    data.push({
      propertyId: r.propertyId,
      reservationId: r.id,
      type: "checkin_prep",
      title: `${r.guestName} girişi için hazırlık`,
      description: "Hoş geldin hazırlığı, anahtar/giriş kontrolü.",
      dueAt: r.arrivalDate,
      status: "todo",
      priority: "standard",
    });
  }
  if (r.departureDate >= todayStart) {
    data.push({
      propertyId: r.propertyId,
      reservationId: r.id,
      type: "cleaning",
      title: `Çıkış temizliği - ${r.guestName}`,
      description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi.",
      dueAt: r.departureDate,
      status: "todo",
      priority: "standard",
    });
  }

  if (data.length === 0) return 0;
  await prisma.task.createMany({ data });
  return data.length;
}

/**
 * Backfill tasks for every existing reservation in an organization.
 * Used when reservations were imported (e.g. via iCal) before task automation
 * existed. Idempotent: createReservationTasks skips reservations that already
 * have tasks and ignores past-dated stays. Returns how many were processed and
 * how many tasks were actually created.
 */
export async function backfillReservationTasks(
  organizationId: string,
): Promise<{ processed: number; created: number }> {
  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { not: "cancelled" },
    },
    select: { id: true },
  });

  let created = 0;
  for (const r of reservations) {
    created += await createReservationTasks(r.id);
  }
  return { processed: reservations.length, created };
}

/** Reservation created → prepare check-in & checkout cleaning tasks + notify owners. */
export async function applyReservationCreatedRules(reservationId: string): Promise<void> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      property: { select: { name: true, address: true, city: true, organizationId: true } },
    },
  });
  if (!r || r.status === "cancelled") return;

  await createReservationTasks(r.id);

  // Fetch all owner/manager users in this organization for the reservation email.
  const orgUsers = await prisma.user.findMany({
    where: {
      organizationId: r.property.organizationId,
      role: { in: ["owner", "manager"] },
    },
    select: { email: true, name: true },
  });

  const propertyData = {
    name: r.property.name,
    address: r.property.address,
    city: r.property.city,
  };

  const orgRecord = await prisma.organization.findUnique({
    where: { id: r.property.organizationId },
    select: { name: true },
  });

  const html = reservationCreatedEmail(
    {
      id: r.id,
      guestName: r.guestName,
      guestEmail: r.guestEmail,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      channel: r.channel,
      status: r.status,
      totalAmount: r.totalAmount,
      currency: r.currency,
      notes: r.notes,
    },
    propertyData,
    orgRecord?.name ?? "GuestOps",
  );

  for (const user of orgUsers) {
    void emailService.send(
      user.email,
      `Yeni Rezervasyon: ${r.guestName} — ${r.property.name}`,
      html,
    );
  }
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
    select: {
      id: true,
      propertyId: true,
      guestIdentifier: true,
      status: true,
      channel: true,
      priority: true,
      property: {
        select: { name: true, address: true, city: true, organizationId: true },
      },
    },
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

    // Email all owner/manager users in the organization about the complaint.
    const orgUsers = await prisma.user.findMany({
      where: {
        organizationId: conversation.property.organizationId,
        role: { in: ["owner", "manager"] },
      },
      select: { email: true, name: true },
    });

    const orgRecord = await prisma.organization.findUnique({
      where: { id: conversation.property.organizationId },
      select: { name: true },
    });

    const html = complaintEscalationEmail(
      {
        id: conversation.id,
        guestIdentifier: conversation.guestIdentifier,
        channel: conversation.channel,
        priority: "urgent",
      },
      messageBody,
      {
        name: conversation.property.name,
        address: conversation.property.address,
        city: conversation.property.city,
      },
      orgRecord?.name ?? "GuestOps",
    );

    for (const user of orgUsers) {
      void emailService.send(
        user.email,
        `Acil Şikayet: ${conversation.guestIdentifier} — ${conversation.property.name}`,
        html,
      );
    }
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
