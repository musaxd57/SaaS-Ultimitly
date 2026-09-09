import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { FILLERS } from "../helpers/kb-retrieval-scenarios";

// ---------------------------------------------------------------------------
// RAG dilim 1 — ÜRETİM OTO-YANIT yolu + `kb-fetch` okuma tavanı (model MOCK, DB gerçek).
//
// 1) `fetchKnowledgeBaseForPrompt`: bayrak KAPALI → en yeni KB_ITEM_CAP (30) +
//    düşen sayısı; bayrak AÇIK → tüm onaylı küme (okuma tavanı 200), onay
//    kapısı AYNI (taslak yine gelmez).
// 2) `applyChannelAutoReply`: bayrak AÇIK → modele seçilmiş küme gider,
//    `auto_reply` karar kaydı retrieval kanıtı + seçilen sayı taşır; bayrak
//    KAPALI → tam küme, kanıt legacy biçimi.
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
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const SAFE_REPLY = {
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

async function seedConversation(guestMessage: string) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: guestMessage, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id };
}

async function seedKb(propertyId: string, n: number, opts: { withParking?: boolean; parkingOldest?: boolean } = {}) {
  const base = Date.now() - 10 * 86_400_000;
  const fill = FILLERS.filter((f) => !["wifi", "checkin"].includes(f.category));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = fill[i % fill.length];
    const row = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: f.category,
        title: `${f.title} ${i}`,
        content: f.content,
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
        updatedAt: new Date(base + (i + 1) * 60_000),
      },
    });
    ids.push(row.id);
  }
  let parkingId: string | null = null;
  if (opts.withParking) {
    const row = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "parking",
        title: "Otopark",
        content: "Bina altı otopark misafirler için ücretsizdir.",
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
        updatedAt: opts.parkingOldest ? new Date(base - 86_400_000) : new Date(base + (n + 5) * 60_000),
      },
    });
    parkingId = row.id;
  }
  return { ids, parkingId };
}

type Input = { knowledgeBase: { id: string; content: string; chunk?: number }[]; knowledgeBaseDropped: number; knowledgeBaseSelection?: string };

describe("kb-fetch okuma tavanı — bayrağa göre", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("KAPALI: en yeni KB_ITEM_CAP kalem gelir, en eski otopark kalemi DÜŞER ve düşen sayılır", async () => {
    const { propertyId } = await seedConversation("Otopark var mı?");
    const { parkingId } = await seedKb(propertyId, 34, { withParking: true, parkingOldest: true });
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(r.items).toHaveLength(KB_ITEM_CAP);
    expect(r.dropped).toBe(35 - KB_ITEM_CAP);
    expect(r.items.map((i) => i.id)).not.toContain(parkingId);
  });

  it("AÇIK: tüm onaylı küme gelir (düşen 0) — taslak yine GELMEZ (onay kapısı bayraktan bağımsız)", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const { propertyId } = await seedConversation("Otopark var mı?");
    const { parkingId } = await seedKb(propertyId, 34, { withParking: true, parkingOldest: true });
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "faq", title: "Taslak", content: "Onaysız taslak metin.", isActive: true, source: "extracted_draft", reviewState: "draft" },
    });
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(r.items).toHaveLength(35);
    expect(r.dropped).toBe(0);
    expect(r.pendingApproval).toBe(1);
    expect(r.items.map((i) => i.id)).toContain(parkingId);
    expect(r.items.some((i) => i.title === "Taslak")).toBe(false);
  });
});

describe("applyChannelAutoReply — hibrit retrieval bayrağı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    mockSuggest.mockResolvedValue(SAFE_REPLY);
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("KAPALI: tam (en yeni 30) küme modele gider; kanıtta retrieval YOK", async () => {
    const { conversationId, propertyId } = await seedConversation("Otopark var mı?");
    await seedKb(propertyId, 15, { withParking: true });
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const input = mockSuggest.mock.calls[0][0] as unknown as Input;
    expect(input.knowledgeBase).toHaveLength(16);
    expect(input.knowledgeBaseSelection).toBe("all");
    expect(input.knowledgeBaseDropped).toBe(0);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev.kbRetrieved).toBe(16);
    expect(String(ev.kbEvidenceJson)).not.toContain("retrieval");
  });

  it("AÇIK: en eski otopark kalemi bile (35 kalemlik KB) seçilir; karar kaydı retrieval kanıtı taşır", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const { conversationId, propertyId } = await seedConversation("Otopark var mı?");
    const { parkingId } = await seedKb(propertyId, 34, { withParking: true, parkingOldest: true });
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const input = mockSuggest.mock.calls[0][0] as unknown as Input;
    expect(input.knowledgeBaseSelection).toBe("retrieved");
    expect(input.knowledgeBase.length).toBeLessThan(35);
    expect(input.knowledgeBase.map((k) => k.id)).toContain(parkingId);
    expect(input.knowledgeBaseDropped).toBe(35 - new Set(input.knowledgeBase.map((k) => k.id)).size);

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev.kbRetrieved).toBe(input.knowledgeBase.length);
    expect(ev.kbDropped).toBe(input.knowledgeBaseDropped);
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { retrieved: { id: string; c?: number }[]; retrieval: { mode: string; fb: string } };
    expect(evidence.retrieval).toMatchObject({ mode: "hybrid", fb: "none" });
    expect(evidence.retrieved.map((r) => r.id)).toContain(parkingId);
  });
});
