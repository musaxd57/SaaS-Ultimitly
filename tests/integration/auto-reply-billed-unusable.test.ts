import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// FATURALANAN AMA KULLANILAMAYAN MODEL CEVABI SINIRLI DENENİR (gece maliyet denetimi 09-28, kodda doğrulandı).
//
// Model cevap verdi ama çıktı kullanılamadı (çıktı tavanı aşıldı / bozuk JSON / boş cevap): `suggestReply` deterministik yedeğe
// düşüyor (`source: "fallback"`) ama `llmUsage` dolu — token FATURALANDI. Oto-yanıt döngüsü bunu "modele ulaşılamadı" sayıp
// DAMGALAMIYOR, günlük bütçeye de SAYMIYORDU → aynı misafir mesajı her 2 dakikalık geçişte yeniden modelleniyordu (günde ~720
// faturalı çağrı / konuşma; kötü niyetli bir misafir tavanı aşan mesajla tetikleyebilir; aday yerlerini de dolduruyor).
// Artık: (1) bu çağrılar günlük bütçeye sayılır, (2) aynı mesaj için en çok AI_UNUSABLE_MAX_ATTEMPTS kez denenir, sonra "model
// emin olamadı" gibi damgalanır (insana kalır; misafir yeni mesaj yazınca yeniden uygun). Modele HİÇ ulaşılamayan kesinti AYNEN
// sınırsız yeniden denenir (kontrol).
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
import { runDueChannelAutoReplies, AI_UNUSABLE_MAX_ATTEMPTS } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

const fallbackVerdict = {
  intent: "general",
  confidence: 0.2,
  reply: "Mesajınız ev sahibine iletildi.",
  risk: null,
  priority: "standard" as const,
  source: "fallback" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};
/** Model cevap verdi, token faturalandı, çıktı kullanılamadı (ör. finish_reason=length). */
const billedUnusable = { ...fallbackVerdict, llmUsage: { pt: 12000, ct: 2000, rt: 1900 } };

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
      externalReservationId: "res-unusable-1",
      status: "new",
      lastMessageAt: when,
      messages: { create: [{ direction: "inbound", senderName: "G", body: "Uzun bir soru…", createdAt: when }] },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id, when };
}

const budgetCount = async (orgId: string) =>
  (await prisma.rateLimitCounter.findUnique({ where: { key: `ai-daily:${orgId}` } }))?.count ?? 0;

describe("oto-yanıt — faturalanan ama kullanılamayan model cevabı", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it(`🚨 aynı mesaj en çok ${AI_UNUSABLE_MAX_ATTEMPTS} kez modellenir, sonra damgalanır`, async () => {
    const { orgId, conversationId, when } = await seed();
    mockSuggest.mockResolvedValue(billedUnusable as never);
    for (let pass = 0; pass < AI_UNUSABLE_MAX_ATTEMPTS + 3; pass++) await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(AI_UNUSABLE_MAX_ATTEMPTS);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.autoReplyAttemptedAt?.getTime()).toBe(when.getTime());
    // 🚨 Sebep de değişir: "bağlantı düzelince yeniden denenecek" (ai_unavailable) artık yanlış olurdu (ikinci inceleme 09-28).
    expect(row.skippedReason).toBe("ai_unusable");
  });

  it("KONTROL — sınır dolmadan önce sebep ai_unavailable kalır (yeniden denenecek)", async () => {
    const { orgId, conversationId } = await seed();
    mockSuggest.mockResolvedValue(billedUnusable as never);
    await runDueChannelAutoReplies(orgId);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.skippedReason).toBe("ai_unavailable");
    expect(row.autoReplyAttemptedAt).toBeNull();
  });

  it("🚨 faturalanan her kullanılamaz cevap günlük bütçeye sayılır", async () => {
    const { orgId } = await seed();
    mockSuggest.mockResolvedValue(billedUnusable as never);
    await runDueChannelAutoReplies(orgId);
    expect(await budgetCount(orgId)).toBe(1);
  });

  it("KONTROL — modele HİÇ ulaşılamadı (faturasız yedek): her geçişte yeniden denenir, damgalanmaz, bütçe düşmez", async () => {
    const { orgId, conversationId } = await seed();
    mockSuggest.mockResolvedValue(fallbackVerdict as never);
    for (let pass = 0; pass < AI_UNUSABLE_MAX_ATTEMPTS + 3; pass++) await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(AI_UNUSABLE_MAX_ATTEMPTS + 3);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.autoReplyAttemptedAt).toBeNull();
    expect(await budgetCount(orgId)).toBe(0);
  });

  it("KONTROL — damgadan sonra misafir YENİ mesaj yazarsa konuşma yeniden uygun olur (yeni mesajın KENDİ deneme hakkıyla)", async () => {
    const { orgId, conversationId } = await seed();
    mockSuggest.mockResolvedValue(billedUnusable as never);
    for (let pass = 0; pass < AI_UNUSABLE_MAX_ATTEMPTS + 1; pass++) await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(AI_UNUSABLE_MAX_ATTEMPTS);
    const later = new Date();
    await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "G", body: "Kısa soru?", createdAt: later } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later } });
    for (let pass = 0; pass < AI_UNUSABLE_MAX_ATTEMPTS + 1; pass++) await runDueChannelAutoReplies(orgId);
    // Sayaç MESAJ başına (konuşma başına değil): yeni mesaj da en çok AI_UNUSABLE_MAX_ATTEMPTS kez denenir.
    expect(mockSuggest).toHaveBeenCalledTimes(2 * AI_UNUSABLE_MAX_ATTEMPTS);
  });
});
