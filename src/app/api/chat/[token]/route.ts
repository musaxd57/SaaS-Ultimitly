import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { replyCallParams, replyPromptItemsOf, replyPromptVersion, suggestReply } from "@/lib/ai";
import { aiGenerationTraceEnabled, recordAiGeneration } from "@/lib/ai/generation-trace";
import { acquireErasureLock, loadErasureGuard } from "@/lib/erasure";
import { ANON_NAME } from "@/lib/data-retention";
import { ESCALATION_REASON_CODES } from "@/lib/risk-events";
import { detectRiskType, isSafetyEmergencyText } from "@/lib/ai/fallback";
import { ESCALATE_INTENTS, evaluateEscalation, qrAvailabilityPolicy } from "@/lib/guest-chat-gate";
import { evaluateAvailability, kbFactsOf, stayEvidenceOf } from "@/lib/ai/availability-claims";
import { hasEmergencyCallDirective, hazardDecisionFor, hazardEvidenceOf } from "@/lib/ai/hazard-evidence";
import { emergencyNumberEnabled, emergencyNumberReply } from "@/lib/ai/emergency-number";
import { confidentLanguage } from "@/lib/ai/language-signal";
import { evaluateIntentRisk, intentRiskEvidenceOf, understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { runStayChangeGuard, stayGuardEnabled } from "@/lib/ai/semantic/guard";
import {
  resolveGuestChat,
  bindOrCheckStay,
  guestChatAiPausedForStay,
  acquireGuestChatThreadLock,
  ensureGuestChatConversation,
  findGuestChatConversationId,
  styleProfileForPrompt,
  buildGuestChatContextWindow,
  GUEST_CHAT_MESSAGE_WINDOW,
  qrReplyHasDoorCode,
  redactDoorCodes,
  type GuestChatContext,
  type GuestChatDb,
} from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
import { verifyReservationPin } from "@/lib/guest-chat-pin";
import {
  CANCELLED_STAY_ALERT_WINDOW_MS,
  CANCELLED_STAY_MESSAGES_PER_HOUR,
  cancelledStayMailKey,
  maybeSendQrEscalationEmail,
  returnCancelledStayMailSlot,
  runDetached,
  sendQrEscalationAlertBounded,
  qrEscalationEventId,
} from "@/lib/guest-chat-alerts";
import { jsonOk, badRequest, tooManyRequests, parseJsonBody, payloadTooLarge, serverError, hasJsonContentType, unsupportedMediaType, noStore } from "@/lib/api";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { SUPPORT_VIEW_GUEST_CHAT_MESSAGE, isSupportViewCookieHeader } from "@/lib/guest-chat-support-view";
import { claimKeyedOutboundSend, releaseKeyedOutboundSend } from "@/lib/outbound-claim";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { consumeDailyAiBudgetForQr } from "@/lib/ai/daily-budget";
import { recordIngestEvent } from "@/lib/ingest/events";
import { recordRiskEvent } from "@/lib/risk-events";
import {
  closableAfter,
  closingMayHide,
  lexicalClosingOnly,
  replyAuthorOf,
  semanticClosingOnly,
  type ClosingThreadMessage,
} from "@/lib/ai/closing-turn";
import { CLOSING_HANDLED_REASON, CLOSING_OPEN_REASON, hasOpenHostWork } from "@/lib/conversation-attention";
import { applyPromptKbAudit, buildKbEvidence } from "@/lib/ai/grounding";
import { houseRulesShadowFor } from "@/lib/house-rules/shadow";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { loadConversationStateForConversation } from "@/lib/ai/conversation-state-loader";
import { orgTimezone } from "@/lib/timezone";
import { verifiedQrEnabled } from "@/lib/ai/verified-qr";
import { reportError } from "@/lib/report-error";
import { loadQrVerifiedStay } from "@/lib/ai/verified-qr-load";
import { codeBuiltResult } from "@/lib/ai/code-built-result";

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

// KONAKLAMA BAŞINA SAATLİK MESAJ TAVANI (kurucu kararı 10-11, karar listesi 15). IP kovası (dakikada 20) tek başına yetmiyordu: cihazı
// bağlayan kişi farklı IP'lerden sınırsız mesaj yazdırabiliyordu (her mesaj bir kayıt + kota). Tavanın üstünde yapay zekâ çağrılmaz,
// mesaj KAYDEDİLMEZ, misafir aşağıdaki metni görür (kurucu onaylı, AYNEN); ev sahibine saatte TEK kayıt düşer (konuşma "Ev sahibine
// iletildi" işareti + karar kaydı + açıksa uyarı e-postası).
const STAY_MESSAGES_PER_HOUR = 40;

/** Çıktıda acil arama yönergesi görülen ilk taslaktan sonra modele giden SABİT not (kurucu kararı 10-11). */
const QR_EMERGENCY_DIRECTIVE_RETRY_NOTE =
  "Önceki taslağın misafiri 112'yi / polisi / ambulansı / acil servisi aramaya yönlendiriyordu. Bu kanalda böyle bir yönerge ASLA yazılmaz. Yönerge cümlesi kurmadan yeniden cevap ver.";
/** Çıktıda kapı kodu görülen ilk taslaktan sonra modele giden SABİT not (kod yazılı, misafir metni / değer taşımaz). */
const QR_DOOR_CODE_RETRY_NOTE =
  "Önceki taslağın bir kapı / bina / anahtar kutusu / tuş paneli kodu içeriyordu. Bu QR kanalında böyle bir kod ASLA yazılmaz (geçmiş mesajlarda görünse bile). Kodu yazmadan yeniden cevap ver; misafir kodu ev sahibinin doğrudan mesaj kanalından alır.";
const STAY_MESSAGE_CAP_TEXT = "Şu anda çok fazla mesaj aldık. Ev sahibiniz bilgilendirildi; kısa süre sonra tekrar yazabilirsiniz.";

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
// yasaklıyor) ve o tarihteki kardeş devir metni (kaldırılan `escalationReply()`) zaten
// "ev sahibiniz" diyor — yani misafir, aynı sohbette iki farklı muhatap adı
// duyuyordu. Söz içeriği DEĞİŞMEDİ: mesaj kaydedildi, host sohbet ekranından görür.
// 🚨 YALNIZ GARANTİ EDİLEN SÖYLENİR (inceleme 09-10) — devir metinleriyle AYNI sözleşme.
// Eski metin: "Mesajınız ev sahibinize İLETİLDİ; sohbet ekranından size DÖNECEK." İki iddia da
// doğrulanamıyordu: (a) "iletildi" — mesaj KAYDEDİLİR, host'a e-posta bayrağa/dedupe'a/cooldown'a
// bağlıdır ve bu metin e-postadan ÖNCE yazılır; (b) "size dönecek" — host adına verilmiş bir SÖZ,
// ürün garanti edemez. Yeni metin yalnız VERİDEN okunabilen iki gerçeği söyler: mesaj kaydedildi
// ve bu sohbeti host devraldı (devir durumunun tanımı = thread'de host mesajı var).
// ⚠️ KAPSAM DÜRÜSTLÜĞÜ: bu metin bugün misafire GÖRÜNMÜYOR — `finalize` yalnız JSON döndürür
// (Message olarak yazılmaz) ve istemci POST'un `reply` alanını okumaz (GET otoriter). Yani
// düzeltilen şey CANLI kusur değil, sözleşmeyi delen LATENT iddiadır (test-pinli).
// K10 (kurucu kararı 09-30): devir metni misafire GİTMEZ — ev sahibi devraldığında yanıt yalnız `handoff: true` taşır (metin yok).

// ESKALASYON CEVABI: devirde misafire HİÇBİR metin gitmez (K10 09-30 + kurucu kararı 10-11 — fiziksel acildeki 112 satırı da
// kalktı). Ev sahibi QR sohbetleri panelinde "Ev sahibine iletildi" işaretini ve uyarıyı görür.

const notFound = () => new Response("Not found", { status: 404 });

/**
 * 🚨 DESTEK GÖRÜNÜMÜ MİSAFİR SOHBETİNE GİRMEZ (kurucu kararı 09-30): bürünmüş operatörün tarayıcısı bu uçlara geldiğinde sohbet
 * AÇILMAZ ve konaklama cihaza BAĞLANMAZ — ilk açan cihaz sohbeti kilitlediği için operatörün bir göz atması gerçek misafiri dışarıda
 * bırakırdı. Karar bağlama / okuma / gönderme ÖNCESİ verilir. Konuşmalar panelde ("QR Misafir Sohbetleri") cihaz bağlamadan okunur.
 * Yalnız imzası doğrulanmış bürünme oturumu (`actorUserId`) sayılır; çerezsiz tarayıcı sıradan ziyaretçidir (bağlantı destek
 * görünümünde zaten gösterilmez).
 */
async function supportViewRefusal(req: Request): Promise<Response | null> {
  if (!(await isSupportViewCookieHeader(req.headers.get("cookie")))) return null;
  return NextResponse.json({ ok: false, error: SUPPORT_VIEW_GUEST_CHAT_MESSAGE }, { status: 403 });
}

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
/** Kapanış kararı için konuşmanın son mesajları (kronolojik): yazar, sistem olayı, niyet — misafir metni kalıcı yazılmaz. */
async function loadClosingThread(conversationId: string): Promise<(ClosingThreadMessage & { id: string })[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true, aiIntent: true },
  });
  return rows.reverse();
}

/** Son cevaptan (yapay zekâ ya da ev sahibi) sonraki misafir mesajları — yapay zekâ duraklatılmışken yazılanlar dahil. */
function unansweredGuestTextsOf(thread: readonly ClosingThreadMessage[]): string[] {
  let lastReply = -1;
  thread.forEach((m, i) => {
    if (replyAuthorOf(m) !== null) lastReply = i;
  });
  return thread
    .slice(lastReply + 1)
    .filter((m) => m.direction === "inbound")
    .map((m) => m.body);
}

/**
 * Record a guest-chat exchange (the guest's question + the bot's reply) on an
 * EXISTING conversation. Runs on the given client — inside the per-thread
 * locked transaction on the guest route — so the paused-recheck and this
 * insert are atomic against a concurrent host reply. Escalated exchanges are
 * flagged via priority "urgent" (and stay urgent once set).
 */
/** Y3 (10-14 dış inceleme): kayıt anında konaklama silinmiş — hiçbir şey yazılmaz, misafire "sohbet kapalı" döner. */
const NO_ACTIVE_STAY_REPLY =
  "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız varsa lütfen giriş gününüzde tekrar deneyin.";

class StayErasedError extends Error {
  constructor() {
    super("qr_stay_erased");
  }
}

/**
 * SİLME SINIRI QR YAZMASINDA (Y3): model çağrısı sürerken misafirin verisi silinirse bekleyen istek ham mesajı ve eski adı GERİ
 * yazıyordu (giriş kapısı yalnız istek başında bakıyordu). Öteki girişlerle aynı iki-sıralama kuralı (`erasure.ts` RACE MODEL): yazma
 * işlemi ÖNCE işletmenin silme kilidini alır, sonra kapıyı İŞLEM İÇİNDE yeniden okur. Uzun model çağrısı kilidin DIŞINDA kalır.
 * Rezervasyonun GÜNCEL adını döner (istek başındaki anlık görüntü değil). Kilit sırası: silme kilidi → konuşma kilidi (silme işi konuşma
 * kilidi almaz → döngü yok).
 */
async function assertStayNotErased(tx: Prisma.TransactionClient, organizationId: string, reservationId: string): Promise<string> {
  await acquireErasureLock(tx, organizationId);
  const guard = await loadErasureGuard(organizationId, tx);
  const live = await tx.reservation.findUnique({ where: { id: reservationId }, select: { guestName: true, sourceReference: true } });
  if (!live || live.guestName === ANON_NAME || guard.blocksSourceReference(live.sourceReference)) throw new StayErasedError();
  return live.guestName;
}

/**
 * QR yazma işlemlerinin süre sınırı: silme kilidi işletme genelidir — bir konuşma içe aktarımı ya da silme sürerken misafirin yazması
 * kilidi BEKLER (Prisma'nın 5 sn varsayılanı kısa beklemeleri de 500'e çeviriyordu, Haiku 10-14). 30 sn'yi aşan bekleme (uzun silme)
 * hiçbir şey YAZMADAN geri alınır ve istek hata döner — kapalı yönde biter, talep bırakılır, misafir yeniden gönderebilir.
 */
const QR_TX = { timeout: 30_000, maxWait: 10_000 } as const;

/** Y3: konuşma satırı (misafir adını taşır) da silme sınırının arkasında açılır — model çağrısından ÖNCEKİ okuma noktaları için. */
async function ensureGuardedQrConversation(organizationId: string, propertyId: string, reservationId: string): Promise<string> {
  // Konuşma zaten varsa okuma yazma yapmaz → kilit gerekmez (mesaj başına kilit sayısı az kalsın). Yalnız İLK açılış (adı yazar) korunur.
  const existing = await findGuestChatConversationId(propertyId, reservationId);
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const guestName = await assertStayNotErased(tx, organizationId, reservationId);
    return ensureGuestChatConversation(propertyId, { id: reservationId, guestName }, tx);
  }, QR_TX);
}

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
  // KAPANIŞA SESSİZLİK (kurucu kuralı 09-25): misafir yalnız teşekkür/onay yazdı, bilerek cevap verilmedi.
  //  · "handled" → "cevap gerekmedi" izi (`conversation-attention.ts`): karar + damga AYNI anda, son mesaja eşit. Misafir
  //    yeniden yazınca `lastMessageAt` damgayı geçer, iz kendiliğinden düşer.
  //  · "open" → yine hiçbir şey gönderilmedi ama açık iş olabilir (`closingMayHide`) → konuşma GÖRÜNÜR kalır.
  closing: false | "handled" | "open" = false,
): Promise<{ inboundMessageId: string }> {
  const touchedAt = new Date();
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: touchedAt,
      ...(escalated ? { priority: "urgent" } : {}),
      ...(closing === "handled" ? { skippedReason: CLOSING_HANDLED_REASON, autoReplyAttemptedAt: touchedAt } : {}),
      ...(closing === "open" ? { skippedReason: CLOSING_OPEN_REASON } : {}),
    },
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
 * HOST HANDOFF (migration-free): the AI hands off when a human host replies and stays paused until the host EXPLICITLY
 * re-enables it — never on a timer (the host may have stepped into a sensitive matter the AI would misread later). State is
 * derived from the most recent NON-bot outbound event: a host reply pauses; a resume event (written by the panel button)
 * re-opens. A new reservation opens a fresh thread → AI active. Single source + one-row read: `guestChatAiPausedForStay`
 * (`@/lib/guest-chat`; night audit 09-28 — this route used to read the WHOLE thread, twice per guest message, once under the
 * thread lock).
 */

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
/** Misafir mesajından silinen denetim karakterleri (U+0000–U+001F ve U+007F; sekme, satır sonu, satır başı HARİÇ). */
const GUEST_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Misafir sohbeti yanıtları (geçmiş dahil) hiçbir ara katmanda / tarayıcı önbelleğinde tutulmaz — ortak bir cihazda sonraki kullanıcı
// görmesin (Haiku QR güvenlik taraması 10-10). Bütün dallar (hata dahil) sarmalayıcıdan geçer.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return noStore(await handleGuestChatGet(req, ctx));
}

async function handleGuestChatGet(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();
  const limited = await rateLimit(`guestchat-get:${rateLimitClientKey(req)}`, 60, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const supportView = await supportViewRefusal(req);
  if (supportView) return supportView;

  const { token } = await params;
  // Bu uç bilgi tabanını KULLANMAZ (istemci 5 sn'de bir çağırır) → çekilmez / taranmaz (#211). Yanıt birebir aynı.
  const ctx = await resolveGuestChat(token, undefined, { knowledgeBase: false });
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
    return noStore(await handleGuestChatPost(req, ctx));
  } catch (err) {
    return noStore(serverError("Şu anda yanıt veremiyoruz — lütfen birazdan tekrar deneyin.", err));
  }
}

async function recordCancelledStayMessage(
  ctx: GuestChatContext,
  stay: NonNullable<GuestChatContext["cancelledStay"]>,
  message: string,
  requestId: string | null,
): Promise<void> {
  try {
    // Aynı istemci isteğinin yeniden denemesi (bağlantı kopması) ikinci kez kaydedilmez, tavandan hak yemez (Haiku 10-12).
    if (requestId) {
      const once = await rateLimit(`qr-cancelled-req:${stay.id}:${requestId}`, 1, 60 * 60_000);
      if (!once.ok) return;
    }
    const cap = await rateLimit(`qr-cancelled-stay:${stay.id}`, CANCELLED_STAY_MESSAGES_PER_HOUR, 60 * 60_000);
    if (!cap.ok) return;
    const { inboundMessageId } = await prisma.$transaction(async (tx) => {
      const guestName = await assertStayNotErased(tx, ctx.property.organizationId, stay.id); // Y3: silme sınırı
      const conversationId = await ensureGuestChatConversation(ctx.property.id, { id: stay.id, guestName }, tx);
      await acquireGuestChatThreadLock(tx, conversationId);
      return recordGuestChatExchange(tx, conversationId, guestName, message, null, true, ctx.property.organizationId);
    }, QR_TX);
    // E-posta: konaklama başına KAYAN 6 saatte en çok bir (dilim sınırında iki e-posta olmasın — Haiku 10-12). Gitmezse hak geri.
    const slot = await rateLimit(cancelledStayMailKey(stay.id), 1, CANCELLED_STAY_ALERT_WINDOW_MS);
    if (!slot.ok) return;
    const mail = await maybeSendQrEscalationEmail({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: stay.id,
      eventId: `cancelled-stay:${inboundMessageId}`,
      reason: "cancelled_stay",
    });
    if (!mail.sent) await returnCancelledStayMailSlot(stay.id);
  } catch (err) {
    if (err instanceof StayErasedError) return; // silinmiş konaklama: kayıt yok (beklenen, hata değil)
    // Misafire giden cevap bu yola bağlı DEĞİL (her durumda "sohbet kapalı").
    void reportError(`qr-cancelled-stay org=${ctx.property.organizationId}`, err);
  }
}

async function handleGuestChatPost(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Global kill-switch read at request time (flip without a rebuild).
  if (process.env.GUEST_CHAT_ENABLED !== "1") return notFound();

  // JSON kontrolü IP kovasından ÖNCE (#211; kimlik rotalarıyla aynı kural): başka bir site, misafirin tarayıcısından `text/plain` POST
  // attırıp dairedeki ağın sohbet kovasını yakamasın. Geçersiz JSON gövde kovayı YİNE tüketir.
  if (!hasJsonContentType(req)) return unsupportedMediaType();

  // Public + unauthenticated → cap per IP first.
  const ipLimit = await rateLimit(`guestchat-ip:${rateLimitClientKey(req)}`, 20, 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);
  const supportView = await supportViewRefusal(req);
  if (supportView) return supportView;

  const { token } = await params;

  const bodyResult = await parseJsonBody<{ message?: unknown; pin?: unknown; requestId?: unknown }>(req);
  if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
  const body = bodyResult.ok ? bodyResult.data : null;
  const pinInput = typeof body?.pin === "string" ? body.pin : null;
  // Denetim karakterleri (NUL vb.; sekme / satır sonu HARİÇ) sessizce silinir — PostgreSQL metin alanı NUL yazamaz, eskiden 500 + hata
  // raporu üretiyordu (Haiku QR taraması 10-10; sağlayıcı dizesindeki NUL kuralıyla aynı). Misafire giden hiçbir metin değişmez.
  const message = typeof body?.message === "string" ? body.message.replace(GUEST_CONTROL_CHARS, "").trim() : "";
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
    // İPTAL EDİLMİŞ konaklama şu anı kapsıyorsa (kurucu 10-12): model ÇAĞRILMAZ (kota düşmez), yazana aynı "sohbet kapalı" cevabı
    // gider (iptal bilgisi verilmez), mesaj ev sahibi için panele kaydedilir ve ev sahibine "iptal edilmiş rezervasyonun dairesinden
    // yazılıyor" uyarısı gider. Tekrar yazışma da aynı yoldan; e-posta en çok 6 saatte bir, kayıt saatte en çok N mesaj.
    if (ctx.cancelledStay && message && message.length <= MAX_MESSAGE) {
      // Yanıt bu işi BEKLEMEZ (süre farkı iptal kaydını sızdırmasın); iş yanıttan sonra tamamlanır.
      runDetached(recordCancelledStayMessage(ctx, ctx.cancelledStay, message, requestId));
    }
    return jsonOk({ closed: true, reply: NO_ACTIVE_STAY_REPLY });
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
  // ── KONAKLAMA BAŞINA SAATTE 40 MESAJ (↑`STAY_MESSAGES_PER_HOUR`) ── bağlı cihazdan gelen her YENİ mesaj sayılır (devir / kapanış dahil:
  // tavanın amacı sınırsız kayıt + çağrıyı kesmek). İstek kimliği sahiplenmesinden SONRA (Haiku incelemesi 10-11): yanıtı kaybolmuş bir
  // mesajın tekrar denemesi yukarıda "duplicate" döner, sayılmaz. Tavanda sahiplenme BIRAKILIR (mesaj hiç işlenmedi; misafirin sonraki
  // denemesi normal işlenir). 429 + metin: istemci gönderilmemiş balonu geri alır, yazılan metni geri koyar ve metni gösterir.
  const stayLimit = await rateLimit(`guestchat-stay:${res.id}`, STAY_MESSAGES_PER_HOUR, 60 * 60_000);
  if (!stayLimit.ok) {
    if (claimScopeId) await releaseKeyedOutboundSend(claimScopeId);
    // Ev sahibine saatte TEK kayıt (aynı pencerede ikinci aşım hiçbir şey yazmaz). Kayıt yazılamazsa misafirin cevabı yine döner;
    // hata raporlanır (genel 500 yerine onaylı metin).
    try {
      const firstOverflow = await rateLimit(`guestchat-stay-capnote:${res.id}`, 1, 60 * 60_000);
      if (firstOverflow.ok) {
        const capEventId = `stay-cap:${res.id}:${Math.floor(Date.now() / 3_600_000)}`;
        const conversationId = await ensureGuardedQrConversation(ctx.property.organizationId, ctx.property.id, res.id);
        await prisma.conversation.update({ where: { id: conversationId }, data: { priority: "urgent" } });
        await recordRiskEvent({
          organizationId: ctx.property.organizationId,
          propertyId: ctx.property.id,
          conversationId,
          surface: "guest_chat",
          triggerId: capEventId,
          finalDecision: "human_review",
          reason: "stay_message_cap",
        });
        await sendQrEscalationAlertBounded({
          organizationId: ctx.property.organizationId,
          propertyName: ctx.property.name,
          reservationId: res.id,
          eventId: capEventId,
          reason: "stay_message_cap",
          critical: false,
        });
      }
    } catch (err) {
      if (!(err instanceof StayErasedError)) void reportError(`qr-stay-cap-notice org=${ctx.property.organizationId}`, err);
    }
    const capped = tooManyRequests(stayLimit.retryAfter, STAY_MESSAGE_CAP_TEXT);
    // Cihaz bu istekte bağlandıysa çerez YİNE kurulur (yoksa misafir bir sonraki mesajda "başka cihazda" görürdü).
    if (binding.status === "bound") setStayCookie(capped, cookieName, binding.secret, res.departureDate);
    return capped;
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
  const record = async (botReply: string | null, escalated: boolean, closing: false | "handled" | "open" = false) => {
    const out = await prisma.$transaction(async (tx) => {
      // Y3: silme kilidi + kapı İŞLEM İÇİNDE; konuşma satırı da (adı taşır) bu sınırın arkasında açılır.
      const guestName = await assertStayNotErased(tx, ctx.property.organizationId, res.id);
      const conversationId = await ensureGuestChatConversation(ctx.property.id, { id: res.id, guestName }, tx);
      await acquireGuestChatThreadLock(tx, conversationId);
      if (botReply !== null && (await guestChatAiPausedForStay(ctx.property.id, res.id, tx))) {
        const r = await recordGuestChatExchange(tx, conversationId, guestName, message, null, true, ctx.property.organizationId);
        return { ...r, handedOff: true, conversationId };
      }
      const r = await recordGuestChatExchange(tx, conversationId, guestName, message, botReply, escalated, ctx.property.organizationId, closing);
      return { ...r, handedOff: false, conversationId };
    }, QR_TX);
    recorded = true;
    // `conversationId` dışarıya taşınır: karar gerekçesi kaydı (RiskEvent) konuşmaya
    // bağlanabilsin — kurucu konsolunda "hangi sohbette hangi kapı kapattı" izlenir.
    return out;
  };
  try {

  // HOST HANDOFF (pre-check): if a human host has already replied in this thread,
  // the AI has handed off for the rest of the stay. Record the guest's message for
  // the host and DON'T spend a (paid) model call — the human owns the conversation.
  // Re-checked once more just before an AI reply would be stored (send-time veto
  // below), which also catches a host reply that lands WHILE the model is running.
  if (await guestChatAiPausedForStay(ctx.property.id, res.id)) {
    await record(null, true);
    return finalize({ handoff: true });
  }

  // ── KAPANIŞA SESSİZLİK (kurucu kuralı 09-25, `ai/closing-turn.ts`) ─────────────────────────────────────────────
  // Misafir yalnız teşekkür/onay yazdı ("Teşekkürler", "Tamamdır", "👍") → HİÇBİR ŞEY gönderilmez, ev sahibine
  // devir/uyarı da yok. Eskiden bu mesajlar düşük güvenden devrediliyor, misafir "kaydedildi; ev sahibiniz görebilir"
  // alıyor ve host uyarılıyordu. Model çağrısı ve günlük kota birimi harcanmaz. Kanalla AYNI kurallar (inceleme 09-25):
  //  · kapanışa uygun nokta şart (`closableAfter`: misafirden sonra gitmiş bir cevap var — ilk mesaj bir selamdır — ve
  //    yapay zekânın son cevabı soru/teklif değil: "…gönderebilirim" → "Olur" bir CEVAPTIR);
  //  · son cevaptan sonraki TÜM misafir mesajları kapanış olmalı (yapay zekâ duraklatılmışken yazılmış, ev sahibinin
  //    cevaplamadığı bir soru bir "teşekkürler"in arkasında kaybolmasın);
  //  · konuşma yalnız açık iş yoksa "cevap gerekmedi" diye gizlenir (`closingMayHide`), yoksa görünür kalır.
  const closingThread = await loadClosingThread(await ensureGuardedQrConversation(ctx.property.organizationId, ctx.property.id, res.id));
  const qrUnanswered = [...unansweredGuestTextsOf(closingThread), message];
  const qrClosable = closableAfter(closingThread);
  const qrHideDecision = async () =>
    closingMayHide({
      messages: closingThread,
      openHostWork: await hasOpenHostWork(ctx.property.organizationId, closingThread),
    });
  if (qrClosable && lexicalClosingOnly(qrUnanswered)) {
    const { inboundMessageId, conversationId } = await record(null, false, (await qrHideDecision()) ? "handled" : "open");
    await recordRiskEvent({
      organizationId: ctx.property.organizationId,
      propertyId: ctx.property.id,
      conversationId,
      surface: "guest_chat",
      triggerId: inboundMessageId,
      finalDecision: "no_reply",
      reason: "closing_ack",
    });
    return finalize({ noReply: true });
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
  // 🚨 TEHLİKEDE MİSAFİRE HİÇBİR ŞEY GİTMEZ (kurucu kararı 10-11: "112'yi arayın yazmasın … yönlendirme olmayacak hiçbir şekilde").
  // 55 + 51'in (10-02) koddan giden "Tehlike varsa hemen 112'yi arayın." satırı KALKTI: tehlike bağlamla tanınır (`ai/hazard-evidence.ts`),
  // misafirin mesajı kaydedilir, ev sahibine ACİL uyarı gider, misafire cevap gitmez (devir cümlesi yasağıyla — K10 — aynı).
  const hazard = hazardEvidenceOf(message);
  const lineLanguage = confidentLanguage(message);
  // AÇIK tehlike: modeli BEKLEMEDEN devir. Ücretli çağrı yapılmaz, AI kotası tüketilmez; ev sahibine kritik uyarı (bekleme süresini aşar).
  if (hazard.level === "clear") {
    // Misafir numarayı AÇIKÇA sorduysa yalnız o servisin numarası gider (kurucu 10-11: "sorulursa numarasını verebilir"; anahtar
    // `AI_EMERGENCY_NUMBER_ENABLED` KAPALI → bugünkü gibi hiçbir şey). Yönerge yok; ev sahibi sözcüğü varsa yine hiçbir şey.
    const fastOrgTz = emergencyNumberEnabled()
      ? orgTimezone((await prisma.organization.findUnique({ where: { id: ctx.property.organizationId }, select: { timezone: true } }))?.timezone)
      : null;
    const fastNumber = fastOrgTz
      ? emergencyNumberReply({
          message,
          timeZone: fastOrgTz,
          language: lineLanguage,
          understandingIntents: null,
          hazard: true,
          earlierGuestTexts: qrUnanswered.slice(0, -1),
        })
      : null;
    const reply = fastNumber?.text ?? null;
    const fast = await record(reply, true);
    if (fast.handedOff) return finalize({ handoff: true });
    await recordRiskEvent({
      organizationId: ctx.property.organizationId,
      propertyId: ctx.property.id,
      conversationId: fast.conversationId,
      surface: "guest_chat",
      triggerId: fast.inboundMessageId,
      finalDecision: "human_review",
      riskLevel: "high",
      riskType: "safety_emergency",
      reason: "physical_hazard",
      confidence: null,
    });
    await sendQrEscalationAlertBounded({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      eventId: qrEscalationEventId(fast.inboundMessageId, message, true),
      reason: fastNumber ? "emergency_number" : "ai_escalated",
      critical: true,
    });
    return finalize({ escalated: true, reply });
  }

  const dailyAiCap =
    (await limitsForOrg(ctx.property.organizationId).catch(() => null))?.qrQuestionsPerPropertyPerDay ??
    DAILY_AI_CAP_FALLBACK;

  if (usage.count > dailyAiCap) {
    const reply = null;
    const { inboundMessageId, handedOff } = await record(reply, true);
    // A host reply raced in → the human owns the thread; the canned line was
    // vetoed under the lock and only the guest's message was stored.
    if (handedOff) return finalize({ handoff: true });
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
  const budget = await consumeDailyAiBudgetForQr(ctx.property.organizationId, ctx.property.id);
  if (!budget.ok) {
    const escalationText = null;
    const { inboundMessageId, handedOff } = await record(escalationText, true);
    if (handedOff) return finalize({ handoff: true });
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
    select: { aiStyleProfile: true, timezone: true },
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
  const priorConversationId = await ensureGuardedQrConversation(ctx.property.organizationId, ctx.property.id, res.id);
  const contextWindow = await buildGuestChatContextWindow(priorConversationId);
  const { openTopics, hasPriorOperatorReply } = contextWindow;
  // GEÇMİŞTEKİ KAPI KODU MODELE GİTMEZ (kurucu kararı 10-11): ev sahibinin / yapay zekânın yazdığı satırlarda kapı / kutu / giriş kodunun
  // DEĞERİ "(kod gizlendi)" olur — model görmediği kodu yazamaz. Kapı, injection taraması ve model AYNI diziyi görür (↓tek `history`).
  const history = contextWindow.history.map((h) => (h.direction === "outbound" ? { ...h, body: redactDoorCodes(h.body) } : h));
  // Konuşma Anlama Durumu v1 dilim B (bayraklı; kapalıyken sorgu yok). Metin/PII taşımaz: yalnız sayılar ve kapalı-küme
  // konu/durum kodları — anonim yüzeye güvenli.
  const conversationRecords = await loadConversationStateForConversation({
    organizationId: ctx.property.organizationId,
    conversationId: priorConversationId,
    reservationId: res.id,
    pendingGuestMessage: true, // bu mesaj cevabıyla birlikte kaydedilir (↓recordGuestChatExchange)
    pendingGuestText: message,
    timeZone: orgTimezone(org?.timezone),
  });

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
    // Kanalın ayrı hitap adı da (migration 57; 09-28 inceleme): tam adın ilk sözcüğü değilse yalnız bununla silinir.
    redactNames: [res.guestName, res.guestGivenName],
    // Anlama katmanının tarih satırı (bayrak açıkken): QR'da rezervasyon ayrıntısı bilinçli verilmez → yalnız bugün/yarın.
    dateContext: { now: new Date(), timeZone: org?.timezone },
  });
  const kbDroppedTotal = ctx.knowledgeBaseDropped + kbSel.droppedItems;

  const replyInput: Parameters<typeof suggestReply>[0] = {
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
    // Adsız yapay zekâ anahtarı AÇIKKEN cevap isteminden adı silmek için (09-28 inceleme: QR'da silme anahtarı hiç yoktu). Anahtar
    // kapalıyken bu alan istemde KULLANILMAZ — ad modele bu alandan gitmez.
    guestIdentifier: res.guestName,
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
    conversationState: { isFirstOperatorReply: !hasPriorOperatorReply, records: conversationRecords },
    tone: "warm",
    language: "tr",
    // ⚠️ STİL REHBERİ HALKA AÇIK YÜZEYE HAM GİRMEZ (denetim, 08-01). Rehber, ev
    // sahibinin geçmiş misafir cevaplarından bir modelle damıtılıyor ve o cevaplar
    // rutin olarak Wi-Fi şifresi / kapı kodu içeriyor; damıtma isteminde "koyma"
    // yazılı olması bir MODEL RİCASIDIR, deterministik garanti değil. Bu modülün
    // değişmezi ise "sır bağlama HİÇ girmez". Aynı deterministik detektör
    // (bilgi tabanını elediği detektör) rehbere de uygulanır.
    styleProfile: styleProfileForPrompt(org?.aiStyleProfile),
    // "Bugün / yarın" org diliminde (`stay-timeline.ts`). Rezervasyon ayrıntısı QR'da BİLEREK yok; bugünün tarihi kişisel
    // veri değildir ("çöp bugün mü alınıyor?" gibi soruları çözer).
    timeZone: org?.timezone,
  };
  const replyStartedAt = Date.now();
  let result = await suggestReply(replyInput);
  // Üretim izi için: yeniden yazdırma yedeğe düşse de İLK çağrı modele gittiyse karar izlenir (Haiku 10-12).
  const firstModelCalled = result.source === "openai" || Boolean(result.llmUsage);

  // ── ÇIKTIDA KAPI KODU → BİR KEZ YENİDEN YAZDIR, SONRA DEVİR (kurucu kararı 10-11, karar listesi 18: "taransın ama response geri
  // dönsün … sonra tekrar response üretilse olmaz mı, ev sahibine devir çok olmasın"). Bilgi tabanı kapı kodu taşımaz ama ev sahibinin
  // QR'a elle yazdığı kod GEÇMİŞTEN modele ulaşabilir. Kodlu taslak hiçbir yere yazılmaz; model kuralı not olarak alıp bir kez daha
  // yazar (gerçek ikinci çağrı → QR kotasından bir birim daha). İkinci taslak da kod taşıyorsa ya da kota yoksa cevap gitmez, devir.
  // Aynı yol ACİL ARAMA YÖNERGESİ için de (kurucu kararı 10-11: "112'yi arayın yazmasın"): yönergeli taslak bir kez yeniden yazdırılır;
  // ikincisi de yönergeliyse kapı (`emergency_directive`) devreder.
  const modelKbTexts = kbSel.items.map((i) => `${i.title}\n${i.content}`);
  const firstDoorCode = Boolean(result.reply) && qrReplyHasDoorCode(result.reply, modelKbTexts);
  const firstDirective = hasEmergencyCallDirective(result.reply);
  let doorCodeHeld = false;
  if (firstDoorCode || firstDirective) {
    const retryBudget = await consumeDailyAiBudgetForQr(ctx.property.organizationId, ctx.property.id);
    if (retryBudget.ok) {
      const notes = [
        ...(kbSel.notes ?? []),
        ...(firstDoorCode ? [QR_DOOR_CODE_RETRY_NOTE] : []),
        ...(firstDirective ? [QR_EMERGENCY_DIRECTIVE_RETRY_NOTE] : []),
      ];
      result = await suggestReply({ ...replyInput, knowledgeBaseNotes: notes });
      doorCodeHeld = Boolean(result.reply) && qrReplyHasDoorCode(result.reply, modelKbTexts);
    } else {
      doorCodeHeld = firstDoorCode; // yönerge kotasız da gitmez: kapı `emergency_directive` ile devreder
    }
  }
  // İz gecikmesi = yalnız cevap modeli çağrıları (yeniden yazdırma dahil) — kanal iziyle aynı tanım; bekçi / kod metni sorgusu dışarıda.
  const replyLatencyMs = Date.now() - replyStartedAt;

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
  // 51: bağlam kararı — olası / anılan fiziksel tehlikede kararı anlama katmanı verir; açık tehlike ↑ zaten devredildi. Katman
  // koşmadıysa (kapalı / düştü) olası tehlike güvenli tarafta kalır, anılan tehlike acile ÇEVRİLMEZ.
  const hazardDecision = hazardDecisionFor(
    { texts: [message], understandingRan: understood != null, understandingEmergency: understandingRiskOf(understood) === "emergency" },
    isSafetyEmergencyText,
  );
  let stayCtx: Parameters<typeof evaluateEscalation>[4] = {
    stayTimes: { checkIn: ctx.property.checkInTime, checkOut: ctx.property.checkOutTime },
    understanding: understood?.stay ?? null,
    understandingFailed: (await kbSel.understandingStatus) === "failed",
    // Anlama katmanının risk niyeti (acil/şikâyet/iptal-iade/insan) — kanal kapısıyla parite; katman koştuysa karar verir.
    understandingRisk: understandingRiskOf(understood),
    // Modelin gördüğü bilgi tabanı (24 EK): yazılı sabit otopark yeri tahsisi takvim iddiası sayılmaz — kanalla parite.
    kbFacts: kbFactsOf(kbSel.items),
    // 56: kodun dil tespiti emin değilken (kısa / karışık soru) misafirin dili için MODEL görüşü — önce bağımsız anlama katmanı.
    guestLanguageHint: understood?.language ?? result.detectedLanguage ?? null,
    // 51: kelime ağının fiziksel tehlike etiketi bağlamla kalktı mı (olası / anılış + model "acil değil").
    hazardCleared: hazardDecision.lexicalCleared,
    hazardClearedAsIssue: hazardDecision.clearedAsIssue,
  };
  const gateResult = { ...result, reply: result.reply, usedSources: result.usedSources };
  let verdict = evaluateEscalation(gateResult, message, res.guestName, history, stayCtx);
  if ((!verdict.escalate || verdict.reason === "availability_unconfirmed") && stayGuardEnabled()) {
    const stayGuard = await runStayChangeGuard({
      guestMessages: [message],
      reply: result.reply,
      stayTimes: stayCtx?.stayTimes,
      names: [res.guestName, res.guestGivenName],
      // Modelin gördüğü AYNI pencere (takip izni bağlamla anlaşılır).
      history,
    });
    if (stayGuard) {
      stayCtx = { ...stayCtx, stayGuard };
      verdict = evaluateEscalation(gateResult, message, res.guestName, history, stayCtx);
    }
  }
  // ── DOĞRULANMIŞ MÜSAİTLİK / UZATMA → KOD METNİ (QR; anahtar `AI_VERIFIED_QR_ENABLED`, VARSAYILAN KAPALI → hiç sorgu yok) ─────────────
  // Kanal akışıyla aynı: misafire giden metin MODELİN DEĞİL, koddan kurulan tek cümle; QR kapısı bu metinle BAŞTAN koşar (muafiyet yalnız
  // birebir metne + anlama katmanı + bekçi; acil / injection / dil / güven aynen). Tek cevapsız mesaj, modelin niyeti riskli değil.
  // Bekçi bu turda koşmadıysa kod metniyle koşturulur; hüküm yalnız metin seçilirse bağlama yazılır.
  let finalResult = result;
  if (verifiedQrEnabled() && qrUnanswered.length === 1 && !ESCALATE_INTENTS.has(result.intent)) {
    const code = await loadQrVerifiedStay({
      organizationId: ctx.property.organizationId,
      propertyId: ctx.property.id,
      timeZone: orgTimezone(org?.timezone),
      message,
      language: lineLanguage,
      reservation: { arrivalDate: res.arrivalDate, departureDate: res.departureDate, channel: res.channel ?? null, status: res.status },
      understood: understood ?? null,
    }).catch((err) => {
      void reportError(`qr-verified-stay org=${ctx.property.organizationId}`, err);
      return null;
    });
    if (code) {
      const codeResult = codeBuiltResult(result, code.text, code.kind === "extension" ? "extend_stay" : "availability");
      const guard =
        stayCtx?.stayGuard ??
        (stayGuardEnabled()
          ? await runStayChangeGuard({
              guestMessages: [message],
              reply: code.text,
              stayTimes: stayCtx?.stayTimes,
              names: [res.guestName, res.guestGivenName],
              history,
            })
          : undefined);
      const codeCtx = {
        ...stayCtx,
        stayGuard: guard,
        ...(code.kind === "extension" ? { verifiedExtension: { text: code.text } } : { verifiedAvailability: { text: code.text } }),
      };
      const codeVerdict = evaluateEscalation({ ...codeResult, usedSources: [] }, message, res.guestName, history, codeCtx);
      if (!codeVerdict.escalate) {
        finalResult = codeResult;
        stayCtx = codeCtx;
        verdict = codeVerdict;
      }
    }
  }
  // Kapı kodu ikinci taslakta da kaldı (↑) → cevap gitmez. Doğrulanmış kod metni seçildiyse o metin modelin değildir, kod taşımaz.
  if (doorCodeHeld && finalResult === result) verdict = { escalate: true, reason: "door_code_in_reply" };
  const escalate = verdict.escalate;

  // ÜRETİM İZİ (kurucu kararı 10-12 öğle, Ö5 "QR izini de yaz"; anahtar `AI_GENERATION_TRACE_ENABLED` KAPALI → yazım yok): kanal izinin
  // AYNISI — model çağrıldıysa her karar (gönderildi / devir / sessiz kapanış). Taslak = modelin SON taslağı; gönderilen = misafire giden
  // gövde (yalnız gönderimde). Kanıt karar kaydıyla AYNI nesneden. Bağlam tanısı QR penceresinin kendi kurucusundan. Asla fırlatmaz.
  // Kanal iziyle AYNI koşul: yedek (modelsiz) cevapta iz yok. Ev sahibi model çalışırken yazdıysa (`handedOff`) karar kaydı gibi iz de yok.
  // Araç özeti (`toolResults`) QR'da YOK: `loadQrVerifiedStay` yalnız metin döndürür (kanal izinde var). Token kullanımı SON çağrınınki
  // (kanalla aynı). Acil numara yolunda kod metni gider ama karar kaydı gibi iz de `human_review` + `emergency_number` der; gönderilen
  // yalnız `auto_sent` kararında yazılır (yazıcı sözleşmesi) — gerekçe kodu ne gittiğini söyler.
  const traceQr = async (input: {
    decision: "auto_sent" | "human_review" | "no_reply";
    conversationId: string;
    triggerMessageId: string;
    gateReason: string | null;
    kbEvidenceJson: string | null | undefined;
    sentText: string | null;
  }) => {
    if (!aiGenerationTraceEnabled() || !(firstModelCalled || result.source === "openai" || result.llmUsage)) return;
    try {
      await recordAiGeneration({
        organizationId: ctx.property.organizationId,
        propertyId: ctx.property.id,
        reservationId: res.id,
        conversationId: input.conversationId,
        triggerMessageId: input.triggerMessageId,
        surface: "qr",
        model: replyCallParams().model,
        promptVersion: replyPromptVersion(replyPromptItemsOf(replyInput.conversationItems)),
        decision: input.decision,
        gateReason: input.gateReason && ESCALATION_REASON_CODES.has(input.gateReason) ? input.gateReason : null,
        kbEvidenceJson: input.kbEvidenceJson ?? null,
        latencyMs: replyLatencyMs,
        llm: result.llmUsage ?? null,
        draftText: result.reply,
        sentText: input.sentText,
        contextDiagnostics: contextWindow.diagnostics ?? null,
      }, {
        // Y3: iz satırı da silme sınırının arkasında — konaklama arada silindiyse taslak / gönderilen metin yazılmaz.
        guard: (tx) =>
          assertStayNotErased(tx, ctx.property.organizationId, res.id).then(
            () => true,
            (e) => {
              if (e instanceof StayErasedError) return false;
              throw e;
            },
          ),
      });
    } catch (err) {
      void reportError(`ai-generation-trace org=${ctx.property.organizationId}`, err);
    }
  };

  // Karar kaydının temellendirme alanları — iki kayıt (kapanış / cevap-devir) AYNI nesneyi yazar.
  // Kanıt GÖNDERİLEN sonucu betimler (doğrulanmış kod metni seçildiyse onu — Haiku 10-09: kayıt atılan taslağı anlatıyordu); risk niyeti
  // modelin etiketidir (kod metni niyeti ezmez).
  const auditFields = async () => ({
    // A2 — TEMELLENDİRME: gerekçe tek başına "neden dayanamadı"yı söylemiyor.
    // Kodun bildiği (kaç kalem gitti, kaçı onay bekliyor, kaçı tavandan düştü,
    // hangi bilgi sürümü) ile modelin BEYANI yan yana yazılır; ikisi ayrı
    // olmadan "bilgi yok" ile "bilgi vardı, kullanılmadı" ayrılamaz.
    // §C: pack karakter bütçesinin kestiği kalemler de sayılır. `kbDroppedTotal`
    // istem-ÖNCESİ sayıdır; `finalResult.kbOmittedInPrompt` istemin TOPLAMIDIR
    // (ön düşüşler DÂHİL) → EKLENMEZ, DEĞİŞTİRİLİR (çift sayım olurdu).
    // Model çağrılmadıysa alan `undefined` gelir ve sayaçlara DOKUNULMAZ (A2).
    ...applyPromptKbAudit(
      { kbRetrieved: kbSel.items.length, kbDropped: kbDroppedTotal },
      finalResult.kbOmittedInPrompt,
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
      usedLabels: finalResult.usedSources ?? [],
      // Anlama katmanı paralel koştuysa özeti burada eklenir (kapı onu zaten bekledi).
      retrieval: await kbSel.evidenceAfterUnderstanding(),
      // GÖLGE ölçüm (karar DEĞİL): modelin taslağındaki somut iddiaların desteği + token kullanımı.
      // Misafir devir metnini alsa bile bu, MODELİN taslağını betimler.
      claims: finalResult.claimAudit,
      llm: finalResult.llmUsage,
      hijackScreened: ctx.knowledgeBaseHijackScreened,
      // Konaklama değişikliği politikası: kapıyla AYNI girdi (`qrAvailabilityPolicy`) — uygulanan
      // karar + katman sinyalleri; kapalı-küme kodlar (`ev` = `v`, gölge kip yok).
      stay: stayEvidenceOf(evaluateAvailability(finalResult.reply, [message], qrAvailabilityPolicy(finalResult, stayCtx))),
      // Risk niyeti: kapıyla AYNI girdi; yalnız anlama katmanı gerçekten koştuysa yazılır.
      intentRisk: understood
        ? intentRiskEvidenceOf(evaluateIntentRisk(stayCtx?.understandingRisk, { modelIntent: result.intent }))
        : undefined,
      // Ev kuralı GÖLGE ölçümü (#188 dilim 3): kanal oto-yanıtıyla AYNI giriş; karar DEĞİL, bayrak kapalıyken sorgu yok.
      houseRules: await houseRulesShadowFor({ organizationId: ctx.property.organizationId, propertyId: ctx.property.id, understood }),
    }),
    srcDeclared: finalResult.sourceAudit?.declared ?? null,
    srcVerified: finalResult.sourceAudit?.verified ?? null,
  });

  // ── KAPANIŞA SESSİZLİK — ANLAM YOLU (kurucu kuralı 09-25, `ai/closing-turn.ts`; kanal kapısıyla AYNI yüklem) ──────
  // Sözcük listesinin kaçırdığı teşekkür/onay ("Anladım", "Kolay gelsin", başka diller): anlama katmanı YALNIZ
  // selam/teşekkür gördü + cevap modeli kendi kapanış kuralına uydu (genel niyet, güven < 0.4) + kapı YALNIZ düşük
  // güvenden devretti. 🚨 BİRLEŞİM DEĞİŞMEZİ: kapı düşük güvende DÖNER (risk niyeti sonra bakılır) → güven 1 ile BAŞTAN
  // koşar ve devir istememeli; bekçi burada koşmadı, yani herhangi bir katmanın konaklama isteği her zaman devreder.
  // "Güven 1 ile devir yok" + "güven 0.4 altı" ⇒ gerçek kararı YALNIZ güven verdi (bilgi bandı 0.45'ten başlar). `escalate`
  // koruması bugün eşdeğer, bilinçli: kapının göndereceği bir cevap asla susturulmaz.
  // Yapay zekâ duraklatılmışken yazılmış cevapsız mesaj varsa (`qrUnanswered` > 1) anlam yolu SUSTURMAZ: anlama katmanı
  // yalnız bu mesajı değerlendirdi, ötekileri onaylayamaz — ötekiler de SÖZCÜK listesindeki kapanışlarsa ("Teşekkürler"
  // → "Anladım") onaylanacak bir şey yok (inceleme 09-25, P3: ikinci teşekkür devir + uyarı alıyordu).
  if (
    escalate &&
    (qrUnanswered.length === 1 || lexicalClosingOnly(qrUnanswered.slice(0, -1))) &&
    !evaluateEscalation({ ...gateResult, confidence: 1 }, message, res.guestName, history, stayCtx).escalate &&
    semanticClosingOnly({ unanswered: [message], hasPriorReply: qrClosable, understood, reply: finalResult })
  ) {
    const closingRecord = await record(null, false, (await qrHideDecision()) ? "handled" : "open");
    const closingAudit = await auditFields();
    await recordRiskEvent({
      organizationId: ctx.property.organizationId,
      propertyId: ctx.property.id,
      conversationId: closingRecord.conversationId,
      surface: "guest_chat",
      triggerId: closingRecord.inboundMessageId,
      finalDecision: "no_reply",
      reason: "closing_ack_semantic",
      riskLevel: result.riskLevel,
      riskType: result.riskType ?? null,
      confidence: result.confidence,
      ...closingAudit,
    });
    await traceQr({
      decision: "no_reply",
      conversationId: closingRecord.conversationId,
      triggerMessageId: closingRecord.inboundMessageId,
      gateReason: "closing_ack_semantic",
      kbEvidenceJson: closingAudit.kbEvidenceJson,
      sentText: null,
    });
    return finalize({ noReply: true });
  }

  // SEND-TIME VETO: a host may have replied WHILE the model ran (seconds). The
  // authoritative check now lives INSIDE record() — recheck + insert run under
  // the per-thread advisory lock shared with the host reply route, so a host
  // reply committing at any point before our insert structurally vetoes the AI
  // answer (handedOff below). The guest's message is still recorded for the host.
  // 🚨 ACİL ≠ SIRADAN İSTEK (kurucu, 09-11). `criticalEvent` yukarıda (alarm
  // dedupe'ı için) ZATEN hesaplandı — yeni dedektör, yeni çağrı, yeni maliyet yok.
  // Devirde misafire HİÇBİR ŞEY gitmez (K10 + kurucu kararı 10-11: tehlikede de 112 / acil servis satırı YOK); ev sahibi uyarılır.
  // ── ACİL NUMARA SORUSU → KOD METNİ (kurucu kararları 10-11; anahtar `AI_EMERGENCY_NUMBER_ENABLED` KAPALI → hep null) ──────────────
  // "Ambulans / polis numarası ne?" → yalnız sorulan servisin numarası ("Polis: 155"), yönerge yok. Ev sahibi / anlaşmazlık sözcüğü ya da
  // anlama katmanının şikâyet / iade / insan talebi ya da bir konaklama konusu niyeti → numara verilmez (bugünkü devir). Modelin taslağı
  // ATILIR (yalnız numara gider) ve ev sahibi HER ZAMAN uyarılır: misafirin acil numara sorması ev sahibinin bilmesi gereken bir olaydır,
  // mesajdaki başka bir istek ("en yakın hastane nerede?") de ona kalır.
  const emergencyNumber = emergencyNumberReply({
    message,
    timeZone: orgTimezone(org?.timezone),
    language: lineLanguage ?? understood?.language ?? result.detectedLanguage ?? null,
    understandingIntents: understood ? understood.requests.map((q) => q.intent) : null,
    earlierGuestTexts: qrUnanswered.slice(0, -1),
  });
  const sendEscalate = emergencyNumber !== null || escalate;
  const reply = emergencyNumber ? emergencyNumber.text : escalate ? null : finalResult.reply;
  const { inboundMessageId, handedOff, conversationId } = await record(reply, sendEscalate);
  if (handedOff) return finalize({ handoff: true });
  // İZLENEBİLİRLİK (kurucu AI kalite turu, 09-08): KARARIN GEREKÇESİ kaydedilir —
  // devir DE, otomatik cevap DA. Kapalı küme; misafir metni ASLA girmez. Yan
  // etkidir: `recordRiskEvent` ASLA fırlatmaz (kendi try/catch'i var), o yüzden
  // await edilmesi teslimi riske atmaz ve kaydı deterministik kılar (fire-and-forget
  // olsaydı yanıt döndükten sonra yazılır, kurucu konsolunda yarış görünürdü).
  const finalAudit = await auditFields();
  const finalReason = emergencyNumber ? "emergency_number" : (verdict.reason ?? "gate_passed");
  await recordRiskEvent({
    organizationId: ctx.property.organizationId,
    propertyId: ctx.property.id,
    conversationId,
    surface: "guest_chat",
    triggerId: inboundMessageId,
    finalDecision: sendEscalate ? "human_review" : "auto_sent",
    riskLevel: result.riskLevel,
    riskType: result.riskType ?? null,
    reason: finalReason,
    confidence: result.confidence,
    ...finalAudit,
  });
  await traceQr({
    decision: sendEscalate ? "human_review" : "auto_sent",
    conversationId,
    triggerMessageId: inboundMessageId,
    gateReason: finalReason,
    kbEvidenceJson: finalAudit.kbEvidenceJson,
    sentText: sendEscalate ? null : reply,
  });
  if (sendEscalate) {
    // Alarm önceliği: kelime ağının acil durumu YA DA anlama katmanının acil niyeti (kelime ağının kaçırdığı dolaylı
    // dil — inceleme 09-24, P2-11) bekleme süresini aşar. Misafire giden metin bağlam kararında kalır (↑ hazardDecision).
    // 51: bağlamla kalkan fiziksel tehlike etiketi (olası / anılış + model "acil değil") kritik uyarı değildir.
    const alertCritical = (criticalEvent && !hazardDecision.lexicalCleared) || understandingRiskOf(understood) === "emergency";
    await sendQrEscalationAlertBounded({
      organizationId: ctx.property.organizationId,
      propertyName: ctx.property.name,
      reservationId: res.id,
      eventId: qrEscalationEventId(inboundMessageId, message, alertCritical),
      reason: emergencyNumber ? "emergency_number" : "ai_escalated",
      critical: alertCritical,
    });
  }
  return finalize({ escalated: sendEscalate, reply });

  } catch (err) {
    // Pre-record failure (model/DB error before anything persisted) → release so
    // the guest's retry is processed instead of deduped against zero work.
    if (claimScopeId && !recorded) await releaseKeyedOutboundSend(claimScopeId);
    // Y3: konaklama istek sürerken silindi — hiçbir şey yazılmadı; misafire konaklaması olmayan biriyle aynı cevap.
    if (err instanceof StayErasedError) return jsonOk({ closed: true, reply: NO_ACTIVE_STAY_REPLY });
    throw err;
  }
}
