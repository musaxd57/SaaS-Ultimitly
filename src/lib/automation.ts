import "server-only";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { classifyMessage, suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import {
  complaintEscalationEmail,
  reservationCreatedEmail,
} from "@/lib/email-templates";
import type { ReplyTone } from "@/lib/constants";

const VALID_TONES: ReplyTone[] = ["formal", "warm", "short", "luxury"];

// Auto-reply only fires when the AI is confident AND the message is safe. The
// deterministic fallback never reaches this bar (it caps safe intents at 0.55),
// so auto-reply effectively requires a real model response — by design.
const AUTO_REPLY_MIN_CONFIDENCE = 0.7;

/** Only safe, confident drafts may be auto-sent; everything else waits for a human. */
function passesAutoReplySafetyGate(result: {
  riskLevel: string;
  confidence: number;
}): boolean {
  if (result.riskLevel !== "none" && result.riskLevel !== "low") return false;
  return result.confidence >= AUTO_REPLY_MIN_CONFIDENCE;
}

/** Current hour (0-23) in the given IANA timezone (e.g. "Europe/Istanbul"). */
export function currentHourInTimeZone(timeZone: string, now: Date = new Date()): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now);
    const hour = parseInt(formatted, 10) % 24;
    return Number.isNaN(hour) ? now.getHours() : hour;
  } catch {
    return now.getHours();
  }
}

/**
 * Is `hour` inside the [startHour, endHour) window?
 *   start === end → always true (full day)
 *   start <  end  → same-day window (e.g. 9–18)
 *   start >  end  → window that wraps past midnight (e.g. 22–6)
 */
export function isWithinActiveHours(startHour: number, endHour: number, hour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

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

// ---------------------------------------------------------------------------
// Channel (Airbnb / Booking via Hospitable) AI auto-reply
//
// Unlike WhatsApp (which is webhook-driven and instant), channel messages are
// pulled in by sync (polling). So channel auto-reply runs as a pass after each
// sync, gated to an active-hours window in the org timezone — e.g. answer guests
// automatically only between 00:00 and 09:00. It SENDS first (via the same
// transport as manual replies) and only persists when delivery succeeds, so we
// never record a reply that didn't reach the guest. Complaints, risky, and
// low-confidence messages are always left for a human.
// ---------------------------------------------------------------------------

export interface ChannelAutoReplyOptions {
  /** Compute the draft but do not send or persist (preview / test). */
  dryRun?: boolean;
  /** Skip the active-hours window check (used by the preview). */
  ignoreSchedule?: boolean;
  /** Skip the org on/off toggle check (used by the preview). */
  ignoreToggle?: boolean;
}

export interface ChannelAutoReplyOutcome {
  sent: boolean;
  /** Why no message was sent (when sent=false). */
  skippedReason?: string;
  /** The AI draft, when one was produced (dry-run preview or before sending). */
  draft?: { reply: string; intent: string; confidence: number; riskLevel: string };
  guestIdentifier?: string;
  propertyName?: string;
}

/**
 * Evaluate (and unless dryRun, deliver) an AI auto-reply for a single channel
 * conversation. All safety gates are re-checked here, so callers can pass a
 * broad candidate set safely.
 */
export async function applyChannelAutoReply(
  conversationId: string,
  options: ChannelAutoReplyOptions = {},
): Promise<ChannelAutoReplyOutcome> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      property: {
        select: {
          name: true,
          checkInTime: true,
          checkOutTime: true,
          address: true,
          city: true,
          organization: {
            select: {
              autoReplyHospitable: true,
              language: true,
              timezone: true,
              autoReplyStartHour: true,
              autoReplyEndHour: true,
              aiReplyTone: true,
              aiSignature: true,
            },
          },
        },
      },
      reservation: {
        select: { guestName: true, arrivalDate: true, departureDate: true, status: true },
      },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) return { sent: false, skippedReason: "not_found" };
  const meta = { guestIdentifier: conversation.guestIdentifier, propertyName: conversation.property.name };
  const org = conversation.property.organization;

  // Must be a conversation we can actually reply to on its channel.
  if (!conversation.externalReservationId) return { sent: false, skippedReason: "no_external_target", ...meta };
  // A complaint has already escalated to a human — never auto-reply to it.
  if (conversation.status === "problem") return { sent: false, skippedReason: "complaint", ...meta };

  if (!options.ignoreToggle && !org.autoReplyHospitable) {
    return { sent: false, skippedReason: "disabled", ...meta };
  }
  if (!options.ignoreSchedule) {
    const hour = currentHourInTimeZone(org.timezone);
    if (!isWithinActiveHours(org.autoReplyStartHour, org.autoReplyEndHour, hour)) {
      return { sent: false, skippedReason: "outside_hours", ...meta };
    }
  }

  const messages = conversation.messages;
  if (messages.length === 0) return { sent: false, skippedReason: "no_messages", ...meta };
  const last = messages[messages.length - 1];
  // Only answer when the guest spoke last (don't reply to ourselves).
  if (last.direction !== "inbound") return { sent: false, skippedReason: "already_answered", ...meta };

  const kb = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId: conversation.propertyId, isActive: true },
    select: { category: true, title: true, content: true },
  });

  const result = await suggestReply({
    guestMessage: last.body,
    property: {
      name: conversation.property.name,
      checkInTime: conversation.property.checkInTime,
      checkOutTime: conversation.property.checkOutTime,
      address: conversation.property.address,
      city: conversation.property.city,
    },
    reservation: conversation.reservation
      ? {
          guestName: conversation.reservation.guestName,
          arrivalDate: conversation.reservation.arrivalDate,
          departureDate: conversation.reservation.departureDate,
          status: conversation.reservation.status,
        }
      : null,
    knowledgeBase: kb,
    history: messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
    tone: VALID_TONES.includes(org.aiReplyTone as ReplyTone)
      ? (org.aiReplyTone as ReplyTone)
      : "warm",
    language: org.language ?? "tr",
  });

  // Close every reply in the host's voice: append their configured signature
  // (name + contact) so guests get a personal, on-brand sign-off. Build a new
  // string — never mutate the AI result object (it may be shared / reused).
  const signature = org.aiSignature?.trim();
  const replyText =
    signature && result.reply ? `${result.reply.trimEnd()}\n\n${signature}` : result.reply;

  // Safety gate: only auto-send safe, confident replies.
  if (!passesAutoReplySafetyGate(result)) {
    return { sent: false, skippedReason: "low_confidence_or_risky", ...meta };
  }

  const draft = {
    reply: replyText,
    intent: result.intent,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
  };

  if (options.dryRun) {
    return { sent: false, skippedReason: "dry_run", draft, ...meta };
  }

  // GLOBAL MASTER KILL-SWITCH. Auto-replies are NEVER sent unless the
  // deployment explicitly sets AUTO_REPLY_ENABLED=1. This is a hard, env-level
  // guarantee on top of the per-org toggle and the active-hours window: with the
  // variable unset (the default), no automatic message can ever leave the
  // system — previews/tests still work, the AI just never delivers.
  if (process.env.AUTO_REPLY_ENABLED !== "1") {
    return { sent: false, skippedReason: "globally_disabled", draft, ...meta };
  }

  // Anti-spam rate limit: never send more than one message per hour to the same
  // guest. Protects the account from Airbnb/Booking spam penalties.
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const lastOutbound = [...messages].reverse().find((m) => m.direction === "outbound");
  if (lastOutbound && Date.now() - new Date(lastOutbound.createdAt).getTime() < ONE_HOUR_MS) {
    return { sent: false, skippedReason: "rate_limited", draft, ...meta };
  }

  // Deliver FIRST — never persist a reply that didn't reach the guest.
  const delivery = await sendOnChannel(
    {
      channel: conversation.channel,
      guestIdentifier: conversation.guestIdentifier,
      externalReservationId: conversation.externalReservationId,
    },
    replyText,
  );
  if (!delivery.ok) {
    return { sent: false, skippedReason: `send_failed: ${delivery.error ?? "unknown"}`, draft, ...meta };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "outbound",
        senderName: "GuestOps AI",
        body: replyText,
        aiIntent: result.intent,
        aiConfidence: result.confidence,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "answered", lastMessageAt: now },
    }),
  ]);

  return { sent: true, draft, ...meta };
}

/**
 * Run the channel auto-reply pass for an organization: if enabled AND we are
 * inside the active-hours window, auto-answer every channel conversation whose
 * last message is an unanswered guest message. Called after each sync.
 */
export async function runDueChannelAutoReplies(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      autoReplyHospitable: true,
      timezone: true,
      autoReplyStartHour: true,
      autoReplyEndHour: true,
    },
  });
  // Global master kill-switch (see applyChannelAutoReply): nothing is ever sent
  // unless AUTO_REPLY_ENABLED=1 is set on the deployment. Short-circuit here so
  // the cron pass does no AI work at all while auto-reply is globally disabled.
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  if (!org || !org.autoReplyHospitable) return { sent: 0, considered: 0 };

  const hour = currentHourInTimeZone(org.timezone);
  if (!isWithinActiveHours(org.autoReplyStartHour, org.autoReplyEndHour, hour)) {
    return { sent: 0, considered: 0 };
  }

  // "new" = the guest spoke last and we haven't answered (see hospitable-sync).
  const candidates = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      externalReservationId: { not: null },
      status: "new",
    },
    select: { id: true },
  });

  let sent = 0;
  for (const c of candidates) {
    const outcome = await applyChannelAutoReply(c.id);
    if (outcome.sent) sent++;
  }
  return { sent, considered: candidates.length };
}

/**
 * Preview what the channel auto-reply WOULD send right now — without sending
 * anything. Ignores the on/off toggle and the active-hours window so the user
 * can test quality at any time. Returns one outcome per candidate conversation.
 */
export async function previewChannelAutoReplies(
  organizationId: string,
  limit = 12,
): Promise<ChannelAutoReplyOutcome[]> {
  const candidates = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      externalReservationId: { not: null },
      status: "new",
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: { id: true },
  });

  const outcomes: ChannelAutoReplyOutcome[] = [];
  for (const c of candidates) {
    outcomes.push(
      await applyChannelAutoReply(c.id, { dryRun: true, ignoreSchedule: true, ignoreToggle: true }),
    );
  }
  return outcomes;
}
