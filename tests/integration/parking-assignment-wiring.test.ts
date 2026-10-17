import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// 24 EK — BAĞLANTI (kurucu onayı 10-02 akşam): kanal oto-yanıtı ve QR rotası modele giden bilgi tabanını kapıya verir; bilgi tabanında
// yazılı sabit otopark yeri tahsisini anlatan cevap gider, aynı cevap bilgi tabanı olmadan bugünkü gibi tutulur ("Yüklem var, argüman
// yok" sınıfına karşı davranışsal pin). Cevap modeli MOCK, DB gerçek.
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
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const ASK = "Arabamızı nereye park edebiliriz?";
const PARKING_REPLY = {
  intent: "parking",
  confidence: 0.94,
  reply: "Binanın arkasındaki açık otoparkı kullanabilirsiniz; 2 numaralı yer dairenize ayrılmış durumda.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: ["kb:Otopark"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};
const KB = {
  category: "parking",
  title: "Otopark",
  content: "Binanın arkasındaki açık otopark ücretsizdir; 2 numaralı yer dairenize ayrılmıştır.",
  reviewState: "approved",
  source: "host_manual",
};

async function seedProperty(withKb: boolean) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  if (withKb) await prisma.knowledgeBaseItem.create({ data: { propertyId: property.id, ...KB } });
  return { orgId: org.id, propertyId: property.id };
}

async function seedChannel(withKb: boolean) {
  const { propertyId } = await seedProperty(withKb);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: ASK, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

async function seedQr(withKb: boolean) {
  const { propertyId } = await seedProperty(withKb);
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token } });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - 86_400_000),
      departureDate: new Date(Date.now() + 2 * 86_400_000),
      status: "confirmed",
      channel: "manual",
    },
  });
  return token;
}

let seq = 0;
async function askQr(token: string, message: string) {
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `pk${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string | null; escalated?: boolean };
}

describe("24 EK — kapıya bilgi tabanı bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockSuggest.mockResolvedValue(PARKING_REPLY);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("kanal: bilgi tabanında yazılı tahsis → otopark cevabı GİDER", async () => {
    const id = await seedChannel(true);
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL kanal: bilgi tabanı yoksa aynı cevap bugünkü gibi tutulur (availability_claim)", async () => {
    const id = await seedChannel(false);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect((JSON.parse(String(ev.kbEvidenceJson)) as { sc?: { v?: string } }).sc?.v).toBe("availability_claim");
  });

  it("QR: bilgi tabanında yazılı tahsis → cevap gider; bilgi tabanı yoksa devredilir (availability_claim)", async () => {
    const withKb = await askQr(await seedQr(true), ASK);
    expect(withKb.escalated).toBe(false);
    expect(withKb.reply).toBe(PARKING_REPLY.reply);

    await resetDb();
    const without = await askQr(await seedQr(false), ASK);
    expect(without.escalated).toBe(true);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
    expect(ev.reason).toBe("availability_claim");
  });
});
