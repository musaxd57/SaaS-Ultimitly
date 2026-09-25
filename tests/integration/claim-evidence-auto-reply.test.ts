import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Kanal oto-yanıtı karar kaydı — KANIT PARİTESİ + gölge ölçüm (09-23; model MOCK, DB gerçek).
//
// Eskiden kanıt model çağrısından ÖNCE `usedLabels: []` ile kuruluyordu → kanal yolunun
// `RiskEvent.kbEvidenceJson`u "cevap hangi KB etiketine dayandı"yı HİÇ taşımıyordu (QR
// taşıyordu). Artık doğrulanmış etiketler + iddia desteği özeti + token kullanımı yazılır;
// gönderim kararı DEĞİŞMEZ (ölçüm karar değildir).
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
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

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
  usedSources: ["kb:parking"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(guestBody = "Otopark var mı?") {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId: property.id,
      category: "parking",
      title: "Otopark",
      content: "Bina altı otopark misafirler için ücretsizdir.",
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: guestBody, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

describe("applyChannelAutoReply — karar kaydı kanıtı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 doğrulanmış KB etiketi kanıta yazılır (QR paritesi; eskiden kanalda daima boştu)", async () => {
    mockSuggest.mockResolvedValue(REPLY);
    const conversationId = await seed();
    await applyChannelAutoReply(conversationId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { retrieved: { id: string }[]; used: string[] };
    expect(evidence.used).toEqual(["kb:parking"]);
    expect(evidence.retrieved).toHaveLength(1);
  });

  it("iddia desteği + token kullanımı kanıta girer; gönderim kararı DEĞİŞMEZ (desteksiz iddia olsa bile)", async () => {
    mockSuggest.mockResolvedValue({
      ...REPLY,
      claimAudit: { v: 1, n: 2, ctx: 1, op: 0, echo: 0, k: 0, u: 1, uc: ["money"], ec: [] },
      llmUsage: { pt: 12000, ct: 80, cpt: 11000, m: "gpt-5.1" },
    });
    const conversationId = await seed();
    await applyChannelAutoReply(conversationId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(JSON.parse(String(ev.kbEvidenceJson))).toMatchObject({
      used: ["kb:parking"],
      claims: { n: 2, u: 1, uc: ["money"] },
      llm: { pt: 12000, cpt: 11000, m: "gpt-5.1" },
    });
  });

  it("🚨 misafirin dilinde olmayan cevap GİTMEZ (09-25): İngilizce misafire Türkçe cevap → taslak, gerekçe reply_language_mismatch", async () => {
    // Ölçülen vaka (cevap kıyası, gpt-5.1): İngilizce sohbette Türkçe cevap kapıdan geçip otomatik gidiyordu.
    mockSuggest.mockResolvedValue({ ...REPLY, reply: "Bina altı otopark misafirlerimiz için ücretsizdir, dilediğiniz zaman kullanabilirsiniz." });
    const conversationId = await seed("Hi! Is there parking at the building?");
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("reply_language_mismatch");
    // Konuşma ev sahibine kalır (gelen kutusunda "onay bekliyor" görünür; `skippedReason` zinciri BİLEREK aynı kod).
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.skippedReason).toBe("low_confidence_or_risky");
  });

  it("KONTROL: aynı soru, cevap misafirin dilinde → gider", async () => {
    mockSuggest.mockResolvedValue({ ...REPLY, reply: "Yes, parking under the building is free for guests." });
    const conversationId = await seed("Hi! Is there parking at the building?");
    await applyChannelAutoReply(conversationId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("ölçülmediyse (alan yok) kanıtta claims/llm anahtarı YOK", async () => {
    mockSuggest.mockResolvedValue(REPLY);
    const conversationId = await seed();
    await applyChannelAutoReply(conversationId);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as Record<string, unknown>;
    expect(evidence).not.toHaveProperty("claims");
    expect(evidence).not.toHaveProperty("llm");
  });
});
