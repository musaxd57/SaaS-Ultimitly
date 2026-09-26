import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// EYLEM BEYANI — kanal oto-yanıtı uçtan uca (MÇ §4; model MOCK, DB gerçek). Cevap modeli beyan ettiyse (bayrak açık;
// `suggestReply` mock olduğundan beyan doğrudan sonuçta verilir) kapı makbuzsuz eylemi tutar: taslak ev sahibine kalır,
// karar kaydı kendi gerekçesini (`action_claim` / `action_claim_undeclared`) ve PII'siz kanıtı (`g.ma`) taşır. İnsan
// talebinde tutulan devir cevabı SESSİZ kalmaz: yükseltme yolu ev sahibine acil bildirir.
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
  await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "owner@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
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

async function decision(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { g?: { ma?: string[] } };
  return { finalDecision: ev.finalDecision, reason: ev.reason, ma: evidence.g?.ma };
}

describe("applyChannelAutoReply — eylem beyanı", () => {
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

  it("KONTROL: beyan istenmedi (bugünkü üretim) → cevap gider", async () => {
    mockSuggest.mockResolvedValue(REPLY);
    const id = await seed();
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect((await decision(id)).ma).toBeUndefined();
  });

  it("boş beyan → gider; kanıtta boş liste (beyan istendi, eylem yok)", async () => {
    mockSuggest.mockResolvedValue({ ...REPLY, claimedActions: { status: "declared", actions: [] } });
    const id = await seed();
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(await decision(id)).toMatchObject({ finalDecision: "auto_sent", ma: [] });
  });

  it("🚨 eylem beyanı → GİTMEZ; ev sahibine kalır, gerekçe action_claim, kanıtta kod", async () => {
    mockSuggest.mockResolvedValue({ ...REPLY, claimedActions: { status: "declared", actions: ["notified_team"] } });
    const id = await seed();
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await decision(id)).toEqual({ finalDecision: "human_review", reason: "action_claim", ma: ["notified_team"] });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv.skippedReason).toBe("low_confidence_or_risky");
  });

  it("🚨 istenip gelmeyen beyan → GİTMEZ, gerekçe action_claim_undeclared", async () => {
    mockSuggest.mockResolvedValue({ ...REPLY, claimedActions: { status: "unknown" } });
    const id = await seed();
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(await decision(id)).toEqual({ finalDecision: "human_review", reason: "action_claim_undeclared", ma: ["unknown"] });
  });

  it("🚨 insan talebinde eylem beyanlı devir cevabı tutulur AMA sessiz kalmaz → Sorunlu + acil + ev sahibine e-posta", async () => {
    mockSuggest.mockResolvedValue({
      ...REPLY,
      intent: "human_request",
      riskType: "human_request",
      reply: "Mesajınız kaydedildi; ev sahibiniz görebilir.",
      usedSources: [],
      claimedActions: { status: "declared", actions: ["forwarded_to_host"] },
    });
    const id = await seed("Gerçek bir kişiyle görüşmek istiyorum lütfen.");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv.status).toBe("problem");
    expect(conv.priority).toBe("urgent");
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1);
    // KONTROL: aynı devir cevabı beyansız (boş liste) → misafire gider.
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-2" } as never);
    mockSuggest.mockResolvedValue({
      ...REPLY,
      intent: "human_request",
      riskType: "human_request",
      reply: "Mesajınız kaydedildi; ev sahibiniz görebilir.",
      usedSources: [],
      claimedActions: { status: "declared", actions: [] },
    });
    const id2 = await seed("Gerçek bir kişiyle görüşmek istiyorum lütfen.");
    expect((await applyChannelAutoReply(id2)).sent).toBe(true);
  });
});
