import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn() } }));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { sendDueAlerts, applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockEmail = vi.mocked(emailService.send);

/** Org + property + one fresh "new" conversation whose guest spoke last. */
async function seed(opts: { holdingAck?: boolean; guestMessage: string }) {
  const org = await prisma.organization.create({
    data: {
      name: "Holding Org",
      alertEmail: "host@example.com",
      autoHoldingReplyEnabled: opts.holdingAck ?? false,
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0, // start === end → always inside the window
      timezone: "Europe/Istanbul",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Deniz Daire" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      guestIdentifier: "Guest X",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-h1",
      lastMessageAt: new Date(),
      messages: {
        create: { direction: "inbound", senderName: "Guest X", body: opts.guestMessage },
      },
    },
  });
  return { org, property, conversation };
}

async function outboundBodies(conversationId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, direction: "outbound" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.body);
}

describe("tier-2 holding acknowledgement — keyword path (sendDueAlerts)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mild complaint + opt-in → ONE ack in the guest's language, thread stays problem, host still emailed", async () => {
    const { org, conversation } = await seed({
      holdingAck: true,
      guestMessage: "Klima çalışmıyor, içerisi çok sıcak!",
    });
    const r = await sendDueAlerts(org.id);
    expect(r.alerted).toBe(1);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const bodies = await outboundBodies(conversation.id);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("özür dileriz"); // Turkish ack picked by heuristic
    expect(bodies[0]).not.toMatch(/iade|indirim|tazminat/i); // never promises a remedy

    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.status).toBe("problem"); // host still owns the thread
    expect(conv?.skippedReason).toBe("complaint"); // Faz-A: inbox badge source

    // Idempotent: a second pass finds nothing claimable.
    vi.clearAllMocks();
    const r2 = await sendDueAlerts(org.id);
    expect(r2.alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("DEFAULT (opt-in off): complaint gets NO automatic message — only the alert", async () => {
    const { org, conversation } = await seed({
      guestMessage: "Daire çok kirli, hiç memnun kalmadık",
    });
    const r = await sendDueAlerts(org.id);
    expect(r.alerted).toBe(1);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
  });

  it("money / review-threat / safety / human-request signals NEVER get the ack (even opted in)", async () => {
    for (const guestMessage of [
      "Daire kirli, para iadesi istiyorum", // refund
      "Bunu düzeltmezseniz kötü yorum yapacağım, bir yıldız veririm", // review threat
      "Dairede yoğun gaz kokusu var!", // safety-critical
      "Klima bozuk, ev sahibiyle konuşmak istiyorum", // wants a human
    ]) {
      vi.clearAllMocks();
      const { org, conversation } = await seed({ holdingAck: true, guestMessage });
      await sendDueAlerts(org.id);
      expect(mockEmail).toHaveBeenCalledTimes(1); // escalation always happens
      expect(mockSend).not.toHaveBeenCalled(); // ...but no automatic guest message
      expect(await outboundBodies(conversation.id)).toHaveLength(0);
    }
  });

  it("respects the global master switch (AUTO_REPLY_ENABLED unset → no ack)", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    const { org, conversation } = await seed({
      holdingAck: true,
      guestMessage: "Klima çalışmıyor, içerisi çok sıcak!",
    });
    await sendDueAlerts(org.id);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
  });
});

describe("tier-2 holding acknowledgement — model path (applyChannelAutoReply)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const modelComplaint = (riskLevel: "medium" | "high") => ({
    intent: "complaint",
    confidence: 0.9,
    reply: "Taslak cevap",
    risk: "şikayet",
    priority: "urgent" as const,
    source: "openai" as const,
    actionSuggestion: null,
    riskLevel,
    detectedLanguage: "en",
    riskType: "complaint" as string | null,
    usedSources: [] as string[],
    missingInfo: [] as string[],
    statedCheckoutTime: null,
  });

  it("model-detected MILD complaint (keywords missed) → escalate + ack in the model's language", async () => {
    // No complaint keywords ("hiç hoş değil" dışında kalsın): keywords miss, model catches.
    const { conversation } = await seed({
      holdingAck: true,
      guestMessage: "The vibe here is not what we hoped for at all, quite let down.",
    });
    mockSuggest.mockResolvedValue(modelComplaint("medium"));
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(false);
    expect(r.skippedReason).toBe("escalated_to_human");
    const bodies = await outboundBodies(conversation.id);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Apologies for the trouble"); // EN from the model verdict
    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.status).toBe("problem");
    expect(conv?.skippedReason).toBe("escalated_to_human"); // Faz-A badge
    expect(conv?.lastRiskLevel).toBe("medium"); // Faz-A reports aggregation
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it("HIGH-risk model verdict never gets the ack (silent draft + escalation only)", async () => {
    const { conversation } = await seed({
      holdingAck: true,
      guestMessage: "Something feels seriously wrong with this place.",
    });
    mockSuggest.mockResolvedValue(modelComplaint("high"));
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.skippedReason).toBe("escalated_to_human");
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
  });
});

describe("human_request gate refinement (regression for the over-broad veto)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const HUMAN_MSG = "Gerçek bir kişiyle görüşmek istiyorum lütfen";

  it("model ALSO says human_request → the handoff ack sends and the AI pauses (designed flow)", async () => {
    const { conversation } = await seed({ guestMessage: HUMAN_MSG });
    mockSuggest.mockResolvedValue({
      intent: "human_request",
      confidence: 0.9,
      reply: "Talebinizi ev sahibimize ilettim; en kısa sürede kendisi sizinle iletişime geçecektir.",
      risk: "insan talebi",
      priority: "standard" as const,
      source: "openai" as const,
      actionSuggestion: null,
      riskLevel: "low" as const,
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
    });
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.autoReplyHoldUntil).toBeTruthy(); // AI paused for the handoff window
    // Faz-A: a successful auto-send clears the held-back reason and records the verdict.
    expect(conv?.skippedReason).toBeNull();
    expect(conv?.lastRiskLevel).toBe("low");
  });

  it("model says something ELSE for a human-request message → held for a human (no send)", async () => {
    const { conversation } = await seed({ guestMessage: HUMAN_MSG });
    mockSuggest.mockResolvedValue({
      intent: "general",
      confidence: 0.9,
      reply: "Normal bir cevap",
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
    });
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
