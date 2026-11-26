import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

// ---------------------------------------------------------------------------
// BENİMSENEN SATIRIN TESLİM YOLU — yapay zekânın kanala DOĞRUDAN gönderdiği otomatik cevap (G1 11-19 T2-B5; mutasyon turunda yaşayan
// mutant). Sağlayıcının gönderim yanıtı beklenirken senkron aynı sağlayıcı kimliğiyle mesajı ÖNCE içeri alırsa (kanal "otomasyon" der →
// `authorType: "automation"`, `deliveryPath: null`) yerel yazım tekillik ihlaline düşer ve gönderen yol o satırı BENİMSER: yazar yapay zekâ,
// teslim yolu rota çözümünden ("direct" — dış kanal; kanal uzlaştırması Lixus kaydını teslim yolundan tanır). Teslim yolu yalnız BOŞSA yazılır.
// Kurulum `auto-reply-channel.test.ts` (Q2 yarışı) ile aynı; orada teslim yolu sınanmıyordu.
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

const SAFE_REPLY = {
  intent: "checkin",
  confidence: 0.9,
  reply: "Check-in saat 15:00, hoş geldiniz!",
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

/** İşletme (otomatik cevap açık, her saat) + kanal konuşması; son söz misafirde. */
async function seed(opts: { guestMessage?: string; aiSignature?: string } = {}) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      timezone: "Europe/Istanbul",
      ...(opts.aiSignature ? { aiSignature: opts.aiSignature } : {}),
    },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale Daire" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", body: opts.guestMessage ?? "Merhaba, check-in saat kaçta?", createdAt: new Date(Date.now() - 60_000) }],
      },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

/** Gönderim yanıtı dönmeden senkron aynı mesajı (aynı sağlayıcı kimliği) "otomasyon" rolüyle ÖNCE yazar. */
function sendWithSyncFirst(conversationId: string, over: { deliveryPath?: string | null } = {}) {
  mockSend.mockImplementation(async (_c: unknown, body: string) => {
    await prisma.message.create({
      data: {
        conversationId,
        direction: "outbound",
        authorType: "automation",
        senderName: "Ev sahibi",
        body,
        externalId: "pm-ai",
        channelSenderRole: "automation",
        deliveryPath: over.deliveryPath ?? null,
      },
    });
    return { ok: true, providerMessageId: "pm-ai" };
  });
}

describe("otomatik cevap — senkronun önce yazdığı satır benimsenir: yazar yapay zekâ, teslim yolu 'direct' (T2-B5)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSuggest.mockResolvedValue(SAFE_REPLY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 yapay zekâ cevabı: tek satır, yazar 'ai' / 'GuestOps AI', teslim yolu 'direct'; konuşma cevaplı", async () => {
    const { conversationId } = await seed();
    sendWithSyncFirst(conversationId);
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    const rows = await prisma.message.findMany({ where: { conversationId, direction: "outbound" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "pm-ai", authorType: "ai", senderName: "GuestOps AI", channelSenderRole: null, deliveryPath: "direct" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("answered");
  });

  it("🚨 nezaket mesajı (aynı yarış): benimsenen satırın teslim yolu da 'direct', yazar 'ai'", async () => {
    const { orgId, conversationId } = await seed({ aiSignature: "Sevgiler,\nLale" });
    await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
    await prisma.message.create({
      data: { conversationId, direction: "outbound", senderName: "Host", body: "Wi-Fi şifresi Lale2025.", createdAt: new Date(Date.now() - 30_000) },
    });
    await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Alex", body: "Tamam, çok teşekkürler! 🙏", createdAt: new Date() } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(Date.now() - 86_400_000) } });
    sendWithSyncFirst(conversationId);
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "pm-ai" } })).toMatchObject({
      authorType: "ai",
      aiIntent: "closing_courtesy",
      deliveryPath: "direct",
    });
  });

  it("KONTROL: satırın teslim yolu zaten DOLUYSA ezilmez (yalnız boşsa yazılır); yazar yine düzeltilir", async () => {
    const { conversationId } = await seed();
    sendWithSyncFirst(conversationId, { deliveryPath: "queue" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "pm-ai" } })).toMatchObject({ authorType: "ai", deliveryPath: "queue" });
  });
});
