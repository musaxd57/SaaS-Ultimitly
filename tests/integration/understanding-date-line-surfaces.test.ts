import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ANLAMA KATMANININ TARİH SATIRI — DÖRT YÜZEYİN BAĞLANTISI ("yüklem var, argüman yok" dersi: saf fonksiyon doğru ama
// çağıran ona girdiyi vermiyorsa özellik yoktur). Anlama fonksiyonu gerçek uygulamaya devreden bir casusla sarılır
// (davranış aynı; katman kapalıyken ağ yok). Bayrak `AI_CONVERSATION_STATE_ENABLED` KAPALIYKEN satır hiçbir yüzeyden
// gitmez; AÇIKKEN kanal / gelen kutusu / Ayarlar testi rezervasyon günlerini, QR yalnız bugün/yarını verir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandGuestMessages: vi.fn((i: Parameters<typeof actual.understandGuestMessages>[0]) => actual.understandGuestMessages(i)) };
});
let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as AI_SUGGEST } from "@/app/api/conversations/[id]/ai-suggest/route";
import { POST as AI_TEST } from "@/app/api/ai/test/route";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const spy = vi.mocked(understandGuestMessages);
const DAY = 86_400_000;

const REPLY = {
  intent: "parking",
  confidence: 0.9,
  reply: "Bina altı otopark ücretsizdir.",
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

/** Yalnız tarih (00:00Z) → takvim günü birebir bu anahtar (tek tarih kuralı). */
function dayUtc(offsetDays: number): { date: Date; key: string } {
  const d = new Date(Date.now() + offsetDays * DAY);
  const key = d.toISOString().slice(0, 10);
  return { date: new Date(`${key}T00:00:00.000Z`), key };
}

async function seedStay() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "h", email: `h${Math.random()}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "h", sessionEpoch: 0 };
  const arrival = dayUtc(3);
  const departure = dayUtc(6);
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Alex", arrivalDate: arrival.date, departureDate: departure.date, status: "confirmed", sourceReference: "res-1", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Otopark var mı?", createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return { conversationId: conversation.id, propertyId, arrival: arrival.key, departure: departure.key };
}

const dateLineOf = (i = 0) => spy.mock.calls[i]?.[0].dateLine;

describe("anlama katmanının tarih satırı — yüzey bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    session = null;
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    mockSuggest.mockResolvedValue(REPLY);
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 bayrak KAPALI: kanal oto-yanıtı katmana satır VERMEZ (girdi bugünküyle birebir)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "");
    const { conversationId } = await seedStay();
    await applyChannelAutoReply(conversationId);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).not.toHaveProperty("dateLine");
  });

  it("🚨 bayrak AÇIK: kanal oto-yanıtı rezervasyonun giriş/çıkış GÜNLERİNİ verir", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const { conversationId, arrival, departure } = await seedStay();
    await applyChannelAutoReply(conversationId);
    expect(dateLineOf()).toContain(`check-in day ${arrival}`);
    expect(dateLineOf()).toContain(`check-out day ${departure}`);
  });

  it("bayrak AÇIK: gelen kutusu 'AI öner' aynı satırı verir", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const { conversationId, arrival } = await seedStay();
    const res = await AI_SUGGEST(
      new NextRequest(`http://localhost/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(res.status).toBe(200);
    expect(dateLineOf()).toContain(`check-in day ${arrival}`);
  });

  it("bayrak AÇIK: Ayarlar testi cevap modeliyle AYNI örnek konaklamayı verir (dün giriş, 3 gün sonra çıkış)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    await seedStay();
    const res = await AI_TEST(
      new NextRequest("http://localhost/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Otopark var mı?" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const sample = mockSuggest.mock.calls[0][0].reservation!;
    const key = (d: Date | string, tz = "Europe/Istanbul") =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
    expect(dateLineOf()).toContain(`check-in day ${key(sample.arrivalDate)}`);
    expect(dateLineOf()).toContain(`check-out day ${key(sample.departureDate)}`);
  });

  it("🚨 bayrak AÇIK: QR yalnız bugün/yarını verir — rezervasyon ayrıntısı bilinçli yok", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const { propertyId } = await seedStay();
    const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
    await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Test Misafir", arrivalDate: new Date(Date.now() - DAY), departureDate: new Date(Date.now() + 2 * DAY), status: "confirmed", channel: "manual", currency: "EUR" },
    });
    const res = await CHAT(
      new NextRequest(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Otopark var mı?", requestId: `g-${Math.random().toString(36).slice(2)}` }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    expect(dateLineOf()).toMatch(/^Today \(property time zone\): \d{4}-\d{2}-\d{2}/);
    expect(dateLineOf()).not.toMatch(/booking/i);
  });
});
