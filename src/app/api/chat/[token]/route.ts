import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { classifyFallback } from "@/lib/ai/fallback";
import { resolveGuestChat } from "@/lib/guest-chat";
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

/**
 * Real-time public chat gate. Unlike the Airbnb auto-reply gate (whose failure
 * mode is "leave a draft for the host"), here the failure mode is "escalate" —
 * there is no human at the doorway. Returns true when the bot must NOT answer.
 */
function mustEscalate(
  result: { intent: string; riskLevel: string; confidence: number; source: string },
  message: string,
): boolean {
  if (result.source !== "openai") return true; // canned fallback → host handles it
  if (ESCALATE_INTENTS.has(result.intent)) return true; // money/complaint/human
  // Cross-check the guest's own words against the deterministic detector — catches
  // an angry/refund message the model under-rated as benign.
  const fb = classifyFallback(message);
  if (fb.isComplaint || fb.intent === "refund" || fb.intent === "early_departure") return true;
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
): Promise<void> {
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
  await prisma.message.createMany({
    data: [
      { conversationId, direction: "inbound", senderName: reservation.guestName, body: guestMessage.slice(0, MAX_MESSAGE), language: "tr" },
      { conversationId, direction: "outbound", senderName: "Lixus AI", body: botReply.slice(0, MAX_MESSAGE), language: "tr" },
    ],
  });
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
  return jsonOk({ open: true, messages });
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
    await recordGuestChat(ctx.property.id, res, message, reply, true);
    return jsonOk({ escalated: true, reply });
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
    knowledgeBase: ctx.knowledgeBase,
    history: [],
    tone: "warm",
    language: "tr",
    styleProfile: org?.aiStyleProfile ?? null,
  });

  const escalate = mustEscalate(result, message);
  const reply = escalate
    ? "Bu sorunuzu ev sahibine ilettim; en kısa sürede size dönecek."
    : result.reply;
  await recordGuestChat(ctx.property.id, res, message, reply, escalate);
  return jsonOk({ escalated: escalate, reply });
}
