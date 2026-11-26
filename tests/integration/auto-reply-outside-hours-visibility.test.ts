import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// "AKTİF SAAT ARALIĞI DIŞINDA" SEBEBİ ÜRETİM YOLUNDA GERÇEKTEN YAZILIR
// (derin denetim, 2026-08-01 — YÜKSEK).
//
// 07-31'de `applyChannelAutoReply` içine "sebep görünür olsun" diye
// `outside_hours` yazımı eklenmişti. Ama TEK üretim çağıranı olan
// `runDueChannelAutoReplies` BİREBİR AYNI kontrolü org seviyesinde yapıp
// hiçbir konuşmaya dokunmadan erken dönüyordu → o satıra ASLA ulaşılmıyordu.
// Düzeltme üretimde ÖLÜ KODdu; testler yeşildi çünkü `applyChannelAutoReply`'ı
// DOĞRUDAN çağırıyorlardı (üretim yolunu hiç geçmiyorlardı).
//
// Etki küçük değil: şema varsayılanı hâlâ 00:00–09:00 olduğu için MEVCUT tüm
// org'lar (Lale dahil) gündüz boyunca bu daldan geçiyor. Host saat 14:00'te
// gelen mesabın neden cevaplanmadığını inbox'ta arıyor, hiçbir şey yazmıyor.
//
// Bu test ÜRETİM YOLUNU (`runDueChannelAutoReplies`) çağırır — düzeltmenin
// gerçekten çalıştığını gösteren tek şey budur.
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

import { suggestReply } from "@/lib/ai";
import { runDueChannelAutoReplies } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

/**
 * Org'u ŞU ANIN saatine göre kapalı bir pencereye yerleştir: pencere = bir
 * sonraki saatte başlayıp biten 1 saatlik dilim, yani şu an KESİNLİKLE dışarıda.
 * (Sabit 0–9 yazmak testi günün saatine bağımlı kılardı.)
 */
function closedWindowNow(): { start: number; end: number } {
  const h = new Date().getUTCHours();
  return { start: (h + 2) % 24, end: (h + 3) % 24 };
}

async function seed(window: { start: number; end: number }) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone: "UTC",
      autoReplyHospitable: true,
      autoReplyStartHour: window.start,
      autoReplyEndHour: window.end,
      autoReplyEnabledAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  const when = new Date(Date.now() - 10 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: when,
      messages: {
        create: [
          { direction: "inbound", senderName: "Alex", body: "Wifi şifresi nedir?", createdAt: when },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id, propertyId: property.id };
}

describe("aktif saat dışında — sebep ÜRETİM yolunda yazılır", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saat dışındayken sebep KONUŞMAYA yazılır ve model HİÇ çağrılmaz", async () => {
    const { orgId, conversationId } = await seed(closedWindowNow());

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(0);
    expect(mockSuggest).not.toHaveBeenCalled(); // görünürlük ücretsiz olmalı

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.skippedReason).toBe("outside_hours");
    expect(c.status).toBe("new"); // hâlâ cevap bekliyor
    expect(c.autoReplyAttemptedAt).toBeNull(); // damgalanmadı → pencere açılınca yanıtlanır
  });

  it("GERÇEK sebebi EZMEZ (şikayet/eskalasyon etiketi korunur)", async () => {
    const { orgId, conversationId } = await seed(closedWindowNow());
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { skippedReason: "escalated_to_human" },
    });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.skippedReason).toBe("escalated_to_human");
  });

  it("saat İÇİNDEYKEN sebep yazılmaz — normal yanıtlanır (regresyon pini)", async () => {
    mockSuggest.mockResolvedValue({
      intent: "wifi",
      confidence: 0.95,
      reply: "Wi-Fi ağı LaleApt, şifre 12345678.",
      risk: null,
      priority: "standard" as const,
      source: "openai" as const,
      actionSuggestion: null,
      riskLevel: "none" as const,
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
    });
    // start === end → tüm gün açık (kod sözleşmesi).
    const { orgId, conversationId } = await seed({ start: 0, end: 0 });

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.skippedReason).toBeNull();
    expect(c.status).toBe("answered");
  });

  it("BAŞKA org'un konuşmasına dokunmaz (kiracı izolasyonu)", async () => {
    const a = await seed(closedWindowNow());
    const b = await seed(closedWindowNow());

    await runDueChannelAutoReplies(a.orgId);

    const other = await prisma.conversation.findUniqueOrThrow({ where: { id: b.conversationId } });
    expect(other.skippedReason).toBeNull();
  });

  it("ADAY OLMAYAN konuşmaya dokunmaz (insan devri süren thread)", async () => {
    const { orgId, propertyId } = await seed(closedWindowNow());
    const held = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "Held",
        externalReservationId: "res-held",
        status: "new",
        lastMessageAt: new Date(Date.now() - 5 * 60_000),
        autoReplyHoldUntil: new Date(Date.now() + 6 * 60 * 60 * 1000),
      },
    });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: held.id } });
    expect(c.skippedReason).toBeNull();
  });
});
