import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KALICI GÖNDERİM HATASINDA SONSUZ DÖNGÜ YOK (derin denetim, 2026-08-01 — KRİTİK).
//
// Bulunan arıza (satır içi gönderim yolu = ÜRETİM VARSAYILANI, outbox bayrağı KAPALI):
//
//   1. Kapı geçer → model çağrılır (para) → günlük kotadan 1 düşer.
//   2. `sendOnChannel` KALICI bir hata döndürür (4xx — ör. 402 "abonelik pasif",
//      404 "rezervasyon yok", 422 "mesaj reddedildi").
//   3. `isDefinitiveSendFailure` true → claim geri alınır (status → "new").
//   4. `runDueChannelAutoReplies` `send_failed`'i "geçici" sayıp
//      `autoReplyAttemptedAt` DAMGALAMAZ.
//   5. 2 dakika sonra konuşma yeniden UYGUN → 1'e dön.
//
// Sonuç: 2 dakikada bir, `freshSince` penceresi boyunca, SONSUZA KADAR bir model
// çağrısı + bir kota birimi yanar. Tek bir bozuk konuşma org'un GÜNLÜK AI
// KOTASININ TAMAMINI (150) ~5 saatte tüketir ve gerçek misafirlerin oto-yanıtını
// `daily_budget` ile kapatır. Host hiçbir ekranda sebebi göremez.
//
// ⚠️ Bu senaryo teorik DEĞİL: Nuve'nin canlı Hospitable aboneliği bugün 402
// durumunda. Dayanıklı outbox bu durumu ZATEN kalıcı `blocked` diye biliyor
// (`classifySendResult` → "blocked"); satır içi yol o bilgiyi hiç kullanmıyordu.
//
// Düzeltme: hata TÜRÜNE göre `autoReplyHoldUntil` geri çekilmesi (backoff) +
// sebebin KALICI olarak yazılması. Mesaj KAYBOLMAZ — süre dolunca yeniden
// denenir; yalnız 2 dakikada bir yeniden modellenmez.
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
import { sendOnChannel } from "@/lib/messaging";
import {
  runDueChannelAutoReplies,
  SEND_FAILURE_HOLD_MS,
  SEND_RATE_LIMIT_HOLD_MS,
} from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const cleanVerdict = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Wi-Fi ağı NuveApt, şifre 12345678.",
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
};

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
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
  return { orgId: org.id, conversationId: conversation.id };
}

describe("kalıcı gönderim hatası — geri çekilme var, sonsuz döngü yok", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    mockSend.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KALICI 4xx: ikinci geçiş modeli YENİDEN ÇAĞIRMAZ (kota yanmaz)", async () => {
    const { orgId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 422 - message rejected" });

    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Aynı anda gelen bir sonraki geçiş (üretimde 2 dakika sonra):
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1); // ⬅️ ARIZADA 2 olurdu
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KALICI 4xx: konuşma yeniden denenebilir kalır (mesaj KAYBOLMAZ)", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 422 - message rejected" });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    // Claim geri alındı → satır hâlâ cevapsız (host görebiliyor).
    expect(c.status).toBe("new");
    // Kalıcı damga YOK → süre dolunca yeniden denenir.
    expect(c.autoReplyAttemptedAt).toBeNull();
    // Geri çekilme penceresi yazıldı.
    expect(c.autoReplyHoldUntil).not.toBeNull();
    expect(c.autoReplyHoldUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(c.autoReplyHoldUntil!.getTime()).toBeLessThanOrEqual(Date.now() + SEND_FAILURE_HOLD_MS + 5_000);
  });

  it("geri çekilme SÜRESİ dolunca yeniden denenir", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 422 - message rejected" });
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);

    // Süre doldu (zamanı ileri sarmak yerine pencereyi geçmişe çekiyoruz).
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { autoReplyHoldUntil: new Date(Date.now() - 1000) },
    });
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "m9" });

    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.status).toBe("answered");
  });

  it("402 (abonelik pasif): sebep host'a GÖRÜNÜR bir kod olarak yazılır", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 402 - subscription not active" });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.skippedReason).toBe("subscription_inactive");
    // Sağlayıcının ham hata metni DB'ye yazılmaz (sebep bir KOD'dur).
    expect(c.skippedReason).not.toContain("HTTP");
  });

  it("429 (yoğunluk): geri çekilme KISA — kalıcı hatayla aynı kefeye konmaz", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 429 - too many requests" });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.skippedReason).toBe("rate_limited");
    expect(c.autoReplyHoldUntil!.getTime()).toBeLessThanOrEqual(
      Date.now() + SEND_RATE_LIMIT_HOLD_MS + 5_000,
    );
    expect(SEND_RATE_LIMIT_HOLD_MS).toBeLessThan(SEND_FAILURE_HOLD_MS);
  });

  it("BELİRSİZ hata (5xx/timeout): claim TUTULUR, geri çekilme YAZILMAZ (regresyon pini)", async () => {
    // Mesaj misafire ULAŞMIŞ OLABİLİR → asla yeniden gönderilmez. Bu yol
    // konuşmayı "answered" bıraktığı için zaten aday kümesinde değildir.
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 503 - upstream" });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.status).toBe("answered");
    expect(c.autoReplyHoldUntil).toBeNull();
  });

  it("BAŞARILI gönderimde geri çekilme yazılmaz (regresyon pini)", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "m1" });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.status).toBe("answered");
    expect(c.autoReplyHoldUntil).toBeNull();
    expect(c.skippedReason).toBeNull();
  });
});
