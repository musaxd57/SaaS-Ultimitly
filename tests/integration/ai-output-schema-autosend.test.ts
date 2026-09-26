import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// UÇTAN UCA (Codex F01): GERÇEK parser + GERÇEK kapı + GERÇEK oto-yanıt yolu.
// Yalnız DIŞ sınırlar sahte: OpenAI HTTP'si (fetch), kanal göndericisi
// (`sendOnChannel` casus), Hospitable token'ı, alarm e-postası. `@/lib/ai`
// MOCK'LANMAZ — kardeş dosya (`auto-reply-channel.test.ts`) onu mock'ladığı
// için parser'ın kusurunu yapısal olarak göremezdi.
//
// Ölçülen şey: eksik/bozuk güvenlik metadatası taşıyan bir model cevabında
// gerçek gönderici HİÇ çağrılmaz; konuşma insana devredilir.
// ---------------------------------------------------------------------------
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
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));

import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { emailService } from "@/lib/email";

const mockSend = vi.mocked(sendOnChannel);
const mockEmail = vi.mocked(emailService.sendReporting);

function openAiReturns(content: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }),
          { status: 200 },
        ),
    ),
  );
}

async function seed(guestMessage: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0, // start === end → tüm gün açık
      timezone: "Europe/Istanbul",
    },
  });
  await prisma.user.create({
    data: { organizationId: org.id, name: "Owner", email: "owner@test.com", passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "general", title: "Otopark", content: "Bina altında ücretsiz otopark var." },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", body: guestMessage, createdAt: new Date(Date.now() - 60_000) }],
      },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

const VALID = {
  intent: "parking",
  confidence: 0.95,
  reply: "Yes, there is free parking under the building.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["kb:general"],
  missingInfo: [],
  statedCheckoutTime: null,
};

describe("applyChannelAutoReply — bozuk güvenlik metadatası gönderilmez (gerçek parser)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 {confidence:true, riskLevel yok} → gönderici HİÇ çağrılmaz, konuşma insana devredilir", async () => {
    openAiReturns({ intent: "parking", reply: "Yes, there is free parking.", confidence: true });
    const { conversationId } = await seed("Is there free parking at the building?");

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false); // ⬅️ ARIZADA: true, misafire gitti
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.status).toBe("problem"); // riskLevel "high" → insan incelemesi
    expect(mockEmail).toHaveBeenCalledTimes(1); // host haberdar
    // Misafire giden hiçbir outbound satır yok.
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound", externalId: { not: null } } })).toBe(0);
  });

  it("KONTROL: geçerli, tam cevap AYNI yoldan OTO-GİDER (aşırı-uygulama değil)", async () => {
    openAiReturns(VALID);
    const { conversationId } = await seed("Is there free parking at the building?");

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockEmail).not.toHaveBeenCalled();
  });
});
