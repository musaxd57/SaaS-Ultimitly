// ---------------------------------------------------------------------------
// QR ÜRETİM İZİ (kurucu kararı 10-12 öğle, Ö5 "QR izini de yaz"; anahtar `AI_GENERATION_TRACE_ENABLED` KAPALI) — gerçek PostgreSQL +
// gerçek QR rotası + gerçek kapı; yalnız cevap modeli sahte.
//
// Kanal iziyle aynı sözleşme: iz bir GÖZLEMDİR (misafire giden metin ve karar aynı kalır), her iz satırı aynı turun RiskEvent'iyle
// AYNI karar + gerekçeyi taşır, model çağrılmadıysa (yedek cevap) iz yok, anahtar kapalıyken girdi hiç kurulmaz. Bağlam tanısı QR
// penceresinin KENDİ kurucusundan (`buildGuestChatContextWindow`) gelir; metin taşımaz.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { replyPromptVersion, suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";
import { buildGuestChatContextWindow, ensureGuestChatConversation, QR_HISTORY_MESSAGE_CAP } from "@/lib/guest-chat";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockPromptVersion = vi.mocked(replyPromptVersion);
const DAY = 86_400_000;

const ANSWER = "Giriş 15:00'ten itibaren.";
const draft = (over: Record<string, unknown> = {}) => ({
  reply: ANSWER,
  intent: "checkin",
  riskLevel: "none",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none", stance: "none" },
  llmUsage: { m: "served-model", pt: 900, ct: 40 },
  ...over,
});

async function seedQr() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

let seq = 0;
async function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `qt${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  const cookieOut = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { body: (await res.json()) as { reply?: string; escalated?: boolean; noReply?: boolean }, cookie: cookieOut };
}

async function qrMessages(propertyId: string) {
  return prisma.message.findMany({
    where: { conversation: { propertyId, channel: "chat" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, direction: true, body: true },
  });
}

/** Şema adına göre cevap veren sahte OpenAI (yalnız anlama katmanı; cevap modeli ayrıca sahte). */
function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}
const NLU_THANKS = {
  language: "tr",
  requests: [{ intent: "greeting_thanks", query_tr: null, query_original: null }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};

describe("QR üretim izi — rota", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 gönderim: surface qr, karar + gerekçe RiskEvent ile AYNI, gönderilen = misafire giden gövde, taslak = model taslağı", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const { body } = await ask(s.token, "Giriş saati kaçta?");
    expect(body.reply).toBe(ANSWER);
    const [g] = await prisma.aiGeneration.findMany();
    const [ev] = await prisma.riskEvent.findMany({ where: { surface: "guest_chat" } });
    const msgs = await qrMessages(s.propertyId);
    const inbound = msgs.find((m) => m.direction === "inbound")!;
    const bot = msgs.find((m) => m.direction === "outbound")!;
    expect(g).toMatchObject({
      organizationId: s.orgId,
      propertyId: s.propertyId,
      reservationId: s.reservationId,
      surface: "qr",
      model: "served-model",
      promptVersion: "promptvqr1",
      decision: ev.finalDecision,
      gateReason: ev.reason,
      promptTokens: 900,
      completionTokens: 40,
      draftText: ANSWER,
      sentText: bot.body,
      triggerMessageId: inbound.id,
    });
    expect(g.decision).toBe("auto_sent");
    expect(g.conversationId).toBe(ev.conversationId);
    expect(g.kbEvidenceJson).toBe(ev.kbEvidenceJson);
    expect(g.latencyMs).not.toBeNull();
    // İlk mesaj: pencere boş (güncel mesaj pencereye girmez — sohbet mesaj yazılmadan ÖNCE okunur).
    expect(JSON.parse(g.contextDiagnosticsJson!)).toMatchObject({ v: 1, includedIds: [], includedCount: 0, omittedCount: 0, oldestIncludedAt: null });
    // Araç özeti QR'da yok (doğrulanmış konaklama yalnız metin döndürür).
    expect(g.toolResultsJson).toBeNull();
  });

  it("ikinci turda tanı önceki soru + cevabın kimliklerini taşır; metin TAŞIMAZ", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const first = await ask(s.token, "Giriş saati kaçta?");
    const prior = await qrMessages(s.propertyId);
    mockSuggest.mockResolvedValue(draft({ reply: "Çıkış 11:00'e kadar.", intent: "checkout" }) as never);
    await ask(s.token, "Çıkış saati kaçta?", first.cookie);
    const gens = await prisma.aiGeneration.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(gens).toHaveLength(2);
    const diag = JSON.parse(gens[1].contextDiagnosticsJson!);
    expect(diag).toMatchObject({
      includedIds: prior.map((m) => m.id),
      includedCount: 2,
      omittedCount: 0,
      pendingCount: 0,
      pendingIncludedCount: 0,
      olderMemoryUsed: false,
      totalChars: prior.reduce((n, m) => n + m.body.length, 0),
    });
    expect(gens[1].contextDiagnosticsJson).not.toContain("Giriş");
    expect(gens[1].contextDiagnosticsJson).not.toContain(ANSWER);
  });

  it("K-1029-A: ev sahibine başvurma yüzünden tutulan QR cevabının izi SİLİNMİŞ taslağı saklar (mutasyon W4)", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(
      draft({
        reply: `${ANSWER} Herhangi bir sorunda ev sahibinize yazın.`,
        hostContactOnly: true,
        hostContactDraft: ANSWER,
        hostContactRemovals: [{ kind: "write", form: "conditional", appendix: false, stems: [], topics: [], generic: true }],
      }) as never,
    );
    const { body } = await ask(s.token, "Giriş saati kaçta?");
    expect(body.reply ?? "").not.toMatch(/ev sahibinize yazın/);
    const [g] = await prisma.aiGeneration.findMany();
    expect(g.draftText).toBe(ANSWER);
  });

  it("🚨 devir: karar human_review, gönderilen YOK, taslak var, gerekçe RiskEvent ile aynı", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft({ confidence: 0.4, intent: "general", reply: "Bilmiyorum, sorayım." }) as never);
    const { body } = await ask(s.token, "Otoparkın kapı kodu nedir?");
    expect(body.escalated).toBe(true);
    const [g] = await prisma.aiGeneration.findMany();
    const [ev] = await prisma.riskEvent.findMany({ where: { surface: "guest_chat" } });
    expect(ev.finalDecision).toBe("human_review");
    expect(g).toMatchObject({ surface: "qr", decision: "human_review", gateReason: ev.reason, sentText: null, draftText: "Bilmiyorum, sorayım." });
    expect((await qrMessages(s.propertyId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
  });

  it("🚨 anlam yolu kapanışı: karar no_reply, gerekçe closing_ack_semantic, gönderilen YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const s = await seedQr();
    mockSuggest.mockResolvedValueOnce(draft() as never);
    const first = await ask(s.token, "Giriş saati kaçta?");
    mockSuggest.mockResolvedValue(draft({ intent: "general", confidence: 0.3, reply: "Rica ederiz, iyi günler!" }) as never);
    const { body } = await ask(s.token, "Anladım", first.cookie);
    expect(body.noReply).toBe(true);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat", finalDecision: "no_reply" } });
    expect(ev.reason).toBe("closing_ack_semantic");
    const g = await prisma.aiGeneration.findFirstOrThrow({ where: { decision: "no_reply" } });
    expect(g).toMatchObject({ surface: "qr", gateReason: "closing_ack_semantic", sentText: null, draftText: "Rica ederiz, iyi günler!" });
    expect(g.kbEvidenceJson).toBe(ev.kbEvidenceJson);
    const inbound = (await qrMessages(s.propertyId)).at(-1)!;
    expect(inbound).toMatchObject({ direction: "inbound", body: "Anladım" });
    expect(g.triggerMessageId).toBe(inbound.id);
  });

  it("🚨 model çağrılmadı (yedek cevap, kullanım yok) → iz yok; karar kaydı yine yazılır", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft({ source: "fallback", llmUsage: undefined }) as never);
    await ask(s.token, "Giriş saati kaçta?");
    expect(await prisma.aiGeneration.count()).toBe(0);
    expect(await prisma.riskEvent.count({ where: { surface: "guest_chat" } })).toBe(1);
  });

  it("🚨 yeniden yazdırma (acil arama yönergeli ilk taslak) YEDEĞE düşse de karar izlenir — ilk çağrı modele gitti (Haiku 10-12)", async () => {
    const s = await seedQr();
    mockSuggest
      .mockResolvedValueOnce(draft({ reply: "Çöp salı günü alınır; acil bir durumda 112'yi arayın.", intent: "general" }) as never)
      .mockResolvedValueOnce(draft({ source: "fallback", llmUsage: undefined, reply: "Çöp salı günü alınır.", intent: "general", confidence: 0.4 }) as never);
    await ask(s.token, "Çöp ne zaman alınıyor?");
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    const [ev] = await prisma.riskEvent.findMany({ where: { surface: "guest_chat" } });
    const gens = await prisma.aiGeneration.findMany();
    expect(gens).toHaveLength(1);
    expect(gens[0]).toMatchObject({ surface: "qr", decision: ev.finalDecision, gateReason: ev.reason, draftText: "Çöp salı günü alınır." });
  });

  it("ters yön: ilk taslak yedek (modelsiz) ama yönergeli → yeniden yazdırma modele gider → karar izlenir", async () => {
    const s = await seedQr();
    mockSuggest
      .mockResolvedValueOnce(draft({ source: "fallback", llmUsage: undefined, reply: "Acil bir durumda 112'yi arayın.", intent: "general" }) as never)
      .mockResolvedValueOnce(draft({ reply: "Çöp salı günü alınır.", intent: "general" }) as never);
    await ask(s.token, "Çöp ne zaman alınıyor?");
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    const [ev] = await prisma.riskEvent.findMany({ where: { surface: "guest_chat" } });
    const gens = await prisma.aiGeneration.findMany();
    expect(gens).toHaveLength(1);
    expect(gens[0]).toMatchObject({ decision: ev.finalDecision, gateReason: ev.reason, draftText: "Çöp salı günü alınır.", model: "served-model" });
  });

  it("🚨 anahtar kapalı → iz yok, girdi hiç KURULMAZ; misafire giden cevap AYNI", async () => {
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "");
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const { body } = await ask(s.token, "Giriş saati kaçta?");
    expect(body.reply).toBe(ANSWER);
    expect(await prisma.aiGeneration.count()).toBe(0);
    expect(mockPromptVersion).not.toHaveBeenCalled();
    expect(await prisma.riskEvent.count({ where: { surface: "guest_chat" } })).toBe(1);
  });

  it("iz yazımı başarısız olsa da cevap gider (iz gözlemdir)", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    mockPromptVersion.mockImplementationOnce(() => {
      throw new Error("istem sürümü hesaplanamadı");
    });
    const { body } = await ask(s.token, "Giriş saati kaçta?");
    expect(body.reply).toBe(ANSWER);
    expect(await prisma.aiGeneration.count()).toBe(0);
    expect((await qrMessages(s.propertyId)).filter((m) => m.direction === "outbound")).toHaveLength(1);
  });
});

describe("QR bağlam penceresi tanısı (`buildGuestChatContextWindow`)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedConversation(messages: { direction: "inbound" | "outbound"; body: string; authorType?: string }[]) {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Test Misafir",
        arrivalDate: new Date(Date.now() - DAY),
        departureDate: new Date(Date.now() + 2 * DAY),
        status: "confirmed",
        channel: "manual",
        currency: "EUR",
      },
    });
    const conversationId = await ensureGuestChatConversation(propertyId, { id: reservation.id, guestName: reservation.guestName });
    const t0 = Date.now() - 60 * 60_000;
    await prisma.message.createMany({
      data: messages.map((m, i) => ({
        conversationId,
        direction: m.direction,
        senderName: m.direction === "inbound" ? "Misafir" : "Ev sahibi",
        authorType: m.authorType ?? (m.direction === "inbound" ? "guest" : "host"),
        body: m.body,
        createdAt: new Date(t0 + i * 1000),
      })),
    });
    const ids = (
      await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
    ).map((m) => m.id);
    return { conversationId, ids };
  }

  it("🚨 tavanı aşan konuşma: dahil = SON pencere (aynı kimlikler, aynı sıra), dışarıda kalan sayılır, en eski dahil zaman doğru", async () => {
    const msgs = Array.from({ length: QR_HISTORY_MESSAGE_CAP + 6 }, (_, i) => ({
      direction: (i % 2 === 0 ? "inbound" : "outbound") as "inbound" | "outbound",
      body: i % 2 === 0 ? `Havlular nerede acaba? (${i})` : "Banyodaki dolapta.",
    }));
    const { conversationId, ids } = await seedConversation(msgs);
    const w = await buildGuestChatContextWindow(conversationId);
    expect(w.history).toHaveLength(QR_HISTORY_MESSAGE_CAP);
    const d = w.diagnostics!;
    expect(d.includedIds).toEqual(ids.slice(-QR_HISTORY_MESSAGE_CAP));
    expect(d.includedCount).toBe(QR_HISTORY_MESSAGE_CAP);
    expect(d.omittedCount).toBe(6);
    expect(d.oldestIncludedAt).toBe(w.history[0].at!.toISOString());
    expect(d.totalChars).toBe(w.history.reduce((n, m) => n + m.body.length, 0));
    expect(d.pendingCount).toBe(0); // son satır ev sahibi cevabı
  });

  it("cevapsız misafir mesajları bekleyen sayılır; pencere dışı açık şikâyet = eski hafıza kullanıldı", async () => {
    const msgs: { direction: "inbound" | "outbound"; body: string }[] = [{ direction: "inbound", body: "Klima çalışmıyor, içerisi çok sıcak." }];
    for (let i = 0; i < 20; i++) {
      msgs.push({ direction: "outbound", body: "Havlular banyodaki dolapta." });
      msgs.push({ direction: "inbound", body: `Havlular nerede acaba? (${i})` });
    }
    msgs.push({ direction: "inbound", body: "Bir de çöp nereye atılıyor?" });
    const { conversationId } = await seedConversation(msgs);
    const w = await buildGuestChatContextWindow(conversationId);
    expect(w.openTopics).toContain("complaint");
    expect(w.diagnostics).toMatchObject({ pendingCount: 2, pendingIncludedCount: 2, olderMemoryUsed: true });
  });

  it("otomatik şablon mesajı CEVAP SAYILMAZ: ardından gelen misafir mesajı hâlâ bekleyen (kanal tanısıyla aynı yazar kuralı)", async () => {
    const { conversationId } = await seedConversation([
      { direction: "inbound", body: "Havlular nerede acaba?" },
      { direction: "outbound", body: "Hoş geldiniz! Giriş bilgileriniz ektedir.", authorType: "automation" },
      { direction: "inbound", body: "Bir de çöp nereye atılıyor?" },
    ]);
    const w = await buildGuestChatContextWindow(conversationId);
    expect(w.diagnostics).toMatchObject({ pendingCount: 2, pendingIncludedCount: 2 });
  });

  it("KONTROL: açık konu yoksa eski hafıza kullanılmadı", async () => {
    const { conversationId } = await seedConversation([
      { direction: "inbound", body: "Havlular nerede acaba?" },
      { direction: "outbound", body: "Banyodaki dolapta." },
    ]);
    const w = await buildGuestChatContextWindow(conversationId);
    expect(w.openTopics).toEqual([]);
    expect(w.diagnostics).toMatchObject({ olderMemoryUsed: false, includedCount: 2, omittedCount: 0 });
  });
});
