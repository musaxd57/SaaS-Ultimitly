import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { classifyFallback, detectPromptInjection, detectRiskType } from "@/lib/ai/fallback";
import { HIGH_STAKES_RISK_TYPES } from "@/lib/automation";
import {
  resolveGuestChat,
  bindOrCheckStay,
  guestChatAiPausedFromMessages,
  acquireGuestChatThreadLock,
  type GuestChatContext,
  type GuestChatDb,
} from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
import { verifyReservationPin } from "@/lib/guest-chat-pin";
import { sendQrEscalationAlertBounded, qrEscalationEventId } from "@/lib/guest-chat-alerts";
import { jsonOk, badRequest, tooManyRequests, parseJsonBody, payloadTooLarge } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { isUniqueViolation } from "@/lib/db-errors";
import { claimOutboundSend, releaseOutboundSend } from "@/lib/outbound-claim";

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

// Deterministic acknowledgment for a message that arrives AFTER the human team has
// taken over the thread (host handoff). The AI stays silent for the rest of the
// stay — it re-opens only on a NEW reservation (a fresh "qr-chat:" thread). The
// message is still recorded so the host sees it; the client is GET-authoritative,
// so this reply is a courtesy field, not what renders.
const HANDOFF_REPLY = "Mesajınız işletme ekibine iletildi; en kısa sürede size dönecek.";

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
  result: { intent: string; riskLevel: string; confidence: number; source: string; riskType?: string | null },
  message: string,
  /** Reservation guest name (Airbnb-controlled) — the model sees it in the prompt,
   *  so an injection planted in the NAME must escalate even on a benign message. */
  guestName?: string | null,
): boolean {
  if (guestName && detectPromptInjection(guestName)) return true;
  if (result.source !== "openai") return true; // canned fallback → host handles it
  if (ESCALATE_INTENTS.has(result.intent)) return true; // money/complaint/human
  // Parity with the inbox auto-send gate: a high-stakes riskType LABEL from the
  // model (review_threat / platform_policy / access_security / money_refund / …)
  // is itself a red flag — escalate even when the model scored riskLevel low. No
  // handoff-ack exemption here: at the doorway there's no human to hand off to in
  // real time, so human_request escalates too (already covered by ESCALATE_INTENTS).
  if (result.riskType && HIGH_STAKES_RISK_TYPES.has(result.riskType)) return true;
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
 * Ensure the stay's dedicated QR conversation row exists and return its id.
 * Kept OUT of the Airbnb inbox: a per-stay conversation
 * ("qr-chat:<propertyId>:<reservationId>", channel "chat") that the separate
 * "Misafir Sohbetleri" tab reads. status is always "answered" so these never
 * leak into the Airbnb inbox/dashboard counts (which key on new/waiting/
 * problem). Runs OUTSIDE the record transaction on purpose: the P2002
 * lose-the-race catch below cannot live inside an interactive transaction
 * (PostgreSQL aborts the whole tx on a unique violation).
 */
async function ensureGuestChatConversation(
  propertyId: string,
  reservation: { id: string; guestName: string },
): Promise<string> {
  const marker = `qr-chat:${propertyId}:${reservation.id}`;
  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: marker },
    select: { id: true },
  });
  if (existing) return existing.id;
  // DETERMİNİSTİK id = rezervasyon başına tek QR konuşması, PK üzerinden
  // atomik (Codex P1): iki eşzamanlı "ilk mesaj" aynı id'yi yaratmaya çalışır,
  // PostgreSQL PK'sı birini P2002 ile düşürür — kaybeden kazananın satırını
  // kullanır. Migration'sız unique: externalReservationId'ye tablo-geneli
  // @@unique koymak Hospitable satırlarını da bağlardı (aynı rezervasyonun
  // birden çok gerçek thread'i meşru), o yüzden kapsam SADECE QR id'si.
  // Eski (rastgele id'li) QR konuşmaları yukarıdaki findFirst ile bulunmaya
  // devam eder — onlar için bu yol hiç koşmaz.
  const qrConversationId = `qrconv_${reservation.id}`;
  try {
    const created = await prisma.conversation.create({
      data: {
        id: qrConversationId,
        propertyId,
        channel: "chat",
        guestIdentifier: reservation.guestName,
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
        reservationId: reservation.id,
        externalReservationId: marker,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    if (!isUniqueViolation(err, ["id"])) throw err;
    // Yarışı kaybeden istek: kazananın satırına devam et (mesaj kaybolmaz).
    return qrConversationId;
  }
}

/**
 * Record a guest-chat exchange (the guest's question + the bot's reply) on an
 * EXISTING conversation. Runs on the given client — inside the per-thread
 * locked transaction on the guest route — so the paused-recheck and this
 * insert are atomic against a concurrent host reply. Escalated exchanges are
 * flagged via priority "urgent" (and stay urgent once set).
 */
async function recordGuestChatExchange(
  db: GuestChatDb,
  conversationId: string,
  guestName: string,
  guestMessage: string,
  // null → HOST HANDOFF: store ONLY the guest's inbound message (the AI is paused;
  // the host replies). A string is the bot's reply, stored as a "Lixus AI" outbound.
  botReply: string | null,
  escalated: boolean,
): Promise<{ inboundMessageId: string }> {
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), ...(escalated ? { priority: "urgent" } : {}) },
  });
  // createManyAndReturn: the inbound row's id is the escalation-alert EVENT
  // identity (dedupe anchor) — same insert semantics, ids back in one round.
  const created = await db.message.createManyAndReturn({
    data: [
      { conversationId, direction: "inbound", authorType: "guest", senderName: guestName, body: guestMessage.slice(0, MAX_MESSAGE), language: "tr" },
      ...(botReply !== null
        ? [{ conversationId, direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: botReply.slice(0, MAX_MESSAGE), language: "tr" }]
        : []),
    ],
    select: { id: true, direction: true },
  });
  const inboundMessageId = created.find((m) => m.direction === "inbound")?.id ?? created[0]?.id ?? "";
  return { inboundMessageId };
}

/**
 * HOST HANDOFF (migration-free): is the AI currently PAUSED for this stay's thread?
 * The AI hands off when a human host replies and stays paused until the host
 * EXPLICITLY re-enables it — never on a timer (the host may have stepped into a
 * sensitive matter the AI would misread later). State is derived from the most
 * recent NON-bot outbound event: a host reply (senderName ≠ "Lixus AI") pauses; a
 * resume marker (senderName = AI_RESUME_MARKER, written by the panel button)
 * re-opens. No schema flag. A new reservation opens a fresh thread → AI active.
 */
async function guestChatAiPaused(
  propertyId: string,
  reservationId: string,
  db: GuestChatDb = prisma,
): Promise<boolean> {
  const marker = `qr-chat:${propertyId}:${reservationId}`;
  const convo = await db.conversation.findFirst({
    where: { propertyId, externalReservationId: marker },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { direction: true, senderName: true, authorType: true, systemEventType: true },
      },
    },
  });
  return convo ? guestChatAiPausedFromMessages(convo.messages) : false;
}

// ---------------------------------------------------------------------------
// PIN unlock (Faz 5): the guest submits the host-provided PIN to CLAIM this
// stay's chat on their device. On success the device is bound (cookie set) and
// the PIN is never asked again. Verification is IP rate-limited (on top of the
// durable per-reservation lockout in verifyReservationPin). Error responses are
// GENERIC — "invalid" and "no PIN set" collapse to one message so nothing about
// the PIN's value or existence leaks.
// ---------------------------------------------------------------------------
async function handlePinUnlock(
  req: NextRequest,
  res: NonNullable<GuestChatContext["activeReservation"]>,
  pinRequired: boolean,
  cookieName: string,
  cookie: string | null,
  pin: string,
): Promise<NextResponse> {
  const claimAndCookie = (claimed: Awaited<ReturnType<typeof bindOrCheckStay>>): NextResponse => {
    if (claimed.status === "mismatch") return jsonOk({ boundElsewhere: true });
    const out = jsonOk({ unlocked: true });
    if (claimed.status === "bound") setStayCookie(out, cookieName, claimed.secret, res.departureDate);
    return out;
  };

  // Already claimed by THIS device → unlock is a success no-op.
  const existing = await bindOrCheckStay(res.id, cookie, { allowClaim: false });
  if (existing.status === "match") return jsonOk({ unlocked: true });
  if (existing.status === "mismatch") return jsonOk({ boundElsewhere: true });

  // Unbound. If this stay doesn't actually require a PIN (defensive — the UI
  // wouldn't send one), just claim it.
  if (!pinRequired) return claimAndCookie(await bindOrCheckStay(res.id, cookie, { allowClaim: true }));

  // Stricter per-IP cap for PIN guesses, in addition to the durable per-
  // reservation lockout inside verifyReservationPin.
  const pinLimit = await rateLimit(`guestchat-pin:${clientIp(req)}`, 8, 5 * 60_000);
  if (!pinLimit.ok) return tooManyRequests(pinLimit.retryAfter);

  const verdict = await verifyReservationPin(res.id, pin);
  if (verdict.status === "locked") {
    return jsonOk({ pinRequired: true, locked: true, retryAfter: verdict.retryAfterSec });
  }
  if (verdict.status !== "ok") {
    // invalid | no_pin → ONE generic message (never reveal which, nor the value).
    return jsonOk({ pinRequired: true, pinError: true });
  }
  // Correct PIN → claim the stay for this device (atomic; a racing correct-PIN
  // device loses and gets boundElsewhere — the intended single-winner result).
  return claimAndCookie(await bindOrCheckStay(res.id, cookie, { allowClaim: true }));
}

// Public history fetch — the guest's chat page loads this on open and polls it,
// so the host's replies (written from the panel) show up when the guest reopens
// the chat or keeps it open. Scoped to the CURRENT stay's thread only (a past
// guest can't read it — the chat is closed after checkout), so no PII leak.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();
  const limited = await rateLimit(`guestchat-get:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const { token } = await params;
  const ctx = await resolveGuestChat(token);
  if (!ctx) return notFound();
  if (!ctx.open || !ctx.activeReservation) return jsonOk({ open: false, messages: [] });

  // Per-stay device binding: the FIRST device to open the chat claims it. A
  // different device scanning the same fixed physical QR gets NO history — so a
  // past guest / cleaner holding the QR photo can't read the current guest's chat.
  const cookieName = stayCookieName(ctx.property.id);
  const cookie = readCookie(req, cookieName);
  // PIN gate (Faz 5): when this stay requires a PIN, a bare scan must NOT claim it
  // — check the binding WITHOUT claiming; if still unbound, prompt for the PIN.
  const binding = ctx.pinRequired
    ? await bindOrCheckStay(ctx.activeReservation.id, cookie, { allowClaim: false })
    : await bindOrCheckStay(ctx.activeReservation.id, cookie, { allowClaim: true });
  if (binding.status === "unclaimed") {
    return jsonOk({ open: true, pinRequired: true, messages: [] });
  }
  if (binding.status === "mismatch") {
    return jsonOk({ open: true, boundElsewhere: true, messages: [] });
  }

  const marker = `qr-chat:${ctx.property.id}:${ctx.activeReservation.id}`;
  const convo = await prisma.conversation.findFirst({
    where: { propertyId: ctx.property.id, externalReservationId: marker },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
      },
    },
  });
  const messages = (convo?.messages ?? []).map((m) => ({
    id: m.id,
    // Reliable, typed role (authorType) — never the message text or host senderName.
    role: guestChatDisplayRole(m),
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
  const ipLimit = await rateLimit(`guestchat-ip:${clientIp(req)}`, 20, 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  const { token } = await params;

  const bodyResult = await parseJsonBody<{ message?: unknown; pin?: unknown; requestId?: unknown }>(req);
  if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
  const body = bodyResult.ok ? bodyResult.data : null;
  const pinInput = typeof body?.pin === "string" ? body.pin : null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  // Client-generated idempotency id (Codex 07-24 #2, composer parity): one id per
  // COMPOSED guest message, reused across connection-loss retries of that same
  // message. Optional — an old open tab without it keeps today's behaviour.
  // Malformed → 400 (same contract as the manual reply route).
  const requestIdRaw = body?.requestId;
  if (requestIdRaw !== undefined && (typeof requestIdRaw !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(requestIdRaw))) {
    return badRequest({ requestId: "Geçersiz istek kimliği." });
  }
  const requestId = typeof requestIdRaw === "string" ? requestIdRaw : null;

  const ctx = await resolveGuestChat(token);
  if (!ctx) return notFound();

  // Chat is open only during an active stay (until checkOutTime on departure day).
  // Outside that → no AI, no escalation, just a polite "no active stay" reply.
  if (!ctx.open || !ctx.activeReservation) {
    return jsonOk({
      closed: true,
      reply:
        "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız varsa lütfen giriş gününüzde tekrar deneyin.",
    });
  }
  const res = ctx.activeReservation;
  const cookieName = stayCookieName(ctx.property.id);
  const cookie = readCookie(req, cookieName);

  // ---- PIN UNLOCK: the guest submitted a PIN to claim the stay (Faz 5) ----
  if (pinInput !== null) {
    return handlePinUnlock(req, res, ctx.pinRequired, cookieName, cookie, pinInput);
  }

  // ---- Message flow ----
  if (!message) return badRequest({ message: "Bir mesaj yazın." });
  if (message.length > MAX_MESSAGE) {
    return badRequest({ message: `Mesaj çok uzun (en fazla ${MAX_MESSAGE} karakter).` });
  }

  // Per-stay device binding: the FIRST device to open the chat claims it. A
  // different device scanning the same fixed physical QR can't read or send —
  // so a past guest / cleaner with the QR photo can't hijack the current stay.
  // PIN gate (Faz 5): when this stay requires a PIN, a message may NOT claim it —
  // the guest must unlock with the PIN first, so the message is refused until then.
  const binding = ctx.pinRequired
    ? await bindOrCheckStay(res.id, cookie, { allowClaim: false })
    : await bindOrCheckStay(res.id, cookie, { allowClaim: true });
  if (binding.status === "unclaimed") {
    return jsonOk({
      pinRequired: true,
      reply: "Sohbeti kullanmak için ev sahibinizin verdiği giriş kodunu girin.",
    });
  }
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

  // ── Idempotency claim (Codex 07-24 #2, claim-then-process): if the server
  // recorded the exchange but the RESPONSE was lost, the client restores the
  // typed text and the guest re-sends — without this, the retry duplicated the
  // guest message, burned a second paid model call, and could re-escalate. The
  // claim key binds the stay + the client's per-message id + the body digest
  // (claimOutboundSend hashes the body), so a DELIBERATE identical follow-up
  // ("ok" twice) still works: each composed message carries a fresh id. ──
  const claimScopeId = requestId ? `qr-in:${res.id}:${requestId}` : null;
  if (claimScopeId) {
    const claimed = await claimOutboundSend(claimScopeId, message);
    if (claimed === "duplicate") {
      // Already processed (or still in flight). The client is GET-authoritative —
      // it reloads the thread and renders whatever the first attempt recorded.
      return finalize({ deduped: true });
    }
    if (claimed === "unavailable") {
      // Fail CLOSED like the manual reply path: without the claim store a
      // lost-response retry could double-process (double AI spend + duplicate
      // escalation), so refuse honestly instead.
      return NextResponse.json(
        { error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." },
        { status: 503 },
      );
    }
  }
  // Everything below funnels its persistence through record(): on a failure
  // BEFORE anything was recorded the claim is released (catch at the bottom),
  // so a claim never guards zero work — the guest's retry is processed, not
  // swallowed. After a successful record the claim deliberately stays: the
  // retry dedupes onto the recorded exchange.
  //
  // ATOMIC HANDOFF GUARD (Codex 07-24 #4): when the record carries a BOT reply,
  // the paused-recheck and the insert run in ONE transaction holding the
  // per-thread advisory lock — the same lock the host reply route takes. A host
  // reply committing at any point before our insert is therefore VISIBLE to the
  // recheck (the lock forces commit-then-see ordering), so the AI can never
  // append behind the host's message; `handedOff: true` reports the veto and
  // only the guest's inbound was stored. The old non-transactional "send-time
  // veto" this replaces was best-effort — a host reply landing between the
  // check and the insert still got talked over.
  let recorded = false;
  const record = async (botReply: string | null, escalated: boolean) => {
    const conversationId = await ensureGuestChatConversation(ctx.property.id, res);
    const out = await prisma.$transaction(async (tx) => {
      await acquireGuestChatThreadLock(tx, conversationId);
      if (botReply !== null && (await guestChatAiPaused(ctx.property.id, res.id, tx))) {
        const r = await recordGuestChatExchange(tx, conversationId, res.guestName, message, null, true);
        return { ...r, handedOff: true };
      }
      const r = await recordGuestChatExchange(tx, conversationId, res.guestName, message, botReply, escalated);
      return { ...r, handedOff: false };
    });
    recorded = true;
    return out;
  };
  try {

  // HOST HANDOFF (pre-check): if a human host has already replied in this thread,
  // the AI has handed off for the rest of the stay. Record the guest's message for
  // the host and DON'T spend a (paid) model call — the human owns the conversation.
  // Re-checked once more just before an AI reply would be stored (send-time veto
  // below), which also catches a host reply that lands WHILE the model is running.
  if (await guestChatAiPaused(ctx.property.id, res.id)) {
    await record(null, true);
    return finalize({ handoff: true, reply: HANDOFF_REPLY });
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
  // Deterministic criticality of THIS message (code verdict, model-free):
  // a safety/emergency bypasses the alert's anti-flood cooldown — a fire two
  // minutes after a complaint must still e-mail the host.
  const criticalEvent = detectRiskType(message) === "safety_emergency";

  if (usage.count > DAILY_AI_CAP) {
    const reply = "Sorunuzu ev sahibine ilettim; en kısa sürede size dönecek.";
    const { inboundMessageId, handedOff } = await record(reply, true);
    // A host reply raced in → the human owns the thread; the canned line was
    // vetoed under the lock and only the guest's message was stored.
    if (handedOff) return finalize({ handoff: true, reply: HANDOFF_REPLY });
    // "İlettim" is only true if the host finds out — env-gated (default OFF),
    // deduped per EVENT, response-time bounded, never throws (Codex #15).
    await sendQrEscalationAlertBounded({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      eventId: qrEscalationEventId(inboundMessageId, message, criticalEvent),
      reason: "daily_cap",
      critical: criticalEvent,
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

  // SEND-TIME VETO: a host may have replied WHILE the model ran (seconds). The
  // authoritative check now lives INSIDE record() — recheck + insert run under
  // the per-thread advisory lock shared with the host reply route, so a host
  // reply committing at any point before our insert structurally vetoes the AI
  // answer (handedOff below). The guest's message is still recorded for the host.
  const reply = escalate
    ? "Bu sorunuzu ev sahibine ilettim; en kısa sürede size dönecek."
    : result.reply;
  const { inboundMessageId, handedOff } = await record(reply, escalate);
  if (handedOff) return finalize({ handoff: true, reply: HANDOFF_REPLY });
  if (escalate) {
    await sendQrEscalationAlertBounded({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      eventId: qrEscalationEventId(inboundMessageId, message, criticalEvent),
      reason: "ai_escalated",
      critical: criticalEvent,
    });
  }
  return finalize({ escalated: escalate, reply });

  } catch (err) {
    // Pre-record failure (model/DB error before anything persisted) → release so
    // the guest's retry is processed instead of deduped against zero work.
    if (claimScopeId && !recorded) await releaseOutboundSend(claimScopeId, message);
    throw err;
  }
}
