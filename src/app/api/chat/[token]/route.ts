import { type NextRequest, type NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { classifyFallback, detectPromptInjection, detectRiskType } from "@/lib/ai/fallback";
import { resolveGuestChat, bindOrCheckStay } from "@/lib/guest-chat";
import { maybeSendQrEscalationEmail } from "@/lib/guest-chat-alerts";
import { jsonOk, badRequest, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// PUBLIC guest QR concierge endpoint — DISABLED BY DEFAULT.
//
// A guest scans the in-apartment QR (an unguessable per-apartment token) and
// asks a question; this runs the SAME AI pipeline the inbox uses, against the
// apartment's SECRET-FREE knowledge base (door/keybox code + Wi-Fi are excluded
// upstream in resolveGuestChat, so they're never in context). General questions
// get an answer; anything sensitive or low-confidence is REFUSED and escalated
// to the host's inbox — a real-time chat has no "draft for human review", so the
// safe failure mode is "the host will follow up".
//
// Two independent switches keep this inert until an operator opts in:
//   1. GUEST_CHAT_ENABLED=1 env (global kill-switch) — without it, every request 404s.
//   2. Property.chatEnabled (per-apartment, default false) — checked in resolveGuestChat.
// ---------------------------------------------------------------------------

const MAX_MESSAGE = 2000;
// Intents that must never be answered autonomously to a guest — money,
// cancellation, complaint, or an explicit ask for a human.
const ESCALATE_INTENTS = new Set(["complaint", "refund", "early_departure", "human_request"]);
// Max PAID AI calls per apartment per (UTC) day — a durable cost ceiling.
const DAILY_AI_CAP = 200;

const notFound = () => new Response("Not found", { status: 404 });

// Per-stay device-binding cookie: an httpOnly secret unique to the FIRST device
// that opened the chat this stay, scoped per apartment. Read from the raw Cookie
// header (works for both Request and NextRequest).
const stayCookieName = (propertyId: string) => `gcs_${propertyId}`;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function setStayCookie(res: NextResponse, name: string, secret: string, departureDate: Date): void {
  // Cover the whole stay (+36h grace), min 1h, capped at 60d. The server also
  // gates on an active stay, so this lifetime is just hygiene, not the control.
  const ms = departureDate.getTime() + 36 * 3_600_000 - Date.now();
  const maxAge = Math.min(60 * 86_400, Math.max(3_600, Math.floor(ms / 1000)));
  res.cookies.set({
    name,
    value: secret,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

/**
 * Real-time public chat gate. Unlike the Airbnb auto-reply gate (whose failure
 * mode is "leave a draft for the host"), here the failure mode is "escalate" —
 * there is no human at the doorway. Returns true when the bot must NOT answer.
 */
function mustEscalate(
  result: { intent: string; riskLevel: string; confidence: number; source: string },
  message: string,
  /** Reservation guest name (Airbnb-controlled) — the model sees it in the prompt,
   *  so an injection planted in the NAME must escalate even on a benign message. */
  guestName?: string | null,
): boolean {
  if (guestName && detectPromptInjection(guestName)) return true;
  if (result.source !== "openai") return true; // canned fallback → host handles it
  if (ESCALATE_INTENTS.has(result.intent)) return true; // money/complaint/human
  // Cross-check the guest's own words against the deterministic detector — catches
  // an angry/refund message the model under-rated as benign.
  const fb = classifyFallback(message);
  if (fb.isComplaint || fb.intent === "refund" || fb.intent === "early_departure" || fb.intent === "human_request") {
    return true;
  }
  // Deterministic high-risk backstops (mirror the inbox auto-send gate): a classic
  // injection or a safety/rule/discrimination message is escalated even if the
  // model under-rated it as benign — the guest chat has no human-review draft.
  if (detectPromptInjection(message)) return true;
  const dr = detectRiskType(message);
  if (dr === "safety_emergency" || dr === "rule_violation" || dr === "discrimination") return true;
  if (result.riskLevel !== "none" && result.riskLevel !== "low") return true;
  return result.confidence < 0.75;
}

/**
 * Record a guest-chat exchange (the guest's question + the bot's reply) for the
 * host. Kept OUT of the Airbnb inbox: a dedicated per-stay conversation
 * ("qr-chat:<propertyId>:<reservationId>", channel "chat") that the separate
 * "Misafir Sohbetleri" tab reads. Escalated exchanges are flagged ("problem" +
 * urgent) so the host can spot the ones that needed them. The synthetic marker
 * can never collide with a real Hospitable thread (those are UUIDs).
 */
async function recordGuestChat(
  propertyId: string,
  reservation: { id: string; guestName: string },
  guestMessage: string,
  botReply: string,
  escalated: boolean,
): Promise<{ inboundMessageId: string }> {
  const marker = `qr-chat:${propertyId}:${reservation.id}`;
  const now = new Date();
  // status is always "answered" so these never leak into the Airbnb inbox/dashboard
  // counts (which key on new/waiting/problem); escalation is flagged via priority
  // "urgent" (and stays urgent once set). The separate tab reads channel "chat".
  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: marker },
    select: { id: true },
  });
  let conversationId: string;
  if (!existing) {
    const created = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "chat",
        guestIdentifier: reservation.guestName,
        status: "answered",
        priority: escalated ? "urgent" : "standard",
        lastMessageAt: now,
        reservationId: reservation.id,
        externalReservationId: marker,
      },
      select: { id: true },
    });
    conversationId = created.id;
  } else {
    await prisma.conversation.update({
      where: { id: existing.id },
      data: { lastMessageAt: now, ...(escalated ? { priority: "urgent" } : {}) },
    });
    conversationId = existing.id;
  }
  // createManyAndReturn: the inbound row's id is the escalation-alert EVENT
  // identity (dedupe anchor) — same insert semantics, ids back in one round.
  const created = await prisma.message.createManyAndReturn({
    data: [
      { conversationId, direction: "inbound", senderName: reservation.guestName, body: guestMessage.slice(0, MAX_MESSAGE), language: "tr" },
      { conversationId, direction: "outbound", senderName: "Lixus AI", body: botReply.slice(0, MAX_MESSAGE), language: "tr" },
    ],
    select: { id: true, direction: true },
  });
  const inboundMessageId = created.find((m) => m.direction === "inbound")?.id ?? created[0]?.id ?? "";
  return { inboundMessageId };
}

// Public history fetch — the guest's chat page loads this on open and polls it,
// so the host's replies (written from the panel) show up when the guest reopens
// the chat or keeps it open. Scoped to the CURRENT stay's thread only (a past
// guest can't read it — the chat is closed after checkout), so no PII leak.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();
  const limited = rateLimit(`guestchat-get:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const { token } = await params;
  const ctx = await resolveGuestChat(token);
  if (!ctx) return notFound();
  if (!ctx.open || !ctx.activeReservation) return jsonOk({ open: false, messages: [] });

  // Per-stay device binding: the FIRST device to open the chat claims it. A
  // different device scanning the same fixed physical QR gets NO history — so a
  // past guest / cleaner holding the QR photo can't read the current guest's chat.
  const cookieName = stayCookieName(ctx.property.id);
  const binding = await bindOrCheckStay(ctx.activeReservation.id, readCookie(req, cookieName));
  if (binding.status === "mismatch") {
    return jsonOk({ open: true, boundElsewhere: true, messages: [] });
  }

  const marker = `qr-chat:${ctx.property.id}:${ctx.activeReservation.id}`;
  const convo = await prisma.conversation.findFirst({
    where: { propertyId: ctx.property.id, externalReservationId: marker },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, direction: true, senderName: true, body: true },
      },
    },
  });
  const messages = (convo?.messages ?? []).map((m) => ({
    id: m.id,
    // "ai" = the bot (senderName "Lixus AI"); any other outbound = the human host.
    role: m.direction === "inbound" ? "guest" : m.senderName === "Lixus AI" ? "ai" : "host",
    text: m.body,
  }));
  const out = jsonOk({ open: true, messages });
  if (binding.status === "bound") setStayCookie(out, cookieName, binding.secret, ctx.activeReservation.departureDate);
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Global kill-switch read at request time (flip without a rebuild).
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();

  // Public + unauthenticated → cap per IP first.
  const ipLimit = rateLimit(`guestchat-ip:${clientIp(req)}`, 20, 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  const { token } = await params;

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest({ message: "Bir mesaj yazın." });
  if (message.length > MAX_MESSAGE) {
    return badRequest({ message: `Mesaj çok uzun (en fazla ${MAX_MESSAGE} karakter).` });
  }

  const ctx = await resolveGuestChat(token);
  if (!ctx) return notFound();

  // Chat is open only during an active stay (until checkOutTime on departure day).
  // Outside that → no AI, no escalation, just a polite "no active stay" reply.
  if (!ctx.open) {
    return jsonOk({
      closed: true,
      reply:
        "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız varsa lütfen giriş gününüzde tekrar deneyin.",
    });
  }

  // open ⟹ an active reservation exists; guard defensively for the type-checker.
  const res = ctx.activeReservation;
  if (!res) {
    return jsonOk({ closed: true, reply: "Şu an aktif bir konaklama görünmüyor; sohbet kapalı." });
  }

  // Per-stay device binding: the FIRST device to open the chat claims it. A
  // different device scanning the same fixed physical QR can't read or send —
  // so a past guest / cleaner with the QR photo can't hijack the current stay.
  const cookieName = stayCookieName(ctx.property.id);
  const binding = await bindOrCheckStay(res.id, readCookie(req, cookieName));
  if (binding.status === "mismatch") {
    return jsonOk({
      boundElsewhere: true,
      reply:
        "Bu konaklama için sohbet başka bir cihazda başlatıldı. Yardım için lütfen ev sahibinizle iletişime geçin.",
    });
  }
  // Set the stay cookie on whichever answer we return below (only when we just
  // claimed the stay for this device).
  const finalize = (payload: Record<string, unknown>) => {
    const out = jsonOk(payload);
    if (binding.status === "bound") setStayCookie(out, cookieName, binding.secret, res.departureDate);
    return out;
  };

  // Per-apartment DAILY cap on PAID AI calls — DURABLE (survives restarts, shared
  // across replicas), so one bearer token can't re-burn the cap every boot the way
  // the in-memory limiter allowed. Atomic increment, then check. Over cap →
  // escalate without calling the (paid) model.
  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.chatUsage.upsert({
    where: { propertyId_day: { propertyId: ctx.property.id, day } },
    create: { propertyId: ctx.property.id, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (usage.count > DAILY_AI_CAP) {
    const reply = "Sorunuzu ev sahibine ilettim; en kısa sürede size dönecek.";
    const { inboundMessageId } = await recordGuestChat(ctx.property.id, res, message, reply, true);
    // "İlettim" is only true if the host finds out — env-gated (default OFF),
    // deduped per EVENT (this message), never throws, never changes this
    // response (Codex #15).
    await maybeSendQrEscalationEmail({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      triggerMessageId: inboundMessageId,
      reason: "daily_cap",
    });
    return finalize({ escalated: true, reply });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.property.organizationId },
    select: { aiStyleProfile: true },
  });

  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: ctx.property.name,
      checkInTime: ctx.property.checkInTime,
      checkOutTime: ctx.property.checkOutTime,
      address: ctx.property.address,
      city: ctx.property.city,
    },
    // NO reservation PII to the anonymous public AI: not the guest's name, not
    // their stay dates. (The host's private "Misafir Sohbetleri" record DOES carry
    // the guest name — that's the host's own booking data.)
    reservation: null,
    // ...but the stay IS verified (chat only opens during an active booking) —
    // without this flag the pre-booking guard would treat the current guest as
    // a prospect and invite them to "complete your booking" mid-stay. Secrets
    // remain banned either way (public surface; KB is pre-scrubbed upstream).
    verifiedActiveStay: true,
    knowledgeBase: ctx.knowledgeBase,
    history: [],
    tone: "warm",
    language: "tr",
    styleProfile: org?.aiStyleProfile ?? null,
  });

  // (The QR model call passes reservation:null — the name never reaches the model
  // today — so this is defense-in-depth: if the name is ever wired into the
  // prompt, the deterministic backstop is already in place.)
  const escalate = mustEscalate(result, message, res.guestName);
  const reply = escalate
    ? "Bu sorunuzu ev sahibine ilettim; en kısa sürede size dönecek."
    : result.reply;
  const { inboundMessageId } = await recordGuestChat(ctx.property.id, res, message, reply, escalate);
  if (escalate) {
    await maybeSendQrEscalationEmail({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      triggerMessageId: inboundMessageId,
      reason: "ai_escalated",
    });
  }
  return finalize({ escalated: escalate, reply });
}
