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

async function seedChannel(messages: { direction: "inbound" | "outbound"; body: string }[]) {
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
      lastMessageAt: new Date(t0 + (messages.length - 1) * 60_000),
      messages: {
        create: messages.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : "Host",
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true },
  });
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id };
}

async function channelEvents(conversationId: string) {
  return prisma.riskEvent.findMany({ where: { conversationId, surface: "auto_reply" }, orderBy: { occurredAt: "asc" } });
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

  it("🚨 övgü (nezaket kapalı): hiçbir şey gönderilmez, model ÇAĞRILMAZ, karar kaydı 'cevap gerekmedi'", async () => {
    const { conversationId } = await seedChannel([
      { direction: "inbound", body: "Wifi şifresi nedir?" },
      { direction: "outbound", body: "Wifi şifresi kılavuzda." },
      { direction: "inbound", body: "Her şey harikaydı, çok teşekkürler!" },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("closing_ack");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    const [ev] = await channelEvents(conversationId);
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack", riskLevel: null, confidence: null });
  });

  it("🚨 önceki cevap OLMADAN gelen teşekkür: hiçbir şey gönderilmez, model ÇAĞRILMAZ", async () => {
    const { conversationId } = await seedChannel([{ direction: "inbound", body: "Teşekkürler!" }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBe("closing_ack");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 'cevap gerekmedi' hâli: damgalanır, bir sonraki turda yeniden modellenmez; misafir yeniden yazınca hâl düşer", async () => {
    const { orgId, conversationId } = await seedChannel([{ direction: "inbound", body: "Tamamdır, teşekkürler 👍" }]);
    await runDueChannelAutoReplies(orgId);
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
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
    const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(isClosingHandled(reopened)).toBe(false);
    expect(await prisma.conversation.count({ where: { id: conversationId, AND: [notClosingHandledWhere()] } })).toBe(1);
  });

  it("oto-yanıt önizlemesi 'cevap gerekmedi' konuşmasını ALMAZ (yer doldurmaz, modeli yeniden çağırmaz)", async () => {
    const { orgId, conversationId } = await seedChannel([{ direction: "inbound", body: "Teşekkürler!" }]);
    await runDueChannelAutoReplies(orgId);
    expect(isClosingHandled(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }))).toBe(true);
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
      { direction: "inbound", body: "Anladım teşekkürler ama 12'de gelebilir miyiz?" },
    ]);
    // Zaman bağlamı (09-25): "yarın / bugün" org diliminde — dilim cevap modeline ULAŞIR (varsayılanla karışmasın diye başka dilim).
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/New_York" } });
    const out = await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalled();
    expect(mockSuggest.mock.calls[0][0].timeZone).toBe("America/New_York");
    expect(out.skippedReason).not.toBe("closing_ack");
  });

  describe("anlam yolu (sözcük listesinin tanımadığı kapanış: 'Anladım, kolay gelsin')", () => {
    const THANKS = [{ direction: "inbound" as const, body: "Anladım, kolay gelsin" }];

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
      // Damga + hâl: sıradaki turda yeniden modellenmez.
      expect(isClosingHandled(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }))).toBe(true);
      expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0);
      expect(mockSuggest).toHaveBeenCalledTimes(1);
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
      const { conversationId } = await seedChannel([{ direction: "inbound", body: "Anladım, bir gece daha kalabilir miyiz?" }]);
      const out = await applyChannelAutoReply(conversationId);
      expect(out.skippedReason).not.toBe("closing_ack");
      const [ev] = await channelEvents(conversationId);
      expect(ev.finalDecision).toBe("human_review");
    });

    it("🚨 anlama katmanının penceresine sığmayan cevapsız mesaj varsa (6 > 5) sessizlik YOK — görmediğini onaylayamaz", async () => {
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
      mockSuggest.mockResolvedValue(CLOSING_DRAFT);
      const { conversationId } = await seedChannel(Array.from({ length: 6 }, () => ({ direction: "inbound" as const, body: "Anladım" })));
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

  it("🚨 'Teşekkürler!' → bot mesajı YOK, devir YOK, model ve günlük kota harcanmaz; karar kaydı 'cevap gerekmedi'", async () => {
    const { propertyId, token } = await seedQr();
    const { body } = await ask(token, "Teşekkürler!");
    expect(body.noReply).toBe(true);
    expect(body.escalated).toBeFalsy();
    expect(body.reply).toBeUndefined();
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await qrMessages(propertyId)).toEqual([{ direction: "inbound", body: "Teşekkürler!" }]);
    expect(await prisma.chatUsage.count({ where: { propertyId } })).toBe(0);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat" } });
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack" });
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    expect(convo.priority).not.toBe("urgent");
    expect(isClosingHandled(convo)).toBe(true);
  });

  it("🚨 'Dikkat gerektirenler' sessiz kalınan teşekkürü cevapsız SAYMAZ; misafir yeniden yazınca sayar", async () => {
    const { orgId, propertyId, token } = await seedQr();
    await ask(token, "Teşekkürler!");
    // Mesajı eşiğin ötesine yaşlandır (damga da aynı ana — karar o mesaj içindi).
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

  it("anlam yolu: 'Anladım' + anlama katmanı yalnız teşekkür + cevap modeli genel/0.3 → bot mesajı YOK, devir YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { propertyId, token } = await seedQr();
    const { body } = await ask(token, "Anladım");
    expect(body.noReply).toBe(true);
    expect(body.escalated).toBeFalsy();
    expect(await qrMessages(propertyId)).toEqual([{ direction: "inbound", body: "Anladım" }]);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat" } });
    expect(ev).toMatchObject({ finalDecision: "no_reply", reason: "closing_ack_semantic", confidence: 0.3 });
    expect(ev.kbEvidenceJson).not.toBeNull();
  });

  it("🚨 BİRLEŞİM (QR): iki model 'yalnız teşekkür' dese de kelime ağının konaklama isteği SUSTURULAMAZ → devir", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_THANKS }));
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { propertyId, token } = await seedQr();
    const { body } = await ask(token, "Anladım, bir gece daha kalabilir miyiz?");
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { propertyId, surface: "guest_chat" } });
    expect(ev.finalDecision).toBe("human_review");
  });

  it("KONTROL: anlama katmanı kapalı → bugünkü davranış (düşük güven devri)", async () => {
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    const { orgId, token } = await seedQr();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/New_York" } });
    const { body } = await ask(token, "Anladım");
    expect(body.escalated).toBe(true);
    expect(body.noReply).toBeUndefined();
    // Zaman bağlamı (09-25): QR'da da "bugün / yarın" org diliminde (rezervasyon ayrıntısı olmadan).
    expect(mockSuggest.mock.calls[0][0].timeZone).toBe("America/New_York");
  });

  it("KONTROL: 'Teşekkürler ama klima çalışmıyor' kapanış DEĞİL — normal akış (şikâyet devri)", async () => {
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "complaint", confidence: 0.9 });
    const { token } = await seedQr();
    const { body } = await ask(token, "Teşekkürler ama klima çalışmıyor");
    expect(body.noReply).toBeUndefined();
    expect(body.escalated).toBe(true);
  });

  it("sessiz kalınan kapanıştan sonraki gerçek soru normal cevaplanır", async () => {
    const { propertyId, token } = await seedQr();
    const first = await ask(token, "Teşekkürler!");
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "checkin", confidence: 0.95, reply: "Giriş 15:00'ten itibaren." });
    const { body } = await ask(token, "Giriş saati kaçta?", first.cookie);
    expect(body.reply).toBe("Giriş 15:00'ten itibaren.");
    expect((await qrMessages(propertyId)).map((m) => m.direction)).toEqual(["inbound", "inbound", "outbound"]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
