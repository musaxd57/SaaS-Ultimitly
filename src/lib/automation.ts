import "server-only";
import { startOfDay, addDays } from "date-fns";
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
  // The guest's stay is over (or the booking was cancelled) — the AI has no
  // business replying to a finished reservation.
  if (conversation.reservation) {
    if (conversation.reservation.status === "cancelled") {
      return { sent: false, skippedReason: "reservation_ended", ...meta };
    }
    if (conversation.reservation.departureDate < startOfDay(new Date())) {
      return { sent: false, skippedReason: "reservation_ended", ...meta };
    }
  }

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

  const kbRaw = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId: conversation.propertyId, isActive: true },
    select: { category: true, title: true, content: true },
  });
  // Resolve any {isim} placeholder in KB entries (e.g. the welcome template) to
  // the guest's name before it reaches the model, so a literal "{isim}" can
  // never leak into a reply.
  const guestFirst = guestFirstName(conversation.guestIdentifier) ?? "misafirimiz";
  const kb = kbRaw.map((k) => ({
    ...k,
    content: k.content.replace(/\{\s*(isim|ad|name)\s*\}/gi, guestFirst),
  }));

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

  // No hourly cap: the system only ever replies to the guest's latest UNANSWERED
  // message (see the "already_answered" guard above), never initiates, and stays
  // silent on non-questions (low confidence) — so each guest message gets at most
  // one reply and nothing unsolicited goes out.

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
      autoReplyEnabledAt: true,
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
  // Only answer messages that arrived AFTER auto-reply was switched on — never
  // the pre-existing backlog. Falls back to a 48h window if the timestamp is
  // missing (legacy orgs).
  const freshSince = org.autoReplyEnabledAt ?? new Date(Date.now() - 48 * 60 * 60 * 1000);
  const candidates = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      externalReservationId: { not: null },
      status: "new",
      lastMessageAt: { gte: freshSince },
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

/** First name for the greeting, or null for placeholder names (no real name). */
function guestFirstName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0];
  if (!first || first === "Rezervasyon" || first === "Misafir") return null;
  return first;
}

/** Calendar date (YYYY-MM-DD) of `d` as seen in the given IANA timezone. */
function dateKeyInTimeZone(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** The reservation's check-in calendar date (stored as UTC midnight of that date). */
function arrivalDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Placeholder the host can drop into a welcome template — {isim} / {ad} / {name}
// — replaced with the guest's first name when the message is sent.
function hasNamePlaceholder(s: string): boolean {
  return /\{\s*(isim|ad|name)\s*\}/i.test(s); // fresh, non-global → no lastIndex footgun
}

/**
 * Build the welcome message body. If the host's template contains a {isim}
 * placeholder, substitute the name and send it verbatim (their own greeting +
 * sign-off). Otherwise prepend a greeting and append the org signature.
 */
function buildGuestMessageBody(content: string, firstName: string, signature?: string): string {
  const trimmed = content.trim();
  if (hasNamePlaceholder(trimmed)) {
    return trimmed.replace(/\{\s*(isim|ad|name)\s*\}/gi, firstName);
  }
  return [`Merhaba ${firstName},`, "", trimmed, ...(signature ? ["", signature] : [])].join("\n");
}

/**
 * Send the per-apartment welcome message for upcoming reservations that haven't
 * received one yet. The body is built from the apartment's "welcome" knowledge
 * base entry, personalised with the guest's first name and closed with the org
 * signature. Sent at most ONCE per reservation (welcomeSentAt), only for stays
 * arriving in the near future (never blasts past guests), and only when BOTH the
 * global kill-switch (AUTO_REPLY_ENABLED=1) and the org's autoWelcome toggle are
 * on. Apartments without a welcome entry are skipped.
 */
export async function sendDueWelcomes(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoWelcome: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoWelcome) return { sent: 0, considered: 0 };

  // Send exactly on the guest's check-in DAY (org timezone): at 00:00 of the
  // arrival date. The cron runs every few minutes, so it fires right after
  // midnight. Scan a small window around now, then match the exact calendar day.
  const now = new Date();
  const tz = org.timezone ?? "Europe/Istanbul";
  const todayKey = dateKeyInTimeZone(now, tz);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      welcomeSentAt: null,
      sourceReference: { not: null },
      arrivalDate: { gte: addDays(startOfDay(now), -1), lt: addDays(startOfDay(now), 2) },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      arrivalDate: true,
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { arrivalDate: "asc" },
    take: 25, // cap per run so enabling the toggle can't cause a huge burst
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;

  for (const r of reservations) {
    // Only on the check-in day itself.
    if (arrivalDateKey(r.arrivalDate) !== todayKey) continue;

    const welcome = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "welcome", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!welcome) continue; // this apartment has no welcome text → skip

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(welcome.content, firstName, signature);

    const delivery = await sendOnChannel(
      {
        channel: r.channel,
        guestIdentifier: r.guestName,
        externalReservationId: r.sourceReference,
      },
      body,
    );
    if (!delivery.ok) continue; // try again next run; do not mark as sent

    // Mark every row for this booking (handles any duplicate reservation rows).
    await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId } },
      data: { welcomeSentAt: new Date() },
    });
    sent++;
  }

  return { sent, considered: reservations.length };
}

export interface WelcomePreview {
  guest: string;
  property: string;
  hasEntry: boolean;
  alreadySent: boolean;
  body: string | null;
}

/**
 * Preview the welcome message for upcoming reservations WITHOUT sending — the
 * exact text that would go out (placeholder substituted). Ignores the on/off
 * toggles so the host can review quality before going live. Flags apartments
 * that are missing a welcome entry and reservations already welcomed.
 */
export async function previewWelcomes(
  organizationId: string,
  limit = 12,
): Promise<WelcomePreview[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiSignature: true },
  });
  const signature = org?.aiSignature?.trim();

  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      sourceReference: { not: null },
      arrivalDate: { gte: startOfDay(now), lte: horizon },
    },
    select: {
      guestName: true,
      propertyId: true,
      welcomeSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { arrivalDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const welcome = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "welcome", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(welcome),
      alreadySent: Boolean(r.welcomeSentAt),
      body: welcome ? buildGuestMessageBody(welcome.content, firstName, signature) : null,
    });
  }
  return previews;
}

/**
 * Send the per-apartment check-out message on the guest's DEPARTURE day, at/after
 * 08:00 in the org timezone, once per reservation (checkoutSentAt). Body comes
 * from the apartment's "checkout" knowledge-base entry, personalised with the
 * guest's first name. Gated behind AUTO_REPLY_ENABLED + the org autoCheckout
 * toggle. Apartments without a checkout entry are skipped.
 */
export async function sendDueCheckouts(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoCheckout: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoCheckout) return { sent: 0, considered: 0 };

  const now = new Date();
  const tz = org.timezone ?? "Europe/Istanbul";
  // Only from 08:00 onward on the departure day.
  if (currentHourInTimeZone(tz, now) < 8) return { sent: 0, considered: 0 };
  const todayKey = dateKeyInTimeZone(now, tz);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      checkoutSentAt: null,
      sourceReference: { not: null },
      departureDate: { gte: addDays(startOfDay(now), -1), lt: addDays(startOfDay(now), 2) },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      departureDate: true,
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { departureDate: "asc" },
    take: 25,
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;

  for (const r of reservations) {
    if (arrivalDateKey(r.departureDate) !== todayKey) continue; // only on the check-out day

    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkout", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!tpl) continue;

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(tpl.content, firstName, signature);

    const delivery = await sendOnChannel(
      { channel: r.channel, guestIdentifier: r.guestName, externalReservationId: r.sourceReference },
      body,
    );
    if (!delivery.ok) continue;

    // Mark every row for this booking (handles any duplicate reservation rows).
    await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId } },
      data: { checkoutSentAt: new Date() },
    });
    sent++;
  }

  return { sent, considered: reservations.length };
}

/** Preview check-out messages for upcoming departures (no sending). */
export async function previewCheckouts(
  organizationId: string,
  limit = 12,
): Promise<WelcomePreview[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiSignature: true },
  });
  const signature = org?.aiSignature?.trim();
  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      sourceReference: { not: null },
      departureDate: { gte: startOfDay(now), lte: horizon },
    },
    select: {
      guestName: true,
      propertyId: true,
      checkoutSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { departureDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkout", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(tpl),
      alreadySent: Boolean(r.checkoutSentAt),
      body: tpl ? buildGuestMessageBody(tpl.content, firstName, signature) : null,
    });
  }
  return previews;
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
