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
 * Drop an escalated question into the host's existing inbox as a single
 * per-apartment "qr-chat" conversation, so the host sees it. The marker is
 * synthetic so it can never collide with a real Hospitable thread.
 *
 * NOTE: the public chat has no return address (an anonymous scanner), so the
 * host reads the question here but the reply-back channel is a live-surface
 * concern to design at enable-time — intentionally out of scope while disabled.
 */
async function escalateToInbox(
  propertyId: string,
  reservationId: string | null,
  guestIdentifier: string,
  message: string,
): Promise<void> {
  const marker = `qr-chat:${propertyId}`;
  const now = new Date();
  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: marker },
    select: { id: true, status: true },
  });
  let conversationId: string;
  if (!existing) {
    const created = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "chat",
        guestIdentifier,
        status: "new",
        priority: "standard",
        lastMessageAt: now,
        reservationId,
        externalReservationId: marker,
      },
      select: { id: true },
    });
    conversationId = created.id;
  } else {
    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        lastMessageAt: now,
        guestIdentifier,
        ...(existing.status === "closed" ? { status: "new" } : {}),
      },
    });
    conversationId = existing.id;
  }
  await prisma.message.create({
    data: {
      conversationId,
      direction: "inbound",
      senderName: guestIdentifier,
      body: message.slice(0, MAX_MESSAGE),
      language: "tr",
    },
  });
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

  const guestIdentifier = "QR Misafir";

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
    await escalateToInbox(ctx.property.id, ctx.activeReservation?.id ?? null, guestIdentifier, message);
    return jsonOk({ escalated: true, reply: "Sorunuzu ev sahibine ilettim; en kısa sürede size dönecek." });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.property.organizationId },
    select: { aiStyleProfile: true },
  });

  const res = ctx.activeReservation;
  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: ctx.property.name,
      checkInTime: ctx.property.checkInTime,
      checkOutTime: ctx.property.checkOutTime,
      address: ctx.property.address,
      city: ctx.property.city,
    },
    // NO reservation PII to an anonymous public surface: not the guest's name and
    // not their stay dates (a past guest who kept the QR could otherwise learn the
    // CURRENT guest's checkout date). General checkout time still comes from the
    // property (property.checkOutTime), which is not personal data.
    reservation: null,
    knowledgeBase: ctx.knowledgeBase,
    history: [],
    tone: "warm",
    language: "tr",
    styleProfile: org?.aiStyleProfile ?? null,
  });

  if (mustEscalate(result, message)) {
    await escalateToInbox(ctx.property.id, res?.id ?? null, guestIdentifier, message);
    return jsonOk({ escalated: true, reply: "Bu sorunuzu ev sahibine ilettim; en kısa sürede size dönecek." });
  }

  return jsonOk({ escalated: false, reply: result.reply });
}
