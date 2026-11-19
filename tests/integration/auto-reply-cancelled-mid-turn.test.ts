import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// SON KONTROL — MODEL DÜŞÜNÜRKEN İPTAL EDİLEN REZERVASYON (ÖLÇ 11-19 gece bulgusu; kurucu 11-19 akşam: "rezervasyon ve erişim gibi değişken
// bilgilerin son kontrolünü koru", "otomatik onaydan hemen önce yeniden doğrula").
// Kanal satır içi yolu rezervasyon durumunu yalnız tur başında okuyordu: model cevap yazarken (tipik 2–10 sn) senkron rezervasyonu iptal
// ederse Wi-Fi şifresi / giriş bilgisi yine gidiyordu (ölçüldü). Kuyruk yolunda aynı kural gönderim anında var (`outbox/worker.ts`, Codex
// 11-04 P1). Düzeltme: gönderim talebinin KENDİSİ "bağlı rezervasyon iptal değil" der (tek UPDATE, ilişki süzgeci) — kontrol ile talep
// arasına iptal giremez. Talep bu yüzden düşerse sonuç tur başındaki iptal kontrolüyle AYNI: gönderim yok, `reservation_ended`.
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

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const WIFI_REPLY = {
  intent: "wifi",
  confidence: 0.9,
  reply: "Wi-Fi ağımız LaleNet, şifresi deniz2024.",
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

async function seed(opts: { withReservation?: boolean } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Lale Evleri", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3" },
  });
  const reservation =
    opts.withReservation === false
      ? null
      : await prisma.reservation.create({
          data: {
            propertyId: property.id,
            guestName: "Alex",
            arrivalDate: stayDay(-1),
            departureDate: stayDay(2),
            status: "confirmed",
            channel: "airbnb",
            sourceReference: "res-1",
          },
          select: { id: true },
        });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      reservationId: reservation?.id ?? null,
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", body: "Wi-Fi şifresi ne?", createdAt: new Date(Date.now() - 60_000) }],
      },
    },
    select: { id: true },
  });
  return { conversationId: conversation.id, reservationId: reservation?.id ?? null };
}

describe("son kontrol — model düşünürken iptal edilen rezervasyona cevap gitmez (kanal satır içi yol)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 model çağrıdayken rezervasyon iptal edilir → hiçbir şey gönderilmez, sebep reservation_ended, konuşma 'Cevaplandı'ya geçmez", async () => {
    const { conversationId, reservationId } = await seed();
    mockSuggest.mockImplementation(async () => {
      await prisma.reservation.update({ where: { id: reservationId! }, data: { status: "cancelled" } });
      return WIFI_REPLY;
    });

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("reservation_ended");
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.status).toBe("new");
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);
  });

  it("🚨 iptal edilen konaklamanın sonraki turu tur başında durur (aynı sebep) — model yeniden çağrılmaz", async () => {
    const { conversationId, reservationId } = await seed();
    mockSuggest.mockImplementation(async () => {
      await prisma.reservation.update({ where: { id: reservationId! }, data: { status: "cancelled" } });
      return WIFI_REPLY;
    });
    await applyChannelAutoReply(conversationId);
    const again = await applyChannelAutoReply(conversationId);
    expect(again).toMatchObject({ sent: false, skippedReason: "reservation_ended" });
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL: rezervasyon iptal edilmezse cevap gider (talep şartı yanlış engellemiyor)", async () => {
    const { conversationId } = await seed();
    mockSuggest.mockResolvedValue(WIFI_REPLY);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: bağlı rezervasyonu olmayan konuşma (rezervasyon öncesi soru) bugünkü gibi cevaplanır", async () => {
    const { conversationId } = await seed({ withReservation: false });
    mockSuggest.mockResolvedValue({ ...WIFI_REPLY, intent: "general", reply: "Merhaba, size nasıl yardımcı olabiliriz?" });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: model çağrıdayken misafir yeni mesaj yazarsa sebep yine 'yeni mesaj' (iptal yokken ayrım bozulmaz)", async () => {
    const { conversationId } = await seed();
    mockSuggest.mockImplementation(async () => {
      await prisma.message.create({
        data: { conversationId, direction: "inbound", senderName: "Alex", body: "Bir de otopark var mı?", createdAt: new Date(Date.now() - 30_000) },
      });
      return WIFI_REPLY;
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "superseded_by_newer_message" });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
