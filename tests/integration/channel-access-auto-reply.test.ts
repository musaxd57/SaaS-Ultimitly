import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// V0.8 — OTOMATİK CEVAP bağlantı kapısını KANAL KATMANINDAN okur (davranışsal kanıt).
//
// Oto-yanıt, modele para harcamadan ÖNCE org'un mesajlaşma bağlantısını yoklar: bağlı değilse `not_connected` ile durur,
// model çağrılmaz (bağlantı kopukken her 2 dakikada kota yakmamak için). V0.8'den önce bu yoklama sağlayıcının kimlik
// modülünü doğrudan çağırıyordu. Bu dosya `@/lib/hospitable-credentials`'ı MOCK'LAMAZ: kayıtlı çözücünün üstüne sahte
// erişim konur — çekirdek sınırı atlasaydı sahte erişim hiç sorulmaz, "bağlı" senaryosu gerçek modülden null alıp
// `not_connected` döner → test kırmızı. Model ve gönderim katmanı sahte; DB gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { __setMessagingAccessForTest, type MessagingAccess } from "@/lib/channels";
import { runDueChannelAutoReplies } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

function fakeAccess(token: string | null) {
  return {
    provider: "hospitable" as const,
    credentialFor: vi.fn(async () => token),
    onCredentialRejected: vi.fn(async () => "noop" as const),
    isConnected: vi.fn(async () => token !== null),
  } satisfies MessagingAccess<"hospitable">;
}

const verdict = {
  intent: "general",
  confidence: 0.2, // kapı geçmez → gönderim yok; bu dosyanın sorusu yalnız "modele gidildi mi"
  reply: "Merhaba!",
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
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const when = new Date(Date.now() - 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "G",
      externalReservationId: "res-access-auto-1",
      status: "new",
      lastMessageAt: when,
      messages: { create: [{ direction: "inbound", senderName: "G", body: "Otopark var mı?", createdAt: when }] },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("oto-yanıt bağlantı kapısı × kanal erişimi", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSend.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setMessagingAccessForTest("hospitable", null);
  });

  it("🚨 erişim 'bağlı değil' → not_connected, model ÇAĞRILMAZ, gönderim yok", async () => {
    const access = fakeAccess(null);
    __setMessagingAccessForTest("hospitable", access);
    const { orgId, conversationId } = await seed();
    await runDueChannelAutoReplies(orgId);
    expect(access.credentialFor).toHaveBeenCalledWith(orgId);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).toBe("not_connected");
  });

  it("🚨 erişim kimlik bilgisi verirse bağlantı kapısı geçilir: model çağrılır, sebep not_connected DEĞİL", async () => {
    const access = fakeAccess("tok-channel-layer");
    __setMessagingAccessForTest("hospitable", access);
    mockSuggest.mockResolvedValue(verdict as never);
    const { orgId, conversationId } = await seed();
    await runDueChannelAutoReplies(orgId);
    expect(access.credentialFor).toHaveBeenCalledWith(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).not.toBe("not_connected");
  });
});
