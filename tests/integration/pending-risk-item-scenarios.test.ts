import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// BEKLEYEN RİSK — İSTEK/ÖĞE BAZINDA MI, KONUŞMA BAZINDA MI? (kurucu 09-26)
//
// Kurucunun istediği davranış: eski cevapsız gerçek risk yeni mesajla KAYBOLMAZ, ama tüm konuşmayı da BLOKE
// ETMEZ ("IBAN'ınızı atar mısınız?" açık hassas öğe olarak ev sahibinde kalır; ardından gelen bağımsız ve güvenli
// "Wi-Fi şifresi neydi?" normal cevaplanır).
//
// 🚨 BU DOSYA BUGÜNKÜ DAVRANIŞIN KARAKTERİZASYONUDUR — istenen davranış DEĞİL. Tasarım + eksik kalıcı durum raporu:
// `docs/BEKLEYEN-RISK-OGE-BAZINDA-2026-09-26.md`. Tasarım onaylanıp uygulandığında bu testler bilerek DEĞİŞİR
// (kırmızı-önce tabanı). Model çıktısı belirlenimsiz olduğu için her senaryo iki dalda koşar: model mesajı riskli
// ETİKETLEMEDİ / ETİKETLEDİ (istem "birden fazla konu varsa en yüksek riskli niyeti seç" dediği için gerçekte
// ikincisi olası).
//
// Üç senaryo AYRI (kurucu): (1) riskli istek → sonra bağımsız güvenli soru · (2) riskli istek → sonra "boşverin" ·
// (3) aynı mesajda riskli istek + güvenli soru (yalnız bugünkü davranış raporlanır; ürün davranışı belirlenmez).
// Kanal yolu (Airbnb/Booking) + QR yolu (mesaj başına değerlendirme — öğe bazlı emsal) ayrı ayrı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { applyChannelAutoReply } from "@/lib/automation";
import { hasOpenHostWork } from "@/lib/conversation-attention";
import { loadConversationState } from "@/lib/ai/conversation-state-loader";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);

const IBAN = "IBAN'ınızı atar mısınız?";
const WIFI = "Wi-Fi şifresi neydi?";
const NEVERMIND = "Boşverin, gerek kalmadı";
const BOTH = "IBAN'ınızı atar mısınız? Bir de Wi-Fi şifresi neydi?";

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.95,
    reply: "Anlaşıldı.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}
/** Model IBAN mesajını riskli ETİKETLEMEDİ (kapıyı yalnız kelime ağı tutar). */
const paymentUnflagged = verdict({ reply: "Ödemeler yalnızca platform üzerinden yapılır.", riskLevel: "low" });
/** Model Wi-Fi sorusunu cevapladı, risk görmedi. */
const wifiOk = verdict({ intent: "wifi", reply: "Wi-Fi ağı LaleApt, şifre 12345678." });
/** Model turu platform dışı ödeme diye etiketledi (istem: "birden fazla konu varsa en yüksek riskli niyet"). */
const flagged = verdict({
  riskType: "platform_policy",
  riskLevel: "medium",
  reply: "Ödemeler yalnızca platform üzerinden yapılır. Wi-Fi ağı LaleApt, şifre 12345678.",
});

// ─── kanal yolu ──────────────────────────────────────────────────────────────

async function seedChannel(firstGuestMessage: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: firstGuestMessage, createdAt }] },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

/** Misafirin sonraki mesajı (senkronun yazdığı gibi): mesaj + `lastMessageAt`. */
async function guestWrites(conversationId: string, body: string, minutesAgo: number) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000);
  await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Alex", authorType: "guest", body, createdAt } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: createdAt } });
}

async function threadOf(conversationId: string) {
  return prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function decisionsOf(conversationId: string) {
  const rows = await prisma.riskEvent.findMany({
    where: { conversationId },
    select: { triggerId: true, finalDecision: true, reason: true, riskType: true },
  });
  const msgs = await threadOf(conversationId);
  const bodyOf = new Map(msgs.map((m) => [m.id, m.body]));
  return rows.map((r) => ({ ...r, body: bodyOf.get(r.triggerId) }));
}

/** İki türetilmiş "açık iş" görünümü: kapanış gizleme kapısı + (bayrak açıkken) cevap modelinin durum bloğu. */
async function derivedViews(orgId: string, conversationId: string) {
  const messages = await threadOf(conversationId);
  const openHostWork = await hasOpenHostWork(orgId, messages);
  vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
  const cus = await loadConversationState({ organizationId: orgId, messages });
  return { openHostWork, cusItems: cus?.items ?? null };
}

describe("KANAL — senaryo 1: riskli istek (IBAN) → sonra bağımsız güvenli soru (Wi-Fi)", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("model etiketlemedi: IBAN tutulur (kelime ağı), Wi-Fi cevabı GİDER — IBAN yalnız karar kaydında kalır, gelen kutusunda iz kalmaz", async () => {
    const { orgId, conversationId } = await seedChannel(IBAN);

    // 1. geçiş: yalnız IBAN cevapsız → son mesajın kelime ağı etiketi (platform_policy) kapıyı tutar; model risk
    // görmediği için "Sorunlu" DEĞİL, sessiz taslak.
    mockSuggest.mockResolvedValueOnce(paymentUnflagged);
    const pass1 = await applyChannelAutoReply(conversationId);
    expect(pass1).toMatchObject({ sent: false, skippedReason: "low_confidence_or_risky" });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, lastRiskType: true } }))
      .toEqual({ status: "new", lastRiskType: "platform_policy" });

    // 2. geçiş: Wi-Fi geldi; IBAN hâlâ cevapsız (bekleyen). Bugünkü kapı bekleyen mesajlarda platform_policy'ye BAKMAZ
    // → cevap gider. Model IBAN mesajını da görür (geçmişte) ve istem "sorulan TÜM soruları yanıtla" der; hangi
    // öğeleri cevapladığını söyleyen bir alan YOK.
    mockSuggest.mockResolvedValueOnce(wifiOk);
    await guestWrites(conversationId, WIFI, 5);
    const pass2 = await applyChannelAutoReply(conversationId);
    expect(pass2.sent).toBe(true);
    const modelInput = mockSuggest.mock.calls[1][0];
    expect(modelInput.guestMessage).toBe(WIFI);
    expect(modelInput.history?.map((h) => h.body)).toContain(IBAN);

    // Sonuç: konuşma "cevaplandı", risk rozeti silindi → gelen kutusunda IBAN'dan iz yok.
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, skippedReason: true, lastRiskType: true } }))
      .toEqual({ status: "answered", skippedReason: null, lastRiskType: null });
    // Karar kayıtları mesaj başına: IBAN insana, Wi-Fi otomatik.
    expect(await decisionsOf(conversationId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: IBAN, finalDecision: "human_review", reason: "low_confidence_or_risky", riskType: "platform_policy" }),
        expect.objectContaining({ body: WIFI, finalDecision: "auto_sent" }),
      ]),
    );
    // 🚨 İki türetilmiş görünüm ÇELİŞİR: kapanış kapısı IBAN'ı açık iş sayar (ev sahibi yazmadı), Konuşma Anlama Durumu
    // ise sonraki yapay zekâ cevabı "o mesajı da kapsadı" diye KAPATIR.
    expect(await derivedViews(orgId, conversationId)).toEqual({ openHostWork: true, cusItems: [] });
  });

  it("model etiketledi (olası dal): Wi-Fi cevabı da GİTMEZ, konuşma 'Sorunlu' olur ve yapay zekâ TÜM konuşmada durur", async () => {
    const { conversationId } = await seedChannel(IBAN);
    mockSuggest.mockResolvedValueOnce(paymentUnflagged);
    await applyChannelAutoReply(conversationId);

    mockSuggest.mockResolvedValueOnce(flagged);
    await guestWrites(conversationId, WIFI, 5);
    const pass2 = await applyChannelAutoReply(conversationId);
    expect(pass2).toMatchObject({ sent: false, skippedReason: "escalated_to_human" });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, priority: true } }))
      .toEqual({ status: "problem", priority: "urgent" });
    expect(mockMail).toHaveBeenCalledTimes(1);

    // Sonraki BAĞIMSIZ soru da cevaplanmaz: "Sorunlu" konuşma düzeyinde kalıcı durdurmadır (ev sahibi yazana dek).
    mockSuggest.mockClear();
    await guestWrites(conversationId, "Otopark var mı?", 1);
    const pass3 = await applyChannelAutoReply(conversationId);
    expect(pass3).toMatchObject({ sent: false, skippedReason: "complaint" });
    expect(mockSuggest).not.toHaveBeenCalled();
  });
});

describe("KANAL — senaryo 2: riskli istek (IBAN) → sonra 'boşverin'", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("model etiketlemedi: 'Anlaşıldı' gider; IBAN öğesi için İPTAL/GEÇERSİZ hâli YOK — kapanış kapısı hâlâ açık iş sayar", async () => {
    const { orgId, conversationId } = await seedChannel(IBAN);
    mockSuggest.mockResolvedValueOnce(paymentUnflagged);
    await applyChannelAutoReply(conversationId);

    // "Boşverin, gerek kalmadı" kapanış listesinde değil → model koşar; kapı geçer.
    mockSuggest.mockResolvedValueOnce(verdict({ reply: "Anlaşıldı." }));
    await guestWrites(conversationId, NEVERMIND, 5);
    const pass2 = await applyChannelAutoReply(conversationId);
    expect(pass2.sent).toBe(true);

    // Geri çekme hiçbir yere yazılmaz: IBAN'ın karar kaydı "insana" olarak kalır; iki görünüm yine çelişir.
    const iban = (await decisionsOf(conversationId)).filter((d) => d.body === IBAN);
    expect(iban).toEqual([expect.objectContaining({ finalDecision: "human_review" })]);
    expect(await derivedViews(orgId, conversationId)).toEqual({ openHostWork: true, cusItems: [] });
  });

  it("IBAN turu 'Sorunlu'ya yükseldiyse 'boşverin' hiçbir şeyi değiştirmez: model çağrılmaz, konuşma Sorunlu kalır", async () => {
    const { conversationId } = await seedChannel(IBAN);
    mockSuggest.mockResolvedValueOnce(flagged);
    await applyChannelAutoReply(conversationId);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("problem");

    mockSuggest.mockClear();
    await guestWrites(conversationId, NEVERMIND, 5);
    const pass2 = await applyChannelAutoReply(conversationId);
    expect(pass2).toMatchObject({ sent: false, skippedReason: "complaint" });
    expect(mockSuggest).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("problem");
  });
});

describe("KANAL — senaryo 3: aynı mesajda riskli istek + güvenli soru (yalnız bugünkü davranış)", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("model etiketlemedi: mesaj TEK öğedir — kelime ağı mesajın tamamını tutar, Wi-Fi kısmı da otomatik cevaplanmaz", async () => {
    const { conversationId } = await seedChannel(BOTH);
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "wifi", reply: "Ödemeler yalnızca platform üzerinden yapılır. Wi-Fi ağı LaleApt, şifre 12345678." }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "low_confidence_or_risky" });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, lastRiskType: true } }))
      .toEqual({ status: "new", lastRiskType: "platform_policy" });
    // Tek karar kaydı, mesaj başına (istek başına değil).
    expect(await decisionsOf(conversationId)).toEqual([
      expect.objectContaining({ body: BOTH, finalDecision: "human_review", riskType: "platform_policy" }),
    ]);
  });

  it("model etiketledi: konuşma 'Sorunlu' — yapay zekâ bu konuşmada durur", async () => {
    const { conversationId } = await seedChannel(BOTH);
    mockSuggest.mockResolvedValueOnce(flagged);
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "escalated_to_human" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("problem");
  });
});

// ─── QR yolu (mesaj başına değerlendirme — öğe bazlı EMSAL) ──────────────────

function qrCall(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, { method: "POST", headers, body: JSON.stringify({ message }) });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

describe("QR — senaryo 1: her mesaj kendi başına değerlendirilir (devir yapışkan değil)", () => {
  const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("IBAN → devir metni (öğe ev sahibinde); ardından Wi-Fi → normal cevap; IBAN açık iş olarak kalır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });

    mockSuggest.mockResolvedValueOnce(paymentUnflagged);
    const first = await qrCall(token, IBAN);
    expect((await first.json()).escalated).toBe(true);
    const cookie = first.headers.get("set-cookie")?.split(";")[0];

    mockSuggest.mockResolvedValueOnce(wifiOk);
    const second = await qrCall(token, WIFI, cookie);
    const json = await second.json();
    expect(json.escalated).toBe(false);
    expect(json.reply).toContain("LaleApt");

    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    expect(await decisionsOf(convo.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: IBAN, finalDecision: "human_review" }),
        expect.objectContaining({ body: WIFI, finalDecision: "auto_sent" }),
      ]),
    );
    // QR'da devir metni hemen gider → Konuşma Anlama Durumu öğeyi "kararı ev sahibinde" sayar; kapanış kapısı da açık iş.
    // Etiket kapalı kümede yok (platform_policy → "other").
    expect(await derivedViews(orgId, convo.id)).toEqual({ openHostWork: true, cusItems: [{ topic: "other", status: "deferred_to_host" }] });
  });
});
