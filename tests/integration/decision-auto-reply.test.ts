import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — OTO-YANIT BAĞLANTISI (Faz 1; kurucu 10-02: "cevap vermek talebi çözmek değil … Host panelinde '13:00 erken
// giriş — karar bekliyor' açık kalır. Host'a bir bildirim gider; tekrar tekrar gönderilmez."). Cevap modeli MOCK, DB gerçek.
//  · Konaklama isteği (kapının birleşim kuralı) tutulan turda "karar bekliyor" kartı açar; saat misafirin yazdığı TEK saat.
//  · Ev sahibine TEK "Karar bekliyor" e-postası — aynı mesaj yeniden işlense de ikincisi yok; "Misafir cevabınızı bekliyor" (K10)
//    e-postasının YERİNE gider (ikisi birden asla).
//  · Bayrak kapalıyken kart yok, e-postalar bugünkü gibi (parite).
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

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);

const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};

const BASE = {
  intent: "early_checkin",
  confidence: 0.92,
  reply: "Standart giriş saatimiz 15:00.",
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
  stayChange: { asked: "early_checkin" as const, stance: "none" as const },
};

async function seed(body: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      timezone: "Europe/Istanbul",
      alertEmail: "host@example.com",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const arrival = utcDay(1);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ada Yılmaz",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 3 * DAY),
      status: "confirmed",
      channel: "airbnb",
      sourceReference: "res-1",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ada",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Ada", body, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return { conversationId: conversation.id, orgId: org.id, arrivalKey: arrival.toISOString().slice(0, 10), departure: new Date(arrival.getTime() + 3 * DAY) };
}

const subjects = () => mockMail.mock.calls.map((c) => String(c[1]));

describe("oto-yanıt → karar kartı (Host Karar Motoru)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockMail.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 '13:00'te giriş yapabilir miyiz?' tutulur → 'karar bekliyor' kartı (saat 13:00, varış günü) + TEK 'Karar bekliyor' e-postası; ikinci geçiş ikinci kart / e-posta üretmez", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue(BASE);
    const s = await seed("Yarın saat 13:00'te giriş yapabilir miyiz?");
    await applyChannelAutoReply(s.conversationId);
    expect(mockSend).not.toHaveBeenCalled();
    const rows = await prisma.decisionRequest.findMany({ where: { conversationId: s.conversationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "early_checkin", status: "pending", requestedTime: "13:00", dayKey: s.arrivalKey, lang: "tr" });
    expect(rows[0].notifiedAt).not.toBeNull();
    expect(subjects()).toEqual([expect.stringMatching(/^Karar bekliyor: 13:00 erken giriş — Ada \(Lale\)$/)]);
    // E-posta misafirin mesajını taşımaz; bağlantı konuşmaya gider.
    const html = String(mockMail.mock.calls[0][2]);
    expect(html).not.toContain("giriş yapabilir miyiz");
    expect(html).toContain(`/inbox/${s.conversationId}`);

    // Aynı mesaj yeniden değerlendirilir (ör. temizlik bitince yeniden aday): tek kart, tek e-posta.
    await applyChannelAutoReply(s.conversationId);
    expect(await prisma.decisionRequest.count({ where: { conversationId: s.conversationId } })).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("KONTROL — bayrak KAPALI: kart yok, e-posta bugünkü gibi (bu tutuşta yok)", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const s = await seed("Yarın saat 13:00'te giriş yapabilir miyiz?");
    await applyChannelAutoReply(s.conversationId);
    expect(await prisma.decisionRequest.count()).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("🚨 devir cümlesi tutuldu (K10): bayrak kapalıyken 'Misafir cevabınızı bekliyor'; açıkken onun YERİNE 'Karar bekliyor' — ikisi birden asla", async () => {
    const handoff = { ...BASE, reply: "Standart giriş saatimiz 15:00. Mesajınız kaydedildi; ev sahibiniz görebilir." };
    mockSuggest.mockResolvedValue(handoff);
    const off = await seed("Yarın saat 13:00'te giriş yapabilir miyiz?");
    await applyChannelAutoReply(off.conversationId);
    expect(subjects()).toEqual([expect.stringMatching(/^Misafir cevabınızı bekliyor/)]);

    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(handoff);
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const on = await seed("Yarın saat 13:00'te giriş yapabilir miyiz?");
    await applyChannelAutoReply(on.conversationId);
    expect(subjects()).toEqual([expect.stringMatching(/^Karar bekliyor: 13:00 erken giriş/)]);
  });

  it("geç çıkış isteği → TEK 'geç çıkış' kartı (saatli talep gece uzatması değil — 'uzat' sözcüğü ikinci kart açmaz), saat 13:00 > 11:00, gün = çıkış günü", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue({ ...BASE, intent: "late_checkout", stayChange: { asked: "late_checkout" as const, stance: "none" as const } });
    const s = await seed("Çıkışı saat 13:00'e kadar uzatabilir miyiz?");
    await applyChannelAutoReply(s.conversationId);
    const rows = await prisma.decisionRequest.findMany({ where: { conversationId: s.conversationId } });
    expect(rows.map((r) => r.kind)).toEqual(["late_checkout"]);
    expect(rows[0]).toMatchObject({ requestedTime: "13:00", dayKey: s.departure.toISOString().slice(0, 10) });
  });

  it("KONTROL: gece uzatması ('bir gece daha') → uzatma kartı (saat yok)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue({ ...BASE, intent: "extend_stay", stayChange: { asked: "extend" as const, stance: "none" as const } });
    const s = await seed("Bir gece daha kalabilir miyiz?");
    await applyChannelAutoReply(s.conversationId);
    const rows = await prisma.decisionRequest.findMany({ where: { conversationId: s.conversationId } });
    expect(rows.map((r) => r.kind)).toEqual(["extend_stay"]);
    expect(rows[0].requestedTime).toBeNull();
  });

  it("bilgi sorusu gibi görünen ama saat yazmayan istek: kart açılır, saat BOŞ (ev sahibi seçer — tahmin yok)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue(BASE);
    const s = await seed("Erken giriş yapabilir miyiz?");
    await applyChannelAutoReply(s.conversationId);
    const row = await prisma.decisionRequest.findFirstOrThrow({ where: { conversationId: s.conversationId } });
    expect(row.requestedTime).toBeNull();
    expect(subjects()).toEqual([expect.stringMatching(/^Karar bekliyor: Erken giriş — saat belirtilmedi/)]);
  });

  it("misafirin yazdığı saat standardın YANLIŞ tarafındaysa (erken girişte 16:00 > 15:00 — uçuş saati) kart saati BOŞ: ev sahibi seçer", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue(BASE);
    const s = await seed("Erken giriş mümkün mü? Uçağımız 16:00'da iniyor.");
    await applyChannelAutoReply(s.conversationId);
    const row = await prisma.decisionRequest.findFirstOrThrow({ where: { conversationId: s.conversationId } });
    expect(row.kind).toBe("early_checkin");
    expect(row.requestedTime).toBeNull();
  });

  it("konaklama isteği OLMAYAN mesaj kart açmaz (Wi-Fi sorusu)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Ağ adı Lale.", stayChange: { asked: "none" as const, stance: "none" as const } });
    const s = await seed("Wi-Fi ağı hangisi?");
    await applyChannelAutoReply(s.conversationId);
    expect(await prisma.decisionRequest.count()).toBe(0);
  });
});
