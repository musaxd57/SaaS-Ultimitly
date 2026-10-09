// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK OTOMATİK CEVABI (kurucu onayı 10-09: "doğrulanınca otomatik gitsin") — uçtan uca, gerçek PostgreSQL.
//
// Zincir: misafir mesajı → kelime ağı "saf müsaitlik" → tarih çözücü → müsaitlik aracı (gerçek takvim kaynağı + rezervasyonlar)
// → istem (`verifiedAvailability`) → kapı muafiyeti (`availability-claims.ts`). Model ve gönderim katmanı sahte.
// Her "gitmez" iddiasının AYNI tohumla "gider" kontrolü var.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { todayKey, addNights } from "@/modules/availability/core";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const TZ = "Europe/Istanbul";
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Gerçek saate göre 20 ve 22 gün sonrası (Türkçe ay adıyla; tarih çözücü yılı en yakın gelecek olarak tamamlar).
const D1 = addNights(todayKey(new Date(), TZ), 20);
const D2 = addNights(D1, 2);
const human = (k: string) => `${Number(k.slice(8, 10))} ${TR_MONTHS[Number(k.slice(5, 7)) - 1]}`;
const ASK = `Merhaba, ${human(D1)} ile ${human(D2)} arası daire müsait mi?`;

const verdict = (reply: string) => ({
  intent: "general",
  confidence: 0.95,
  reply,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "low",
  detectedLanguage: "tr",
  riskType: null as string | null,
  usedSources: [] as string[],
  missingInfo: [] as string[],
  statedCheckoutTime: null,
  stayChange: { asked: "availability", stance: "states_calendar" },
});

async function seed(opts: { message?: string; feedAgeHours?: number; booked?: boolean } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Müsaitlik Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: TZ },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  const source = await prisma.calendarSource.create({
    data: {
      propertyId: property.id,
      label: "Airbnb",
      url: "https://example.com/cal.ics",
      lastStatus: "ok",
      lastSyncedAt: new Date(Date.now() - (opts.feedAgeHours ?? 1) * 3_600_000),
    },
  });
  if (opts.booked) {
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Başka Misafir",
        arrivalDate: new Date(`${D1}T00:00:00Z`),
        departureDate: new Date(`${D2}T00:00:00Z`),
        channel: "manual",
        status: "confirmed",
      },
    });
  }
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      guestIdentifier: "Aday Misafir",
      channel: "airbnb",
      status: "new",
      externalReservationId: "inq-avail-1",
      lastMessageAt: new Date(),
      messages: { create: { direction: "inbound", senderName: "Aday Misafir", body: opts.message ?? ASK } },
    },
  });
  void source;
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id };
}

describe("doğrulanmış müsaitlik otomatik cevabı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 taze takvim + boş geceler + uyumlu cevap → GİDER; model doğrulanmış sonucu istemde aldı", async () => {
    const { conversationId, propertyId } = await seed();
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} tarihleri için daire müsait.`) as never);
    const r = await applyChannelAutoReply(conversationId);
    expect(mockSuggest.mock.calls[0][0]).toMatchObject({
      verifiedAvailability: { query: { from: D1, to: D2 }, result: { status: "ok", scope: { propertyId }, value: { verdict: "available" } } },
    });
    expect(r.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: anahtar KAPALI → aynı cevap TUTULUR (bugünkü davranış), model sonuç almaz", async () => {
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "");
    const { conversationId } = await seed();
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} tarihleri için daire müsait.`) as never);
    const r = await applyChannelAutoReply(conversationId);
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("verifiedAvailability.query");
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("dolu aralık + 'dolu' cevabı → GİDER", async () => {
    const { conversationId } = await seed({ booked: true });
    mockSuggest.mockResolvedValue(verdict("Maalesef bu tarihlerde daire dolu.") as never);
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
  });

  it("🚨 araçla ÇELİŞEN yön (dolu aralığa 'müsait') → TUTULUR", async () => {
    const { conversationId } = await seed({ booked: true });
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} tarihleri için daire müsait.`) as never);
    const r = await applyChannelAutoReply(conversationId);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 bayat takvim (10 saat) → araç sonucu yok, cevap TUTULUR", async () => {
    const { conversationId } = await seed({ feedAgeHours: 10 });
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} tarihleri için daire müsait.`) as never);
    const r = await applyChannelAutoReply(conversationId);
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("verifiedAvailability.query");
    expect(r.sent).toBe(false);
  });

  it("🚨 uzatma isteği (ev sahibinin kararı) → doğrulanmış yola GİRMEZ, TUTULUR", async () => {
    const { conversationId } = await seed({ message: `${human(D1)} ile ${human(D2)} arası bir gece daha kalabilir miyiz?` });
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} tarihleri için daire müsait.`) as never);
    const r = await applyChannelAutoReply(conversationId);
    expect(r.sent).toBe(false);
  });

  it("🚨 cevap yer ayırdığını söylerse TUTULUR", async () => {
    const { conversationId } = await seed();
    mockSuggest.mockResolvedValue(verdict(`${human(D1)} – ${human(D2)} müsait, sizin için ayırdım.`) as never);
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });
});
