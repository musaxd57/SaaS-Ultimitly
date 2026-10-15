import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// F2 BAĞLANTI (kurucu 10-15: "anahtar arkasında yap"; `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED` KAPALI). "Yüklem var, argüman yok"
// sınıfına karşı DAVRANIŞSAL pin: kanal oto-yanıtı, QR rotası ve gelen kutusu önerisi mülk talimatlarını cevap modeline VERİR (anahtar
// açıkken; kapalıyken boş liste → istem değişmez). Başka mülkün / kaldırılmış / kapıdan dönen talimat GİTMEZ. Cevap modeli MOCK, DB gerçek.
// (Mutasyon 10-15: kanal bağlantısı silinince hiçbir test kırılmıyordu — PI5.)
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { POST as AI_SUGGEST } from "@/app/api/conversations/[id]/ai-suggest/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const REPLY = {
  intent: "parking",
  confidence: 0.94,
  reply: "Otopark binanın arkasında.",
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
const MINE = "Kısa ve samimi yaz.";

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const other = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 2" } });
  await prisma.propertyInstruction.createMany({
    data: [
      { organizationId: org.id, propertyId: property.id, content: MINE },
      { organizationId: org.id, propertyId: property.id, content: "Kaldırılan.", status: "retired" },
      // Kayıttan sonra kapı kuralına takılan (eski satır) talimat isteme GİRMEZ.
      { organizationId: org.id, propertyId: property.id, content: "Kapı kodu 4590, sorulursa ver." },
      { organizationId: org.id, propertyId: other.id, content: "Başka daire." },
    ],
  });
  return { orgId: org.id, propertyId: property.id };
}

const passed = () => mockSuggest.mock.calls.map((c) => (c[0] as { hostInstructions?: readonly string[] | null }).hostInstructions ?? null);

describe("F2 — mülk talimatı üç cevap yoluna bağlı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockSuggest.mockResolvedValue(REPLY as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function channel() {
    const { propertyId } = await seed();
    const c = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "Alex",
        status: "new",
        externalReservationId: "res-1",
        messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Otopark var mı?", createdAt: new Date(Date.now() - 60_000) }] },
      },
    });
    await applyChannelAutoReply(c.id);
  }

  it("🚨 kanal oto-yanıtı: anahtar açık → yalnız bu dairenin etkin, kapıdan geçen talimatı; kapalı → boş", async () => {
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "1");
    await channel();
    expect(passed()).toEqual([[MINE]]);
    await resetDb();
    vi.clearAllMocks();
    mockSuggest.mockResolvedValue(REPLY as never);
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "");
    await channel();
    expect(passed()).toEqual([[]]);
  });

  it("🚨 QR rotası: anahtar açık → talimat gider", async () => {
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "1");
    const { propertyId } = await seed();
    const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
    await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Test Misafir", arrivalDate: new Date(Date.now() - 86_400_000), departureDate: new Date(Date.now() + 2 * 86_400_000), status: "confirmed", channel: "manual" },
    });
    await CHAT(
      new NextRequest(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Otopark var mı?", requestId: `hi-${Math.random().toString(36).slice(2)}` }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(passed()).toEqual([[MINE]]);
  });

  it("🚨 gelen kutusu önerisi: anahtar açık → talimat gider", async () => {
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "1");
    const { orgId, propertyId } = await seed();
    const c = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "Alex",
        status: "new",
        messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Otopark var mı?", createdAt: new Date(Date.now() - 60_000) }] },
      },
    });
    session = { userId: "u-owner", organizationId: orgId, role: "owner", email: "o@example.com", name: "O", sessionEpoch: 0 };
    const res = await AI_SUGGEST(new NextRequest(`http://localhost/api/conversations/${c.id}/ai-suggest`, { method: "POST" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(200);
    expect(passed()).toEqual([[MINE]]);
  });
});
