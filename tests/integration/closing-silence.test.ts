import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KAPANIŞA SESSİZLİK — KANAL + QR UÇTAN UCA (kurucu kuralı 09-25).
//
// "Guest yalnızca 'Teşekkürler', 'Tamamdır', '👍', 'Harika', 'Anladım' gibi conversation-closing acknowledgment
// gönderiyorsa ve açıkta cevaplanmamış başka bir soru/istek yoksa AI hiçbir şey göndermesin. İçeride ise mesaj handled /
// no_reply_needed … gibi bir state'e geçebilir." · "Anladım teşekkürler ama 12'de gelebilir miyiz?" → işlenir.
//
// Eskiden: kanalda övgü ("Harika bir konaklamaydı!") ve önceki cevabı olmayan teşekkür modele gidiyor, model cevabı otomatik
// gidebiliyordu; sözcük listesinin tanımadığı "Anladım" düşük güvenden host'un inceleme listesine düşüyordu. QR'da her teşekkür
// düşük güvenden DEVREDİLİYOR, misafir "kaydedildi; ev sahibiniz görebilir" alıyor, host uyarılıyordu.
// Cevap modeli MOCK, DB gerçek, anlama katmanı sahte fetch (şema adına göre cevap).
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply, runDueChannelAutoReplies, previewChannelAutoReplies } from "@/lib/automation";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { notClosingHandledWhere, isClosingHandled } from "@/lib/conversation-attention";
import { findAttentionItems, UNANSWERED_HOURS } from "@/modules/intelligence/incidents/attention";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Cevap modelinin "yalnız teşekkür" hükmü (istem BÖLÜM 11: genel niyet, güven 0.4'ün altında). */
const CLOSING_DRAFT = {
  intent: "general",
  confidence: 0.3,
  reply: "Rica ederiz, iyi günler!",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};

const NLU_THANKS = {
  language: "tr",
  requests: [{ intent: "greeting_thanks", query_tr: null, query_original: null }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
const NLU_THANKS_AND_WIFI = {
  ...NLU_THANKS,
  requests: [...NLU_THANKS.requests, { intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi" }],
};

/** Şema adına göre cevap veren sahte OpenAI (anlama katmanı ve bekçi aynı uca gider). */
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

// ── Kanal ─────────────────────────────────────────────────────────────────────

type SeedMessage = {
  direction: "inbound" | "outbound";
  body: string;
  authorType?: "guest" | "ai" | "host";
  aiIntent?: string | null;
};

/** Önceki bir soru-cevap: sessizlik ancak önceki bir cevaptan sonra (ilk mesaj bir selamdır). */
const PRIOR: SeedMessage[] = [
  { direction: "inbound", body: "Wifi şifresi nedir?" },
  { direction: "outbound", body: "Wifi şifresi kılavuzda." },
];

async function seedChannel(messages: SeedMessage[], opts: { lastMessageAtShiftMs?: number } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const t0 = Date.now() - (messages.length + 1) * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      lastMessageAt: new Date(t0 + (messages.length - 1) * 60_000 + (opts.lastMessageAtShiftMs ?? 0)),
      messages: {
        create: messages.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : m.authorType === "ai" ? "GuestOps AI" : "Host",
          ...(m.authorType ? { authorType: m.authorType } : {}),
          ...(m.aiIntent !== undefined ? { aiIntent: m.aiIntent } : {}),
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true } } },
  });
  return {
    orgId: org.id,
    propertyId: property.id,
    conversationId: conversation.id,
    messageIds: conversation.messages.map((m) => m.id),
  };
}

async function channelEvents(conversationId: string) {
  return prisma.riskEvent.findMany({ where: { conversationId, surface: "auto_reply" }, orderBy: { occurredAt: "asc" } });
}

async function conversationOf(conversationId: string) {
  return prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
}

describe("kanal oto-yanıtı — kapanışa sessizlik", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 düz bir cevaptan sonra 'Tamamdır, teşekkürler 👍' → hiçbir şey gönderilmez, model ÇAĞRILMAZ, 'cevap gerekmedi'", async () => {
    const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Tamamdır, teşekkürler 👍" }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("closing_ack");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    const [ev] = await channelEvents(conversationId);
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack", riskLevel: null, confidence: null });
  });

  it("🚨 P1: övgü artık modele gider (övgü listesi soru işaretsiz soruyu da kabul ediyordu)", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "general", confidence: 0.3 });
    const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Her şey harikaydı, çok teşekkürler!" }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(out.skippedReason).not.toBe("closing_ack");
  });

  it("🚨 P1: 'is the apartment clean' (soru işaretsiz soru) susturulmaz ve GİZLENMEZ — modele gider", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "general", confidence: 0.9, reply: "Yes, it is cleaned before every stay." });
    const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "is the apartment clean" }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(out.skippedReason).not.toBe("closing_ack");
    expect(isClosingHandled(await conversationOf(conversationId))).toBe(false);
  });

  it("🚨 P2: önceki cevap OLMADAN gelen 'İyi akşamlar' bir SELAMDIR — modele gider", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, confidence: 0.3 });
    const { conversationId } = await seedChannel([{ direction: "inbound", body: "İyi akşamlar" }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(out.skippedReason).not.toBe("closing_ack");
  });

  it("🚨 P1: teklif kabulü ('Transfer ayarlayayım mı?' → 'Tamam olur'): misafire yine hiçbir şey gitmez ama konuşma GÖRÜNÜR kalır", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Havalimanından nasıl gelebiliriz?" },
      { direction: "outbound", body: "Size transfer ayarlayayım mı?", authorType: "host" },
      { direction: "inbound", body: "Tamam olur" },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("closing_ack_open");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    const convo = await conversationOf(conversationId);
    expect(convo.skippedReason).toBe("closing_ack_open");
    expect(isClosingHandled(convo)).toBe(false);
    const [ev] = await channelEvents(conversationId);
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack" });
  });

  it("🚨 P1: ücret içeren teklif ('Geç çıkış 500 TL.') → 'Harika olur' görünür kalır", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Geç çıkış mümkün mü" },
      { direction: "outbound", body: "Geç çıkış 500 TL.", authorType: "host" },
      { direction: "inbound", body: "Harika olur" },
    ]);
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack_open");
  });

  it("🚨 P1: yapay zekânın DEVİR cevabından sonraki 'Tamam teşekkürler' görünür kalır (insan talebi kaybolmaz)", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Ev sahibiyle konuşabilir miyim" },
      { direction: "outbound", body: "Mesajınız kaydedildi ve ev sahibiniz görebilir.", authorType: "ai", aiIntent: "human_request" },
      { direction: "inbound", body: "Tamam teşekkürler" },
    ]);
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack_open");
  });

  it("🚨 P1: ev sahibine bırakılmış (tutulan) bir soru varsa, araya giren otomatik mesajdan sonraki teşekkür onu GİZLEMEZ", async () => {
    const { orgId, conversationId, messageIds } = await seedChannel([
      { direction: "inbound", body: "Otopark var mı?" },
      { direction: "outbound", body: "Hoş geldiniz! Giriş bilgileri ektedir.", authorType: "ai", aiIntent: null },
      { direction: "inbound", body: "Teşekkürler" },
    ]);
    await prisma.riskEvent.create({
      data: { organizationId: orgId, conversationId, surface: "auto_reply", triggerId: messageIds[0], finalDecision: "human_review" },
    });
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack_open");
  });

  it("🚨 kiracı izolasyonu: BAŞKA org'un aynı tetikleyicili karar kaydı açık iş SAYILMAZ", async () => {
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    const { conversationId, messageIds } = await seedChannel([
      { direction: "inbound", body: "Otopark var mı?" },
      { direction: "outbound", body: "Otopark binanın arkasında.", authorType: "ai", aiIntent: "parking" },
      { direction: "inbound", body: "Teşekkürler" },
    ]);
    await prisma.riskEvent.create({
      data: { organizationId: other.id, surface: "auto_reply", triggerId: messageIds[0], finalDecision: "human_review" },
    });
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack");
  });

  it("🚨 P2: sağlayıcının son mesaj damgası karar verilen mesajın ÖTESİNDEYSE (içe alınmamış fotoğraf) gizlenmez", async () => {
    const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Tamam" }], {
      lastMessageAtShiftMs: 10 * 60_000,
    });
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack_open");
  });

  it("🚨 'cevap gerekmedi' hâli: damgalanır, bir sonraki turda yeniden modellenmez; misafir yeniden yazınca hâl düşer", async () => {
    const { orgId, conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Tamamdır, teşekkürler 👍" }]);
    await runDueChannelAutoReplies(orgId);
    const convo = await conversationOf(conversationId);
    expect(convo.status).toBe("new"); // durum DEĞİŞMEZ (senkron son mesajdan yeniden kurar)
    expect(isClosingHandled(convo)).toBe(true);
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0);
    // SQL ikizi aynı hükmü verir.
    expect(await prisma.conversation.count({ where: { id: conversationId, AND: [notClosingHandledWhere()] } })).toBe(0);

    // Misafir yeniden yazdı → konuşma kendiliğinden yeniden "yeni".
    const later = new Date(Date.now() + 1_000);
    await prisma.message.create({
      data: { conversationId, direction: "inbound", senderName: "Alex", body: "Wifi şifresi nedir?", createdAt: later },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later } });
    const reopened = await conversationOf(conversationId);
    expect(isClosingHandled(reopened)).toBe(false);
    expect(await prisma.conversation.count({ where: { id: conversationId, AND: [notClosingHandledWhere()] } })).toBe(1);
  });

  it("görünür kapanış ('closing_ack_open') da damgalanır: bir sonraki turda yeniden modellenmez", async () => {
    const { orgId, conversationId } = await seedChannel([
      { direction: "inbound", body: "Havalimanından nasıl gelebiliriz?" },
      { direction: "outbound", body: "Size transfer ayarlayayım mı?", authorType: "host" },
      { direction: "inbound", body: "Tamam olur" },
    ]);
    await runDueChannelAutoReplies(orgId);
    expect((await conversationOf(conversationId)).skippedReason).toBe("closing_ack_open");
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0);
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("oto-yanıt önizlemesi 'cevap gerekmedi' konuşmasını ALMAZ (yer doldurmaz, modeli yeniden çağırmaz)", async () => {
    const { orgId, conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Teşekkürler!" }]);
    await runDueChannelAutoReplies(orgId);
    expect(isClosingHandled(await conversationOf(conversationId))).toBe(true);
    expect(await previewChannelAutoReplies(orgId)).toEqual([]);
    // Misafir yeniden yazınca önizlemeye geri gelir.
    const later = new Date(Date.now() + 1_000);
    await prisma.message.create({
      data: { conversationId, direction: "inbound", senderName: "Alex", body: "Wifi şifresi nedir?", createdAt: later },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later } });
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "wifi", confidence: 0.9, reply: "Wifi şifresi kılavuzda." });
    expect(await previewChannelAutoReplies(orgId)).toHaveLength(1);
  });

  it("KONTROL: 'Anladım teşekkürler ama 12'de gelebilir miyiz?' kapanış DEĞİL — modele gider", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "early_checkin", confidence: 0.9 });
    const { orgId, conversationId } = await seedChannel([
      ...PRIOR,
      { direction: "inbound", body: "Anladım teşekkürler ama 12'de gelebilir miyiz?" },
    ]);
    // Zaman bağlamı (09-25): "yarın / bugün" org diliminde — dilim cevap modeline ULAŞIR (varsayılanla karışmasın diye başka dilim).
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/New_York" } });
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalled();
    expect(mockSuggest.mock.calls[0][0].timeZone).toBe("America/New_York");
    expect(out.skippedReason).not.toBe("closing_ack");
  });

  // ── İKİNCİ İNCELEME (09-25) ───────────────────────────────────────────────────────────────────────────────────────
  it("🚨 P1: hoş geldiniz otomasyonundan sonraki İLK misafir mesajı 'İyi akşamlar' bir SELAMDIR — sessizlik yok, modele gider", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, confidence: 0.3 });
    const { conversationId } = await seedChannel([
      { direction: "outbound", body: "Hoş geldiniz! Giriş talimatlarınız kılavuzda.", authorType: "ai", aiIntent: "checkin_instructions" },
      { direction: "inbound", body: "İyi akşamlar" },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalled();
    expect(out.skippedReason).not.toMatch(/^closing_ack/);
  });

  it("🚨 P1: yapay zekânın soru işaretsiz TEKLİFİNE 'Olur' bir CEVAPTIR — kısayol yok, iki model de susturamaz", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Havalimanından nasıl gelirim" },
      { direction: "outbound", body: "Havaş ile gelebilirsiniz. İsterseniz yol tarifini de gönderebilirim.", authorType: "ai", aiIntent: "directions" },
      { direction: "inbound", body: "Olur" },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalled();
    expect(out.skippedReason).not.toMatch(/^closing_ack/);
    expect(mockSend).not.toHaveBeenCalled(); // düşük güven → taslak ev sahibine
  });

  it("🚨 P1: ev sahibinin soru işaretsiz TEKLİFİNİN kabulü: misafire hiçbir şey gitmez (kısayol) ama konuşma GÖRÜNÜR kalır", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Havlular az" },
      { direction: "outbound", body: "İsterseniz yarın sabah temizlikçi ile yeni havlu gönderebilirim.", authorType: "host" },
      { direction: "inbound", body: "Olur, teşekkürler" },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.skippedReason).toBe("closing_ack_open");
  });

  it("🚨 P1: konaklama DIŞI konuda yapay zekânın ertelemesinden sonraki teşekkür görünür kalır (beyan 'defers' taşımaz)", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Köpeğimizi getirebilir miyiz" },
      {
        direction: "outbound",
        body: "Evcil hayvan kabulü ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
        authorType: "ai",
        aiIntent: "general",
      },
      { direction: "inbound", body: "Tamam teşekkürler" },
    ]);
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("closing_ack_open");
  });

  it("🚨 P1: nezaket cevabı AÇIKKEN ev sahibine bırakılmış soru varsa 'Rica ederiz' GİTMEZ — sessiz + görünür", async () => {
    const { orgId, conversationId, messageIds } = await seedChannel([
      { direction: "inbound", body: "Otopark var mı?" },
      { direction: "outbound", body: "Hoş geldiniz! Giriş bilgileri kılavuzda.", authorType: "ai", aiIntent: null },
      { direction: "inbound", body: "Teşekkürler" },
    ]);
    await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
    await prisma.riskEvent.create({
      data: { organizationId: orgId, conversationId, surface: "auto_reply", triggerId: messageIds[0], finalDecision: "human_review" },
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.skippedReason).toBe("closing_ack_open");
    // KONTROL: açık iş yoksa nezaket cevabı gider.
    const plain = await seedChannel([...PRIOR, { direction: "inbound", body: "Teşekkürler" }]);
    await prisma.organization.update({ where: { id: plain.orgId }, data: { autoClosingReplyEnabled: true } });
    expect((await applyChannelAutoReply(plain.conversationId)).sent).toBe(true);
  });

  describe("anlam yolu (sözcük listesinin tanımadığı kapanış: 'Anladım, kolay gelsin')", () => {
    const THANKS: SeedMessage[] = [...PRIOR, { direction: "inbound", body: "Anladım, kolay gelsin" }];

    it("🚨 anlama katmanı yalnız teşekkür + cevap modeli genel/0.3 → hiçbir şey gönderilmez, 'cevap gerekmedi'", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { orgId, conversationId } = await seedChannel(THANKS);
      const out = await runDueChannelAutoReplies(orgId);
      expect(mockSuggest).toHaveBeenCalledTimes(1);
      expect(out.sent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
      const [ev] = await channelEvents(conversationId);
      expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack_semantic", riskLevel: "none", confidence: 0.3 });
      expect(ev.kbEvidenceJson).not.toBeNull();
      // P3 (inceleme): model koştu → temellendirme sütunları da yazılır (NULL = "ölçülmedi" okunmasın).
      expect(ev.kbRetrieved).not.toBeNull();
      expect(ev.srcDeclared).not.toBeNull();
      // Damga + hâl: sıradaki turda yeniden modellenmez.
      expect(isClosingHandled(await conversationOf(conversationId))).toBe(true);
      expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0);
      expect(mockSuggest).toHaveBeenCalledTimes(1);
    });

    it("🚨 P2: önceki cevap yoksa anlam yolu da susturmaz (ilk 'Anladım' → bugünkü davranış)", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel([{ direction: "inbound", body: "Anladım, kolay gelsin" }]);
      expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("low_confidence_or_risky");
    });

    it("🚨 P2: 'Merhaba, bir sorum olacaktı' — iki model 'yalnız selam' dese de susturulmaz (teşekkür sinyali yok)", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Merhaba, bir sorum olacaktı" }]);
      expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("low_confidence_or_risky");
    });

    it("🚨 P2: anlama katmanı istek tavanında (liste kesilmiş olabilir) → susturulmaz", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      const five = { ...NLU_THANKS, requests: Array.from({ length: 5 }, () => NLU_THANKS.requests[0]) };
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: five }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel(THANKS);
      expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("low_confidence_or_risky");
    });

    it("KONTROL: anlama katmanı KAPALI → bugünkü davranış (taslak ev sahibine, 'emin olamadı')", async () => {
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel(THANKS);
      const out = await applyChannelAutoReply(conversationId);
      expect(out.skippedReason).toBe("low_confidence_or_risky");
      const [ev] = await channelEvents(conversationId);
      expect(ev.finalDecision).toBe("human_review");
    });

    it("KONTROL: cevap modeli kapanış demedi (niyet 'checkin') → bugünkü davranış", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "checkin" });
      const { conversationId } = await seedChannel(THANKS);
      expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("low_confidence_or_risky");
    });

    it("KONTROL: anlama katmanı teşekkürün yanında bir SORU gördü → bugünkü davranış", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS_AND_WIFI }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel(THANKS);
      expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("low_confidence_or_risky");
    });

    it("🚨 BİRLEŞİM: iki model 'yalnız teşekkür' dese de kelime ağının konaklama isteği SUSTURULAMAZ", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      // Soru işaretsiz (işaret de tek başına susturmayı engellerdi — burada sınanan kelime ağının isteği).
      const { conversationId } = await seedChannel([...PRIOR, { direction: "inbound", body: "Anladım, bir gece daha kalabilir miyiz" }]);
      const out = await applyChannelAutoReply(conversationId);
      expect(out.skippedReason).not.toBe("closing_ack");
      const [ev] = await channelEvents(conversationId);
      expect(ev.finalDecision).toBe("human_review");
    });

    it("🚨 anlama katmanının penceresine sığmayan cevapsız mesaj varsa (6 > 5) sessizlik YOK — görmediğini onaylayamaz", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel([
        ...PRIOR,
        ...Array.from({ length: 6 }, () => ({ direction: "inbound" as const, body: "Anladım" })),
      ]);
      const out = await applyChannelAutoReply(conversationId);
      expect(out.skippedReason).toBe("low_confidence_or_risky");
    });

    it("🚨 kapı başka bir kontrolden kapandıysa (model riski) sessizlik YOK — güvenlik gerekçesi önce", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, riskLevel: "medium" as never });
      const { conversationId } = await seedChannel(THANKS);
      const out = await applyChannelAutoReply(conversationId);
      expect(out.skippedReason).not.toBe("closing_ack");
    });
  });
});

// ── QR ───────────────────────────────────────────────────────────────────────

async function seedQr() {
  const org = await prisma.organization.create({ data: { name: "QR Org", timezone: "Europe/Istanbul" } });
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "Lale",
      chatEnabled: true,
      chatToken: token,
      checkInTime: "15:00",
      checkOutTime: "11:00",
    },
  });
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId: org.id, propertyId: property.id, token };
}

let seq = 0;
async function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `cs${++seq}-${Math.random().toString(36).slice(2)}` }),
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
    select: { direction: true, body: true },
  });
}

/** QR'da önceki bir soru-cevap (bot cevabı gider): sessizlik ancak önceki bir cevaptan sonra. */
async function askPriorAnswer(token: string, cookie?: string) {
  mockSuggest.mockResolvedValueOnce({ ...CLOSING_DRAFT, intent: "checkin", confidence: 0.95, reply: "Giriş 15:00'ten itibaren." });
  return ask(token, "Giriş saati kaçta?", cookie);
}

describe("QR misafir sohbeti — kapanışa sessizlik", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 cevaptan sonra 'Teşekkürler!' → bot mesajı YOK, devir YOK, model ve günlük kota harcanmaz; 'cevap gerekmedi'", async () => {
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    const usageBefore = await prisma.chatUsage.findFirst({ where: { propertyId } });
    const { body } = await ask(token, "Teşekkürler!", prior.cookie);
    expect(body.noReply).toBe(true);
    expect(body.escalated).toBeFalsy();
    expect(body.reply).toBeUndefined();
    expect(mockSuggest).toHaveBeenCalledTimes(1); // yalnız önceki soru
    expect((await qrMessages(propertyId)).at(-1)).toEqual({ direction: "inbound", body: "Teşekkürler!" });
    expect((await prisma.chatUsage.findFirst({ where: { propertyId } }))?.count).toBe(usageBefore?.count);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat", finalDecision: "no_reply" } });
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack" });
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    expect(convo.priority).not.toBe("urgent");
    expect(isClosingHandled(convo)).toBe(true);
  });

  it("🚨 P2: önceki cevap OLMADAN gelen 'Teşekkürler!' → modele gider (ilk mesaj bir selam/teşekkürdür, kapanış değil)", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, confidence: 0.9, reply: "Rica ederiz!" });
    const { token } = await seedQr();
    const { body } = await ask(token, "Teşekkürler!");
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(body.noReply).toBeUndefined();
  });

  it("🚨 P3: yapay zekâ duraklatılmışken yazılmış cevapsız soru varsa sonraki 'Teşekkürler' konuşmayı GİZLEMEZ", async () => {
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    // Cevaplanmamış bir misafir sorusu (AI duraklatılmışken yazılmış, ev sahibi cevaplamadan yeniden açılmış).
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "inbound", authorType: "guest", senderName: "x", body: "Havlu var mı?" },
    });
    const { body } = await ask(token, "Teşekkürler!", prior.cookie);
    // "Havlu var mı?" + "Teşekkürler!" — tümü kapanış değil → sözcük yolu susturmaz, normal akış.
    expect(body.noReply).toBeUndefined();
    expect(isClosingHandled(await prisma.conversation.findFirstOrThrow({ where: { id: convo.id } }))).toBe(false);
  });

  it("🚨 P1: QR devrinden sonraki 'Tamam teşekkürler' görünür kalır (karar kaydı: ev sahibine bırakıldı)", async () => {
    const { propertyId, token } = await seedQr();
    mockSuggest.mockResolvedValueOnce({ ...CLOSING_DRAFT, intent: "complaint", confidence: 0.9, reply: "…" });
    const first = await ask(token, "Klima çalışmıyor");
    expect(first.body.escalated).toBe(true);
    const { body } = await ask(token, "Tamam teşekkürler", first.cookie);
    expect(body.noReply).toBe(true);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    expect(convo.skippedReason).toBe("closing_ack_open");
    expect(isClosingHandled(convo)).toBe(false);
  });

  it("🚨 'Dikkat gerektirenler' sessiz kalınan teşekkürü cevapsız SAYMAZ; misafir yeniden yazınca sayar", async () => {
    const { orgId, propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    await ask(token, "Teşekkürler!", prior.cookie);
    // Mesajları eşiğin ötesine yaşlandır (damga da aynı ana — karar o mesaj içindi).
    const old = new Date(Date.now() - (UNANSWERED_HOURS + 2) * HOUR);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    await prisma.message.updateMany({ where: { conversationId: convo.id }, data: { createdAt: old } });
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: old, autoReplyAttemptedAt: old } });
    expect((await findAttentionItems(orgId)).filter((i) => i.kind === "unanswered_aging")).toEqual([]);

    // Yeni misafir mesajı (bot cevaplamadı — örn. devir sürüyor) → artık cevapsız sayılır.
    const later = new Date(old.getTime() + HOUR);
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "inbound", authorType: "guest", senderName: "x", body: "Havlu var mı?", createdAt: later },
    });
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: later } });
    expect((await findAttentionItems(orgId)).some((i) => i.kind === "unanswered_aging")).toBe(true);
  });

  it("anlam yolu: cevaptan sonra 'Anladım' + anlama katmanı yalnız teşekkür + cevap modeli genel/0.3 → bot mesajı YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım", prior.cookie);
    expect(body.noReply).toBe(true);
    expect(body.escalated).toBeFalsy();
    expect((await qrMessages(propertyId)).at(-1)).toEqual({ direction: "inbound", body: "Anladım" });
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat", finalDecision: "no_reply" } });
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack_semantic", confidence: 0.3 });
    expect(ev.kbEvidenceJson).not.toBeNull();
  });

  it("🚨 P2 (QR anlam yolu): önceki cevap YOKSA ilk 'Anladım' susturulmaz (ilk mesaj bir selamdır)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const { token } = await seedQr();
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım");
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true); // bugünkü davranış: düşük güven devri
  });

  it("🚨 P3 (QR anlam yolu): yapay zekâ duraklatılmışken yazılmış cevapsız soru varsa 'Anladım' SUSTURULMAZ", async () => {
    // Anlama katmanı yalnız bu mesajı değerlendirdi; öndeki "Havlu var mı?"yı onaylayamaz (mutasyon turu 09-25: pinsizdi).
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "inbound", authorType: "guest", senderName: "x", body: "Havlu var mı?" },
    });
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım", prior.cookie);
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true);
  });

  it("P3 (ikinci inceleme): sözcük listesindeki kapanışın ardından gelen İKİNCİ kapanış ('Teşekkürler' → 'Anladım') da sessiz — devir/uyarı yok", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const { token } = await seedQr();
    const prior = await askPriorAnswer(token);
    const first = await ask(token, "Teşekkürler!", prior.cookie);
    expect(first.body.noReply).toBe(true);
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım", first.cookie);
    expect(body.noReply).toBe(true);
    expect(body.escalated).toBeFalsy();
  });

  it("🚨 BİRLEŞİM (QR): iki model 'yalnız teşekkür' dese de kelime ağının konaklama isteği SUSTURULAMAZ → devir", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım, bir gece daha kalabilir miyiz", prior.cookie);
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat", finalDecision: "human_review" } });
    expect(ev.finalDecision).toBe("human_review");
  });

  it("KONTROL: anlama katmanı kapalı → bugünkü davranış (düşük güven devri)", async () => {
    const { orgId, token } = await seedQr();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/New_York" } });
    const prior = await askPriorAnswer(token);
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { body } = await ask(token, "Anladım", prior.cookie);
    expect(body.escalated).toBe(true);
    expect(body.noReply).toBeUndefined();
    // Zaman bağlamı (09-25): QR'da da "bugün / yarın" org diliminde (rezervasyon ayrıntısı olmadan).
    expect(mockSuggest.mock.calls[0][0].timeZone).toBe("America/New_York");
  });

  it("KONTROL: 'Teşekkürler ama klima çalışmıyor' kapanış DEĞİL — normal akış (şikâyet devri)", async () => {
    const { token } = await seedQr();
    const prior = await askPriorAnswer(token);
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "complaint", confidence: 0.9 });
    const { body } = await ask(token, "Teşekkürler ama klima çalışmıyor", prior.cookie);
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true);
  });

  it("sessiz kalınan kapanıştan sonraki gerçek soru normal cevaplanır", async () => {
    const { propertyId, token } = await seedQr();
    const prior = await askPriorAnswer(token);
    const closing = await ask(token, "Teşekkürler!", prior.cookie);
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "wifi", confidence: 0.95, reply: "Wifi şifresi kılavuzda." });
    const { body } = await ask(token, "Wifi şifresi nedir?", closing.cookie);
    expect(body.reply).toBe("Wifi şifresi kılavuzda.");
    expect((await qrMessages(propertyId)).map((m) => m.direction)).toEqual(["inbound", "outbound", "inbound", "inbound", "outbound"]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
