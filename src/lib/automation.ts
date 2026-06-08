import "server-only";
import { startOfDay, addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { classifyMessage, suggestReply, summarizeHostStyle } from "@/lib/ai";
import { classifyFallback } from "@/lib/ai/fallback";
import { sendOnChannel } from "@/lib/messaging";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { getAdjacency } from "@/lib/turnover";
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

// HARD BLOCK: these intents touch money / cancellation / a complaint and must
// ALWAYS be handled by a human — never auto-sent, even if the model under-rates
// the risk as "low". This is a belt-and-suspenders on top of the riskLevel gate.
const NEVER_AUTO_REPLY_INTENTS = new Set(["complaint", "refund", "early_departure"]);

/** Only safe, confident drafts may be auto-sent; everything else waits for a human. */
function passesAutoReplySafetyGate(
  result: {
    intent: string;
    riskLevel: string;
    confidence: number;
    source: string;
  },
  guestMessage: string,
): boolean {
  // Never auto-send the deterministic fallback: it can't honour the language /
  // nuance rules the model follows, so if the model is unavailable we wait for a
  // human instead of sending a canned message.
  if (result.source !== "openai") return false;
  // Sensitive intents always go to a human (refund/cancellation/complaint).
  if (NEVER_AUTO_REPLY_INTENTS.has(result.intent)) return false;
  // CROSS-CHECK the model against the deterministic keyword detector: if the
  // guest's OWN words clearly signal a complaint, refund, or early-departure/
  // cancellation, never auto-send — even when the model under-rated it as a
  // benign, low-risk intent. This catches the dangerous misclassification case
  // (an angry or money/cancellation message labelled e.g. "amenity"/"general").
  const fb = classifyFallback(guestMessage);
  if (fb.isComplaint || fb.intent === "refund" || fb.intent === "early_departure") {
    return false;
  }
  if (result.riskLevel !== "none" && result.riskLevel !== "low") return false;
  return result.confidence >= AUTO_REPLY_MIN_CONFIDENCE;
}

// A short, warm note (in the guest's language) appended to AUTO-sent replies so
// the guest knows the message was machine-prepared and a human will correct any
// slip. Manual replies (host-reviewed) never carry it. Set AUTO_REPLY_DISCLOSURE=0
// to turn it off.
function automatedReplyNote(lang: string | undefined): string | null {
  if (process.env.AUTO_REPLY_DISCLOSURE === "0") return null;
  const l = (lang ?? "en").slice(0, 2).toLowerCase();
  const notes: Record<string, string> = {
    tr: "(Bu yanıt otomatik asistanımızca hazırlandı; bir hata olursa ekibimiz hemen düzeltir.)",
    en: "(This reply was prepared by our automated assistant; if anything looks off, our team will fix it right away.)",
    de: "(Diese Antwort wurde von unserem automatischen Assistenten erstellt; bei Fehlern hilft unser Team sofort.)",
    fr: "(Cette réponse a été préparée par notre assistant automatique ; en cas d'erreur, notre équipe corrige aussitôt.)",
    ar: "(تم إعداد هذا الرد بواسطة مساعدنا الآلي؛ وإذا حدث أي خطأ فسيصححه فريقنا فورًا.)",
    ru: "(Этот ответ подготовлен нашим автоматическим ассистентом; если что-то не так, команда сразу поправит.)",
  };
  return notes[l] ?? notes.en;
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
          organizationId: true,
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
              aiStyleProfile: true,
            },
          },
        },
      },
      reservation: {
        select: {
          id: true,
          guestName: true,
          arrivalDate: true,
          departureDate: true,
          status: true,
          guestCheckoutTime: true,
        },
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
  // Human-handoff hold: the guest asked to speak to the host, so we already sent a
  // holding reply and paused the AI for a while to let the host take over.
  if (conversation.autoReplyHoldUntil && conversation.autoReplyHoldUntil > new Date()) {
    return { sent: false, skippedReason: "human_hold", ...meta };
  }
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
    content: fillPlaceholders(k.content, guestFirst, conversation.property.name),
  }));

  // Turnover context so early-checkin / late-checkout answers are data-driven.
  const adjacency = conversation.reservation
    ? await getAdjacency(
        conversation.propertyId,
        conversation.reservation.arrivalDate,
        conversation.reservation.departureDate,
      )
    : null;

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
          guestCheckoutTime: conversation.reservation.guestCheckoutTime,
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
    styleProfile: org.aiStyleProfile,
    adjacency,
  });

  // If the guest stated their own departure time, record it on the reservation
  // so the dashboard can show it (falling back to the property default). Guarded
  // and best-effort — never blocks the reply.
  if (result.statedCheckoutTime && conversation.reservation) {
    try {
      await prisma.reservation.update({
        where: { id: conversation.reservation.id },
        data: { guestCheckoutTime: result.statedCheckoutTime },
      });
    } catch {
      // ignore — not critical to the reply
    }
  }

  // Close every reply in the host's voice: append their configured signature
  // (name + contact) so guests get a personal, on-brand sign-off. Build a new
  // string — never mutate the AI result object (it may be shared / reused).
  const signature = org.aiSignature?.trim();
  // Draft / manual "AI suggest" stays clean: the host's words + their signature.
  const replyText =
    signature && result.reply ? `${result.reply.trimEnd()}\n\n${signature}` : result.reply;
  // The GUEST-FACING body of an AUTO-send also carries a short machine-prepared
  // note in the guest's language, so a guest can account for the rare mistake. The
  // note sits ABOVE the host's signature so the personal sign-off still closes the
  // message (a robotic disclaimer shouldn't be the last line). Draft/preview and
  // the manual "AI suggest" path stay clean — only the auto-send carries it.
  const note = automatedReplyNote(result.detectedLanguage);
  const outboundParts = [result.reply.trimEnd()];
  if (note) outboundParts.push(note);
  if (signature) outboundParts.push(signature);
  const outboundBody = outboundParts.join("\n\n");

  // Safety gate: only auto-send safe, confident replies (cross-checked against
  // the guest's own words, so a mislabelled complaint/refund never slips through).
  if (!passesAutoReplySafetyGate(result, last.body)) {
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

  // Deliver FIRST — never persist a reply that didn't reach the guest. Use THIS
  // org's own Hospitable token; if it isn't connected, there is nothing to send.
  const token = await getOrgHospitableToken(conversation.property.organizationId);
  if (!token) {
    return { sent: false, skippedReason: "not_connected", draft, ...meta };
  }
  const delivery = await sendOnChannel(
    {
      channel: conversation.channel,
      guestIdentifier: conversation.guestIdentifier,
      externalReservationId: conversation.externalReservationId,
    },
    outboundBody,
    token,
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
        body: outboundBody,
        aiIntent: result.intent,
        aiConfidence: result.confidence,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "answered", lastMessageAt: now },
    }),
  ]);

  // Guest asked to speak to a human: we just sent the holding reply, now pause the
  // AI on this thread so the host can take over without the bot chiming in again.
  if (result.intent === "human_request") {
    const holdHours = Number(process.env.HUMAN_HANDOFF_HOLD_HOURS) || 12;
    await prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { autoReplyHoldUntil: new Date(now.getTime() + holdHours * 60 * 60 * 1000) },
      })
      .catch(() => {});
  }

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

/**
 * Refresh the org's "style profile" — a short guide distilled from the host's
 * OWN past replies — so future AI drafts mirror their voice. Throttled to once
 * per ~24h and only run when there are enough real host messages. Best-effort:
 * on any failure the existing profile (or none) is kept and replies fall back to
 * default behaviour. Never throws.
 */
export async function refreshStyleProfile(
  organizationId: string,
): Promise<{ refreshed: boolean }> {
  if (!process.env.OPENAI_API_KEY) return { refreshed: false };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiStyleProfileAt: true },
  });
  if (!org) return { refreshed: false };

  // Throttle: skip if refreshed within the last 24 hours.
  if (org.aiStyleProfileAt && Date.now() - org.aiStyleProfileAt.getTime() < 24 * 60 * 60 * 1000) {
    return { refreshed: false };
  }

  // Learn ONLY from the host's real, human replies — never the AI's own.
  const hostReplies = await prisma.message.findMany({
    where: {
      direction: "outbound",
      senderName: { not: "GuestOps AI" },
      conversation: { property: { organizationId } },
    },
    select: { body: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const samples = hostReplies.map((m) => m.body).filter((b) => b && b.trim().length > 0);
  if (samples.length < 5) return { refreshed: false };

  const profile = await summarizeHostStyle(samples);
  if (!profile) return { refreshed: false };

  await prisma.organization.update({
    where: { id: organizationId },
    data: { aiStyleProfile: profile, aiStyleProfileAt: new Date() },
  });
  return { refreshed: true };
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

/** How far ahead (ms) the IANA `tz` is from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const f = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(f.year),
      Number(f.month) - 1,
      Number(f.day),
      Number(f.hour) % 24,
      Number(f.minute),
      Number(f.second),
    );
    return asUtc - at.getTime();
  } catch {
    return 0;
  }
}

/**
 * UTC [start, end] instants spanning the calendar day of `now` as seen in the
 * IANA `tz` (e.g. "Europe/Istanbul"). Use this so "today's arrivals/departures"
 * are bucketed by the host's local day, not the server's UTC day.
 */
export function zonedDayRange(now: Date, tz: string): { start: Date; end: Date } {
  const key = dateKeyInTimeZone(now, tz); // "YYYY-MM-DD" in tz
  const [y, m, d] = key.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offsetMs = tzOffsetMs(tz, new Date(utcMidnight));
  const start = new Date(utcMidnight - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

// Placeholder the host can drop into a welcome template — {isim} / {ad} / {name}
// — replaced with the guest's first name when the message is sent.
function hasNamePlaceholder(s: string): boolean {
  return /\{\s*(isim|ad|name)\s*\}/i.test(s); // fresh, non-global → no lastIndex footgun
}

// The guest-facing apartment number: the last number in the property name
// ("nuve 3" → "3", "nuve teras 4" → "4", "Daire 1" → "1"). Falls back to the
// full name when it contains no number.
function apartmentNumber(propertyName: string): string {
  const nums = propertyName.match(/\d+/g);
  return nums ? nums[nums.length - 1] : propertyName;
}

// Resolve the host's template tokens to live values:
//   {isim} / {ad} / {name}         → guest's first name
//   {daire} / {apartment} / {apt}  → the apartment number (from the property name)
function fillPlaceholders(text: string, firstName: string, propertyName?: string): string {
  let out = text.replace(/\{\s*(isim|ad|name)\s*\}/gi, firstName);
  if (propertyName) {
    out = out.replace(/\{\s*(daire|apartment|apt)\s*\}/gi, apartmentNumber(propertyName));
  }
  return out;
}

/**
 * Build the welcome message body. If the host's template contains a {isim}
 * placeholder, substitute the tokens and send it verbatim (their own greeting +
 * sign-off). Otherwise prepend a greeting and append the org signature.
 */
function buildGuestMessageBody(
  content: string,
  firstName: string,
  signature?: string,
  propertyName?: string,
): string {
  const trimmed = content.trim();
  const filled = fillPlaceholders(trimmed, firstName, propertyName);
  if (hasNamePlaceholder(trimmed)) {
    return filled; // host's own greeting + sign-off, tokens resolved
  }
  return [`Merhaba ${firstName},`, "", filled, ...(signature ? ["", signature] : [])].join("\n");
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
    select: { autoWelcome: true, autoWelcomeEnabledAt: true, aiSignature: true },
  });
  if (!org || !org.autoWelcome) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  // The welcome is a "thanks for booking" greeting (no codes/Wi-Fi), so it goes
  // right after the booking is made — the sync picks it up within ~2 minutes,
  // regardless of how far ahead the stay is. Only bookings first seen AFTER
  // welcome was switched on (autoWelcomeEnabledAt) qualify, so enabling never
  // touches the pre-existing backlog. No baseline yet → nothing is sent.
  const now = new Date();
  const baseline = org.autoWelcomeEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      welcomeSentAt: null,
      sourceReference: { not: null },
      createdAt: { gte: baseline }, // only bookings created since welcome was enabled
      arrivalDate: { gte: startOfDay(now) }, // never welcome a stay already begun/past
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      arrivalDate: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { arrivalDate: "asc" },
    take: 25, // cap per run so enabling the toggle can't cause a huge burst
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;

  for (const r of reservations) {
    const welcome = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "welcome", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!welcome) continue; // this apartment has no welcome text → skip

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(welcome.content, firstName, signature, r.property.name);

    const delivery = await sendOnChannel(
      {
        channel: r.channel,
        guestIdentifier: r.guestName,
        externalReservationId: r.sourceReference,
      },
      body,
      token,
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

/**
 * Send the per-apartment CHECK-IN INFO message a few days before arrival — the
 * practical access details (address, entry code, Wi-Fi). Fires once the stay is
 * within CHECKIN_LEAD_DAYS of check-in, at most once per reservation
 * (checkinSentAt), and only for bookings created after the feature was switched
 * on (autoCheckinEnabledAt → never the backlog). Gated behind AUTO_REPLY_ENABLED
 * + the org autoCheckin toggle. Apartments without a "checkin" knowledge-base
 * entry are skipped. Body comes from that entry, personalised with the guest's
 * first name.
 */
export async function sendDueCheckins(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoCheckin: true, autoCheckinEnabledAt: true, aiSignature: true },
  });
  if (!org || !org.autoCheckin) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  // Land the access details close to the stay: CHECKIN_LEAD_DAYS before arrival.
  const CHECKIN_LEAD_DAYS = 4;
  const now = new Date();
  const baseline = org.autoCheckinEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      checkinSentAt: null,
      sourceReference: { not: null },
      createdAt: { gte: baseline }, // only bookings created since this was enabled
      arrivalDate: {
        gte: startOfDay(now), // not for stays already begun/past
        lte: addDays(now, CHECKIN_LEAD_DAYS), // …only once within the lead window
      },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { arrivalDate: "asc" },
    take: 25,
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;

  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkin", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!tpl) continue; // no check-in info entry for this apartment → skip

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(tpl.content, firstName, signature, r.property.name);

    const delivery = await sendOnChannel(
      { channel: r.channel, guestIdentifier: r.guestName, externalReservationId: r.sourceReference },
      body,
      token,
    );
    if (!delivery.ok) continue; // try again next run; do not mark as sent

    // Mark every row for this booking (handles any duplicate reservation rows).
    await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId } },
      data: { checkinSentAt: new Date() },
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
      body: welcome ? buildGuestMessageBody(welcome.content, firstName, signature, r.property.name) : null,
    });
  }
  return previews;
}

/**
 * Preview the check-in info message for upcoming reservations WITHOUT sending —
 * the exact text that would go out (placeholders substituted). Ignores the
 * on/off toggle so the host can review every apartment's "Giriş Talimatı" entry
 * before going live. Flags apartments missing the entry and bookings already
 * messaged.
 */
export async function previewCheckins(
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
      checkinSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { arrivalDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkin", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(tpl),
      alreadySent: Boolean(r.checkinSentAt),
      body: tpl ? buildGuestMessageBody(tpl.content, firstName, signature, r.property.name) : null,
    });
  }
  return previews;
}

/**
 * Send the per-apartment check-out message the EVENING BEFORE the guest's
 * departure: from 18:00 (org timezone) onward, for bookings whose check-out is
 * the next day. Sent once per reservation (checkoutSentAt). Body comes from the
 * apartment's "checkout" knowledge-base entry, personalised with the guest's
 * first name. Single-night stays are skipped (the evening-before would land on
 * the arrival/welcome day). Gated behind AUTO_REPLY_ENABLED + the org
 * autoCheckout toggle. Apartments without a checkout entry are skipped.
 */
export async function sendDueCheckouts(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoCheckout: true, autoCheckoutEnabledAt: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoCheckout) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  const now = new Date();
  const tz = org.timezone ?? "Europe/Istanbul";
  // Only from 18:00 onward, the day BEFORE departure.
  if (currentHourInTimeZone(tz, now) < 18) return { sent: 0, considered: 0 };
  // The calendar date of "tomorrow" in the org timezone — check-out must be then.
  const tomorrowKey = dateKeyInTimeZone(addDays(now, 1), tz);
  // Only message bookings created AFTER checkout was switched on
  // (autoCheckoutEnabledAt), so enabling never messages guests already mid-stay
  // from before. No baseline yet → nothing is sent.
  const baseline = org.autoCheckoutEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      checkoutSentAt: null,
      sourceReference: { not: null },
      createdAt: { gte: baseline }, // only bookings created since checkout was enabled
      departureDate: { gte: startOfDay(now), lt: addDays(startOfDay(now), 3) },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      arrivalDate: true,
      departureDate: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { departureDate: "asc" },
    take: 25,
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;

  for (const r of reservations) {
    // Only when check-out is tomorrow (so the message lands the evening before).
    if (arrivalDateKey(r.departureDate) !== tomorrowKey) continue;
    // Skip single-night stays: the evening-before would collide with the
    // arrival/welcome day, so these never get an automatic check-out message.
    const nights = Math.round(
      (r.departureDate.getTime() - r.arrivalDate.getTime()) / 86_400_000,
    );
    if (nights <= 1) continue;

    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkout", isActive: true },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!tpl) continue;

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(tpl.content, firstName, signature, r.property.name);

    const delivery = await sendOnChannel(
      { channel: r.channel, guestIdentifier: r.guestName, externalReservationId: r.sourceReference },
      body,
      token,
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

/**
 * Email the host when a guest sends a complaint or refund-type message that
 * needs a person. Detection is keyword-based (classifyFallback) — no AI cost.
 * Each flagged conversation is moved to "problem", which routes it to a human
 * (auto-reply skips "problem") AND dedupes the alert so it never re-sends. The
 * feature is off unless ALERT_EMAIL is set. Never throws: e-mail failures are
 * swallowed by the email service and the status write is guarded.
 */
export async function sendDueAlerts(
  organizationId: string,
): Promise<{ alerted: number }> {
  const to = process.env.ALERT_EMAIL?.trim();
  if (!to) return { alerted: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  // Only escalate genuinely recent complaints. A re-sync (e.g. after reconnecting
  // the channel) can resurface a weeks-old unanswered message as "new"; without
  // this guard the host gets a burst of stale alert emails about long-past stays.
  // Real complaints are caught within minutes (the cron syncs ~every 2m), so a few
  // days of slack is plenty.
  const ALERT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

  // Unanswered conversations where the guest spoke last and that aren't flagged.
  const candidates = await prisma.conversation.findMany({
    where: { property: { organizationId }, status: "new" },
    select: {
      id: true,
      guestIdentifier: true,
      channel: true,
      priority: true,
      property: { select: { name: true, address: true, city: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" }, // freshest first — never let stale backlog crowd out new complaints
    take: 50,
  });

  let alerted = 0;
  for (const c of candidates) {
    const last = c.messages[0];
    if (!last || last.direction !== "inbound") continue;
    // Skip stale backlog surfaced by a re-sync — only alert on fresh messages.
    if (Date.now() - last.createdAt.getTime() > ALERT_MAX_AGE_MS) continue;
    const cls = classifyFallback(last.body);
    if (!cls.isComplaint && cls.intent !== "refund") continue;

    const html = complaintEscalationEmail(
      { id: c.id, guestIdentifier: c.guestIdentifier, channel: c.channel, priority: c.priority },
      last.body,
      { name: c.property.name, address: c.property.address, city: c.property.city },
      org?.name ?? "GuestOps",
    );
    await emailService.send(
      to,
      `⚠️ Acil misafir mesajı — ${c.guestIdentifier} (${c.property.name})`,
      html,
    );

    // Flag → routes the conversation to a human and prevents re-alerting.
    try {
      await prisma.conversation.update({ where: { id: c.id }, data: { status: "problem" } });
    } catch {
      // ignore; the next run will retry
    }
    alerted++;
  }
  return { alerted };
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
      body: tpl ? buildGuestMessageBody(tpl.content, firstName, signature, r.property.name) : null,
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
