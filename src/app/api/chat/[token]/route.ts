import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { detectRiskType } from "@/lib/ai/fallback";
import { evaluateEscalation, qrAvailabilityPolicy } from "@/lib/guest-chat-gate";
import { evaluateAvailability, stayEvidenceOf } from "@/lib/ai/availability-claims";
import { evaluateIntentRisk, intentRiskEvidenceOf, understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { runStayChangeGuard, stayGuardEnabled } from "@/lib/ai/semantic/guard";
import {
  resolveGuestChat,
  bindOrCheckStay,
  guestChatAiPausedFromMessages,
  acquireGuestChatThreadLock,
  ensureGuestChatConversation,
  scrubStyleProfileForPublic,
  escalationReply,
  isPhysicalEmergency,
  buildGuestChatContextWindow,
  GUEST_CHAT_MESSAGE_WINDOW,
  type GuestChatContext,
  type GuestChatDb,
} from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
import { verifyReservationPin } from "@/lib/guest-chat-pin";
import {
  sendQrEscalationAlertBounded,
  qrEscalationEventId,
} from "@/lib/guest-chat-alerts";
import { jsonOk, badRequest, tooManyRequests, parseJsonBody, payloadTooLarge, serverError } from "@/lib/api";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { claimKeyedOutboundSend, releaseKeyedOutboundSend } from "@/lib/outbound-claim";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { consumeDailyAiBudgetForQr } from "@/lib/ai/daily-budget";
import { recordIngestEvent } from "@/lib/ingest/events";
import { recordRiskEvent } from "@/lib/risk-events";
import { applyPromptKbAudit, buildKbEvidence } from "@/lib/ai/grounding";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";

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

// Max PAID AI calls per apartment per (UTC) day — a durable cost ceiling.
// Tavan artık PLANA göre (billing/plan-limits.ts): Başlangıç 50 / Pro 100 /
// İşletme 200. Aşağıdaki sabit yalnız plan çözülemezse kullanılan son çaredir.
const DAILY_AI_CAP_FALLBACK = 200;

// Deterministic acknowledgment for a message that arrives AFTER the human team has
// taken over the thread (host handoff). The AI stays silent for the rest of the
// stay — it re-opens only on a NEW reservation (a fresh "qr-chat:" thread). The
// message is still recorded so the host sees it; the client is GET-authoritative,
// so this reply is a courtesy field, not what renders.
// ⚠️ "işletme ekibine … ekip" KURUMSAL DİLDİ (denetim 08-08). Ürünü kullanan tek
// bir EV SAHİBİDİR (prompts.ts KURAL-4 aynı gerekçeyle "yöneticimiz/operatörümüz"ü
// yasaklıyor) ve 20 satır aşağıdaki kardeş metin `escalationReply()` zaten
// "ev sahibiniz" diyor — yani misafir, aynı sohbette iki farklı muhatap adı
// duyuyordu. Söz içeriği DEĞİŞMEDİ: mesaj kaydedildi, host sohbet ekranından görür.
// 🚨 YALNIZ GARANTİ EDİLEN SÖYLENİR (inceleme 09-10) — `escalationReply()` ile AYNI sözleşme.
// Eski metin: "Mesajınız ev sahibinize İLETİLDİ; sohbet ekranından size DÖNECEK." İki iddia da
// doğrulanamıyordu: (a) "iletildi" — mesaj KAYDEDİLİR, host'a e-posta bayrağa/dedupe'a/cooldown'a
// bağlıdır ve bu metin e-postadan ÖNCE yazılır; (b) "size dönecek" — host adına verilmiş bir SÖZ,
// ürün garanti edemez. Yeni metin yalnız VERİDEN okunabilen iki gerçeği söyler: mesaj kaydedildi
// ve bu sohbeti host devraldı (devir durumunun tanımı = thread'de host mesajı var).
// ⚠️ KAPSAM DÜRÜSTLÜĞÜ: bu metin bugün misafire GÖRÜNMÜYOR — `finalize` yalnız JSON döndürür
// (Message olarak yazılmaz) ve istemci POST'un `reply` alanını okumaz (GET otoriter). Yani
// düzeltilen şey CANLI kusur değil, sözleşmeyi delen LATENT iddiadır (test-pinli).
const HANDOFF_REPLY = "Mesajınız kaydedildi; bu sohbeti ev sahibiniz devraldı.";

// ESKALASYON CEVABI — gövde `src/lib/guest-chat.ts` `escalationReply()`.
// Söz gerçeğe uygun olmak zorunda (denetim 08-01 + Codex 09-08): metin YALNIZ
// garanti edileni söyler (mesaj kaydedildi, ev sahibi sohbet ekranından görür);
// gerçekleşmesi garanti olmayan e-posta aktarımı ("ilettim") iddia EDİLMEZ.
// Route dosyasından yardımcı export edilemez (Next.js "not a valid Route export
// field") — bu yüzden kütüphanede durur ve testler oradan okur.

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
 * Ensure the stay's dedicated QR conversation row exists and return its id.
 * Kept OUT of the Airbnb inbox: a per-stay conversation
 * ("qr-chat:<propertyId>:<reservationId>", channel "chat") that the separate
 * "Misafir Sohbetleri" tab reads. status is always "answered" so these never
 * leak into the Airbnb inbox/dashboard counts (which key on new/waiting/
 * problem). Runs OUTSIDE the record transaction on purpose: the P2002
 * lose-the-race catch below cannot live inside an interactive transaction
 * (PostgreSQL aborts the whole tx on a unique violation).
 */
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
  // V1: event kiracı kapsamı (QR bir Lixus-native giriştir; sağlayıcı/bağlantı yok).
  organizationId: string,
): Promise<{ inboundMessageId: string }> {
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), ...(escalated ? { priority: "urgent" } : {}) },
  });
  // createManyAndReturn: the inbound row's id is the escalation-alert EVENT
  // identity (dedupe anchor) — same insert semantics, ids back in one round.
  // ── NEDENSEL SIRA DAMGADA (kurucu sorusu, 09-08) ──────────────────────────
  //
  // İki satır TEK transaction'da yazılıyor ve `createdAt` DB varsayılanı
  // (`CURRENT_TIMESTAMP`) PostgreSQL'de TRANSACTION BAŞLANGICIDIR → ikisi de AYNI
  // milisaniyeyi alıyordu. Sıra o zaman yalnız `id` kopma noktasından çıkıyordu;
  // cuid'ler pratikte artan üretildiği için bu ÇOĞU ZAMAN doğru, ama nedensel
  // sıranın GARANTİSİ değil (id bir VEKİL, kanıt değil).
  // Doğrusu: nedenselliği verinin kendisine yazmak. Misafirin satırı `now`,
  // botun cevabı `now + 1ms` alır — cevap, sorudan sonra olmuştur ve bu her
  // okuyucu için (geçmiş, kalite denetçisi, dışa aktarım) doğrudan görünür.
  // `id` kopma noktası yine de KORUNUR: bu düzeltmeden ÖNCE yazılmış eşit
  // damgalı satırlar için tek deterministik sıra odur.
  const guestAt = new Date();
  const botAt = new Date(guestAt.getTime() + 1);
  const created = await db.message.createManyAndReturn({
    data: [
      // V0.4 provenance: misafirin satırı bir ingress'ten geçti (ingestedAt); iç thread → connectionId
      // YOK. Botun cevabı bizim çıktımızdır, ingest değildir (aşağıda damgasız).
      { conversationId, direction: "inbound", authorType: "guest", senderName: guestName, body: guestMessage.slice(0, MAX_MESSAGE), language: "tr", ingestedAt: guestAt, createdAt: guestAt },
      ...(botReply !== null
        ? [{ conversationId, direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: botReply.slice(0, MAX_MESSAGE), language: "tr", createdAt: botAt }]
        : []),
    ],
    select: { id: true, direction: true },
  });
  const inboundMessageId = created.find((m) => m.direction === "inbound")?.id ?? created[0]?.id ?? "";
  // V1 ürün akışı: YALNIZ misafirin satırı bir domain event'tir (`message.received`, aynı TX'te,
  // PII'siz). Botun cevabı bizim çıktımızdır — event yok. Tüketici (intelligence) satırı id ile okur.
  if (inboundMessageId) {
    await recordIngestEvent(
      db,
      { organizationId, provider: "qr_chat", connectionId: null },
      "message",
      inboundMessageId,
      "message.received",
    );
  }
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
  const pinLimit = await rateLimit(`guestchat-pin:${rateLimitClientKey(req)}`, 8, 5 * 60_000);
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
  const limited = await rateLimit(`guestchat-get:${rateLimitClientKey(req)}`, 60, 60_000);
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
        // 🚨 PENCERE (dış denetim 09-18, bulgu 4). Bu uç TAVANSIZDI ve istemci
        // 5 saniyede bir çağırıyor: konuşmanın TAMAMI dakikada 12 kez hem
        // sorgulanıyor hem tel üzerinden taşınıyordu.
        //
        // 🚨 CURSOR (`afterId`) DEĞİL PENCERE — üç ölçülmüş sebep:
        //  ① İstemci zaten pencere-uyumlu: listeyi TOPTAN değiştiriyor
        //    (`setMessages(data.messages)`), yani sunucu tarafı tek başına
        //    yeter, istemcide birleştirme/boşluk-doldurma mantığı GEREKMEZ.
        //  ② `createdAt` üzerinde cursor GÜVENSİZ: QR yolu misafiri `now`,
        //    botu `now+1ms` damgalıyor ve bu düzeltmeden ÖNCEKİ satırların
        //    damgaları EŞİT — eşit damgada cursor satır ATLAR.
        //  ③ Doğru desen repoda ZATEN yazılı ve gerekçeli: host tarafındaki
        //    `guest-chats/[id]` sayfası aynı işi `take` + TAM SIRA ile yapıyor.
        //    Halka açık misafir rotasına uygulanmamıştı.
        //
        // TAM SIRA (`createdAt` + `id`): eşit damgada pencere sınırı kaymasın.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: GUEST_CHAT_MESSAGE_WINDOW,
        select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
      },
    },
  });
  // En yeni N alındı → kronolojiye geri çevrilir (istemci sırayı değiştirmez).
  const messages = (convo?.messages ?? []).slice().reverse().map((m) => ({
    id: m.id,
    // Reliable, typed role (authorType) — never the message text or host senderName.
    role: guestChatDisplayRole(m),
    text: m.body,
  }));
  const out = jsonOk({ open: true, messages });
  if (binding.status === "bound") setStayCookie(out, cookieName, binding.secret, ctx.activeReservation.departureDate);
  return out;
}

// ── HATA SINIRI (gözlemlenebilirlik turu, 08-06) ───────────────────────────
//
// 🚨 Bu rota MİSAFİRE BAKAN tek kimliksiz yüzey ve içinde `reportError` ya da
// `serverError` HİÇ geçmiyordu (grep: 0) — kardeşi `/api/leads` ikisini de
// kullanıyor. Aşağıdaki gövdenin tek `catch`i (claim salıverme) hatayı bilerek
// YENİDEN FIRLATIYOR, yani model/DB arızasında Next jenerik bir 500 döner ve
// **operatöre hiçbir sinyal ulaşmaz**: bu depoda `reportError` hata havuzuna
// giden TEK yol (console.error hiçbir yerde toplanmıyor). Bir misafirin QR
// sohbeti kalıcı olarak bozulabilir ve kimse bilmez.
//
// Sarmalayıcı SEÇİLDİ, gövdeyi try'a almak DEĞİL: 300 satırı yeniden girintilemek
// diff'i okunamaz hale getirir ve gerçek bir kod değişikliğini içinde saklar.
// Davranış misafir açısından AYNI (500 → 500); değişen tek şey artık RAPORLANIYOR.
//
// ⚠️ Hata NESNESİ verilir, misafirin mesajı DEĞİL: `serverError(msg, err)`
// içeride `reportError`e gider ve orada `redactSensitive` koşar; gövdeyi elle
// eklemek KVKK açısından ikinci bir PII kopyası üretirdi.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    return await handleGuestChatPost(req, ctx);
  } catch (err) {
    return serverError("Şu anda yanıt veremiyoruz — lütfen birazdan tekrar deneyin.", err);
  }
}

async function handleGuestChatPost(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Global kill-switch read at request time (flip without a rebuild).
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();

  // Public + unauthenticated → cap per IP first.
  const ipLimit = await rateLimit(`guestchat-ip:${rateLimitClientKey(req)}`, 20, 60_000);
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

  // ── Idempotency claim (Codex 07-24 #2 + r2, claim-then-process): if the
  // server recorded the exchange but the RESPONSE was lost, the client restores
  // the typed text and the guest re-sends — without this, the retry duplicated
  // the guest message, burned a second paid model call, and could re-escalate.
  // The claim key is stay+requestId; the body digest is stored IN the row, so a
  // duplicate is CLASSIFIED: same payload → deduped no-op; same id with a
  // DIFFERENT body (buggy/tampered client — ours mints a fresh id per composed
  // text) → 409, neither swallowed nor double-processed. A DELIBERATE identical
  // follow-up ("ok" twice) still works: each composed message carries a fresh
  // id. Claim TTL (120s) bounds a crashed holder: the expired row is swept on
  // the next claim, so a retry is never locked out forever. ──
  const claimScopeId = requestId ? `qr-in:${res.id}:${requestId}` : null;
  if (claimScopeId) {
    const claimed = await claimKeyedOutboundSend(claimScopeId, message);
    if (claimed === "duplicate") {
      // Already processed (or still in flight). The client is GET-authoritative —
      // it reloads the thread and renders whatever the first attempt recorded.
      return finalize({ deduped: true });
    }
    if (claimed === "mismatch") {
      return NextResponse.json(
        { error: "Bu istek kimliği farklı bir içerikle kullanılmış — lütfen tekrar gönderin." },
        { status: 409 },
      );
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
        const r = await recordGuestChatExchange(tx, conversationId, res.guestName, message, null, true, ctx.property.organizationId);
        return { ...r, handedOff: true };
      }
      const r = await recordGuestChatExchange(tx, conversationId, res.guestName, message, botReply, escalated, ctx.property.organizationId);
      return { ...r, handedOff: false };
    });
    recorded = true;
    // `conversationId` dışarıya taşınır: karar gerekçesi kaydı (RiskEvent) konuşmaya
    // bağlanabilsin — kurucu konsolunda "hangi sohbette hangi kapı kapattı" izlenir.
    return { ...out, conversationId };
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
  // 🚨 ALARM ÖLÇÜTÜ ≠ MİSAFİR METNİ ÖLÇÜTÜ (inceleme turu, 09-11).
  // `criticalEvent` ALARM dedupe'ı içindir ve bilinçli GENİŞTİR (aşırı eşleşme
  // orada bedavadır: yalnız cooldown atlanır). Misafire GİDEN metin için aynı
  // ölçütü kullanmak İKİ kusur üretiyordu — öz-zarar mesajına "acil servisleri
  // arayın" göndermek (ürünün kendi istem kuralına aykırı) ve "İnternet düştü"
  // gibi cümlelerde acil talimatı basmak. Metin DAR yükleme bağlanır.
  const physicalEmergency = isPhysicalEmergency(message);

  const dailyAiCap =
    (await limitsForOrg(ctx.property.organizationId).catch(() => null))?.qrQuestionsPerPropertyPerDay ??
    DAILY_AI_CAP_FALLBACK;

  if (usage.count > dailyAiCap) {
    const reply = escalationReply({ critical: physicalEmergency });
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

  // ⚠️ ORG GÜNLÜK AI BÜTÇESİ — QR BU KAPININ DIŞINDAYDI (denetim, 08-01).
  // `suggestReply` çağıran 8 yerden 7'si org bütçesini tüketiyordu; QR rotası
  // TEK istisnaydı ve aynı zamanda kimlik doğrulaması OLMAYAN tek AI yüzeyi.
  // Tek tavanı DAİRE başınaydı (50/100/200) → 25 daireli bir İşletme müşterisi
  // 25 × 200 = 5.000 model çağrısına ulaşabiliyordu, oysa aynı planın org tavanı
  // 1.500. Yani `daily-budget.ts`'in kendi gerekçesi ("sayaç ORG başınadır;
  // üye ekleyerek tavanı çoğaltmak mümkün olmamalı") daire-başına delinmişti ve
  // ödeyen müşterinin OpenAI faturası tek toplam-harcama korumasının dışında
  // büyüyebiliyordu.
  //
  // Tavana çarpınca DAİRE tavanıyla AYNI dal işler: model çağrısı YOK, misafire
  // devir cevabı, host'a bildirim denemesi. Daire-başı tavan ikinci savunma
  // olarak yerinde duruyor.
  // ⚠️ QR'A ÖZEL: kimliksiz yüzey org'un bütçesini TEK BAŞINA bitiremesin.
  // İki kova (kendi payı + org ortak tavanı) — gerekçe `daily-budget.ts`'te.
  //
  // 🚨 "ÖNCE TÜKET" ve bu BİLİNÇLİ (§E, 09-12 — gerekçe önceden burada YAZILI
  // DEĞİLDİ). Cron yolu `peekDailyAiBudget` kullanır çünkü orada sağlayıcı
  // arızasında fallback'e düşen çağrı BEDAVA olduğu hâlde birim yakıyordu
  // (`daily-budget.ts` başlığı). QR'da AYNI DESEN KULLANILMAZ ve fark kasıtlı:
  // burası KİMLİKSİZ, HALKA AÇIK bir yüzey — "önce bak, sonra tüket" penceresi
  // tam olarak suistimal edilecek penceredir. Bedeli yazılı: sağlayıcı düştüğünde
  // misafirin mesajı 2 birim yakar ve devir metnini alır. Bu takas QR için
  // güvenlik lehine seçildi; cron için tersi doğrudur.
  const budget = await consumeDailyAiBudgetForQr(ctx.property.organizationId);
  if (!budget.ok) {
    const escalationText = escalationReply({ critical: physicalEmergency });
    const { inboundMessageId, handedOff } = await record(escalationText, true);
    if (handedOff) return finalize({ handoff: true, reply: HANDOFF_REPLY });
    await sendQrEscalationAlertBounded({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      eventId: qrEscalationEventId(inboundMessageId, message, criticalEvent),
      reason: "daily_budget_qr",
      critical: criticalEvent,
    });
    return finalize({ escalated: true, reply: escalationText });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.property.organizationId },
    select: { aiStyleProfile: true },
  });

  // ── KONUŞMA BAĞLAMI (kurucu AI kalite turu, 09-08) ────────────────────────
  //
  // 🚨 Burada `history: []` vardı: QR asistanı aynı sohbette bir önceki cümleyi
  // GÖRMÜYORDU. Canlıda ölçülen sonuçlar: konu değişimi anlaşılmıyor, selamlaşma
  // tekrarlanıyor, "buldum teşekkürler" gibi kapanışlar yeni bir soru gibi
  // işleniyor, peş peşe yazılan mesajlar kopuk değerlendiriliyor. Inbox yolu
  // geçmişi zaten veriyordu — bu bir ASİMETRİYDİ, ürün kararı değil.
  //
  // Pencere kuralları ve gerekçeleri `guest-chat.ts` `buildGuestChatContextWindow`
  // içinde tek yerde: kronoloji + eşit damgada deterministik sıra, sistem olayı ve
  // gövdesiz satır dışarıda, MESAJ + KARAKTER çift tavanı, ve pencere dışına taşan
  // kapanmamış konuların PII'siz kategori notu (`openTopics`).
  // Sohbet bu turda yazılmadan önce okunur → misafirin ŞU ANKİ mesajı geçmişte
  // TEKRARLANMAZ (yapısal garanti, ayrıca test-pinli).
  const priorConversationId = await ensureGuestChatConversation(ctx.property.id, res);
  const { history, openTopics, hasPriorOperatorReply } = await buildGuestChatContextWindow(priorConversationId);

  // RAG dilim 1 (09-09): SORUYA GÖRE SEÇİM — `ctx.knowledgeBase` zaten mülk +
  // onay + sır kategorisi + içerik sezgiseli süzgeçlerinden geçmiştir; seçici
  // bu kümeye kalem EKLEYEMEZ. Bayrak kapalıyken `kbSel.items` aynı dizidir
  // ve `droppedItems` 0'dır (canlı davranış aynen).
  const kbSel = await retrieveKbForPrompt({
    items: ctx.knowledgeBase,
    guestMessage: message,
    history,
    // Anlama katmanı (bayrak açıkken): standart saat kıyası + redaksiyon için.
    stayTimes: { checkIn: ctx.property.checkInTime, checkOut: ctx.property.checkOutTime },
    redactNames: [res.guestName],
  });
  const kbDroppedTotal = ctx.knowledgeBaseDropped + kbSel.droppedItems;

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
    knowledgeBase: kbSel.items,
    knowledgeBaseDropped: kbDroppedTotal,
    knowledgeBaseSelection: kbSel.selection,
    knowledgeBaseNotes: kbSel.notes,
    history,
    openTopics,
    // SELAM TEKRARI (canlı kusur 09-08): "daha önce cevap verdik mi" KODDA
    // hesaplanır ve modele AÇIKÇA söylenir. Modelin geçmişe bakıp çıkarmasını
    // beklemek tam da başarısız olan şeydi.
    conversationState: { isFirstOperatorReply: !hasPriorOperatorReply },
    tone: "warm",
    language: "tr",
    // ⚠️ STİL REHBERİ HALKA AÇIK YÜZEYE HAM GİRMEZ (denetim, 08-01). Rehber, ev
    // sahibinin geçmiş misafir cevaplarından bir modelle damıtılıyor ve o cevaplar
    // rutin olarak Wi-Fi şifresi / kapı kodu içeriyor; damıtma isteminde "koyma"
    // yazılı olması bir MODEL RİCASIDIR, deterministik garanti değil. Bu modülün
    // değişmezi ise "sır bağlama HİÇ girmez". Aynı deterministik detektör
    // (bilgi tabanını elediği detektör) rehbere de uygulanır.
    styleProfile: scrubStyleProfileForPublic(org?.aiStyleProfile),
  });

  // (The QR model call passes reservation:null — the name never reaches the model
  // today — so this is defense-in-depth: if the name is ever wired into the
  // prompt, the deterministic backstop is already in place.)
  // 🚨 KAPININ TARADIĞI GEÇMİŞ, MODELİN GÖRDÜĞÜ GEÇMİŞLE AYNI DİZİ OLMALI
  // (09-12). Kanal yolunda aynı asimetri `dfd1683`'te kapandı: istem penceresi
  // büyüdüğünde kapının aynası geride kalırsa misafir, yükü pencerenin görünen
  // kısmının dışına itip modele ulaştırabilir. Burada tek kaynak `history` —
  // ikinci bir pencere hesaplanmıyor, çünkü ayrışabilecek her kopya bu açığın
  // kendisidir.
  // ANLAM KATMANI (09-24): mülkün standart saatleri politikaya girer (model yuvasındaki saat KODDA
  // kıyaslanır); bekçi bayrağı açıksa (`AI_STAY_GUARD_ENABLED`) ikinci model taslağı otomatik cevap ADAYI için
  // ya da tek engeli müsaitlik onayı eksikliği olan taslak için okur (iki bağımsız modelin ertelemesi o tutuşu
  // ancak böyle kaldırabilir — kanal kapısıyla parite) ve kapı onun hükmüyle yeniden değerlendirilir.
  const understood = await kbSel.understanding;
  let stayCtx: Parameters<typeof evaluateEscalation>[4] = {
    stayTimes: { checkIn: ctx.property.checkInTime, checkOut: ctx.property.checkOutTime },
    understanding: understood?.stay ?? null,
    understandingFailed: (await kbSel.understandingStatus) === "failed",
    // Anlama katmanının risk niyeti (acil/şikâyet/iptal-iade/insan) — kanal kapısıyla parite, varsayılan gölge.
    understandingRisk: understandingRiskOf(understood),
  };
  const gateResult = { ...result, reply: result.reply, usedSources: result.usedSources };
  let verdict = evaluateEscalation(gateResult, message, res.guestName, history, stayCtx);
  if ((!verdict.escalate || verdict.reason === "availability_unconfirmed") && stayGuardEnabled()) {
    const stayGuard = await runStayChangeGuard({
      guestMessages: [message],
      reply: result.reply,
      stayTimes: stayCtx?.stayTimes,
      names: [res.guestName],
      // Modelin gördüğü AYNI pencere (takip izni bağlamla anlaşılır).
      history,
    });
    if (stayGuard) {
      stayCtx = { ...stayCtx, stayGuard };
      verdict = evaluateEscalation(gateResult, message, res.guestName, history, stayCtx);
    }
  }
  const escalate = verdict.escalate;

  // SEND-TIME VETO: a host may have replied WHILE the model ran (seconds). The
  // authoritative check now lives INSIDE record() — recheck + insert run under
  // the per-thread advisory lock shared with the host reply route, so a host
  // reply committing at any point before our insert structurally vetoes the AI
  // answer (handedOff below). The guest's message is still recorded for the host.
  // 🚨 ACİL ≠ SIRADAN İSTEK (kurucu, 09-11). `criticalEvent` yukarıda (alarm
  // dedupe'ı için) ZATEN hesaplandı — yeni dedektör, yeni çağrı, yeni maliyet yok.
  const reply = escalate
    ? escalationReply({ critical: physicalEmergency })
    : result.reply;
  const { inboundMessageId, handedOff, conversationId } = await record(reply, escalate);
  if (handedOff) return finalize({ handoff: true, reply: HANDOFF_REPLY });
  // İZLENEBİLİRLİK (kurucu AI kalite turu, 09-08): KARARIN GEREKÇESİ kaydedilir —
  // devir DE, otomatik cevap DA. Kapalı küme; misafir metni ASLA girmez. Yan
  // etkidir: `recordRiskEvent` ASLA fırlatmaz (kendi try/catch'i var), o yüzden
  // await edilmesi teslimi riske atmaz ve kaydı deterministik kılar (fire-and-forget
  // olsaydı yanıt döndükten sonra yazılır, kurucu konsolunda yarış görünürdü).
  await recordRiskEvent({
    organizationId: ctx.property.organizationId,
    propertyId: ctx.property.id,
    conversationId,
    surface: "guest_chat",
    triggerId: inboundMessageId,
    finalDecision: escalate ? "human_review" : "auto_sent",
    riskLevel: result.riskLevel,
    riskType: result.riskType ?? null,
    reason: verdict.reason ?? "gate_passed",
    confidence: result.confidence,
    // A2 — TEMELLENDİRME: gerekçe tek başına "neden dayanamadı"yı söylemiyor.
    // Kodun bildiği (kaç kalem gitti, kaçı onay bekliyor, kaçı tavandan düştü,
    // hangi bilgi sürümü) ile modelin BEYANI yan yana yazılır; ikisi ayrı
    // olmadan "bilgi yok" ile "bilgi vardı, kullanılmadı" ayrılamaz.
    // §C: pack karakter bütçesinin kestiği kalemler de sayılır. `kbDroppedTotal`
    // istem-ÖNCESİ sayıdır; `result.kbOmittedInPrompt` istemin TOPLAMIDIR
    // (ön düşüşler DÂHİL) → EKLENMEZ, DEĞİŞTİRİLİR (çift sayım olurdu).
    // Model çağrılmadıysa alan `undefined` gelir ve sayaçlara DOKUNULMAZ (A2).
    ...applyPromptKbAudit(
      { kbRetrieved: kbSel.items.length, kbDropped: kbDroppedTotal },
      result.kbOmittedInPrompt,
      kbSel.items.length,
    ),
    kbPendingApproval: ctx.knowledgeBasePendingApproval,
    kbNewestUpdatedAt: ctx.knowledgeBaseNewestUpdatedAt,
    // YETKİLİ İÇ DENETİM: hangi kalemler, hangi sürümle. `max(updatedAt)` bunu
    // yanıtlamıyor (iki farklı küme aynı max'ı verebilir). Misafire dönen yanıt
    // gövdesi ayrı nesne literalleridir; bu alan oraya HİÇBİR yoldan girmez.
    // Hibritte parça indeksi + retrieval özeti (PII'siz) de kanıta girer.
    kbEvidenceJson: buildKbEvidence({
      retrieved: kbSel.items,
      usedLabels: result.usedSources ?? [],
      // Anlama katmanı paralel koştuysa özeti burada eklenir (kapı onu zaten bekledi).
      retrieval: await kbSel.evidenceAfterUnderstanding(),
      // GÖLGE ölçüm (karar DEĞİL): modelin taslağındaki somut iddiaların desteği + token kullanımı.
      // Misafir devir metnini alsa bile bu, MODELİN taslağını betimler.
      claims: result.claimAudit,
      llm: result.llmUsage,
      hijackScreened: ctx.knowledgeBaseHijackScreened,
      // Konaklama değişikliği politikası: kapıyla AYNI girdi (`qrAvailabilityPolicy`) — uygulanan
      // karar + `enforce` kipinin kararı (gölge) + katman sinyalleri; kapalı-küme kodlar.
      stay: stayEvidenceOf(evaluateAvailability(result.reply, [message], qrAvailabilityPolicy(result, stayCtx))),
      // Risk niyeti: kapıyla AYNI girdi; yalnız anlama katmanı gerçekten koştuysa yazılır.
      intentRisk: understood
        ? intentRiskEvidenceOf(evaluateIntentRisk(stayCtx?.understandingRisk, { modelIntent: result.intent, mode: stayCtx?.intentMode }))
        : undefined,
    }),
    srcDeclared: result.sourceAudit?.declared ?? null,
    srcVerified: result.sourceAudit?.verified ?? null,
  });
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
    if (claimScopeId && !recorded) await releaseKeyedOutboundSend(claimScopeId);
    throw err;
  }
}
