import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { applyWhatsappAutoReply, applyInboundMessageRules } from "@/lib/automation";

/** Mock the OpenAI chat-completions endpoint with a given JSON reply object. */
function mockOpenAI(reply: Record<string, unknown>) {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
  } as Response);
}

async function makeWaConversation(propertyId: string, body: string, status = "new") {
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "whatsapp",
      guestIdentifier: "+905301112233",
      status,
      priority: "standard",
      lastMessageAt: new Date(),
    },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Guest", body },
  });
  return conversation;
}

describe("applyWhatsappAutoReply", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("auto-sends a safe, high-confidence reply when enabled", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyWhatsapp: true } });
    const conversation = await makeWaConversation(propertyId, "Wi-Fi şifresi nedir?");

    mockOpenAI({
      intent: "wifi",
      confidence: 0.95,
      reply: "Wi-Fi bilgilerini paylaşıyorum.",
      riskLevel: "none",
      priority: "standard",
      detectedLanguage: "tr",
    });

    const sent = await applyWhatsappAutoReply(conversation.id);

    expect(sent).toBe(true);
    const outbound = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: "outbound" },
    });
    expect(outbound?.senderName).toBe("GuestOps AI");
    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(updated?.status).toBe("answered");
  });

  it("does NOT auto-reply when the toggle is off", async () => {
    const { propertyId } = await makeOrgWithProperty(); // default: disabled
    const conversation = await makeWaConversation(propertyId, "Wi-Fi şifresi nedir?");
    mockOpenAI({ intent: "wifi", confidence: 0.95, reply: "...", riskLevel: "none" });

    const sent = await applyWhatsappAutoReply(conversation.id);

    expect(sent).toBe(false);
    expect(
      await prisma.message.count({ where: { conversationId: conversation.id, direction: "outbound" } }),
    ).toBe(0);
  });

  it("does NOT auto-reply to a complaint even when enabled", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyWhatsapp: true } });
    const conversation = await makeWaConversation(propertyId, "Klima çalışmıyor, oda berbat!");

    // Mirror the webhook: rules run first (escalates the complaint), then auto-reply.
    await applyInboundMessageRules(conversation.id, "Klima çalışmıyor, oda berbat!");
    mockOpenAI({ intent: "complaint", confidence: 0.95, reply: "...", riskLevel: "high" });

    const sent = await applyWhatsappAutoReply(conversation.id);

    expect(sent).toBe(false);
    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(updated?.status).toBe("problem");
    expect(
      await prisma.message.count({ where: { conversationId: conversation.id, direction: "outbound" } }),
    ).toBe(0);
  });

  it("does NOT auto-reply when confidence is below the threshold", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyWhatsapp: true } });
    const conversation = await makeWaConversation(propertyId, "Bir sorum olacaktı");

    mockOpenAI({ intent: "general", confidence: 0.4, reply: "...", riskLevel: "none" });

    const sent = await applyWhatsappAutoReply(conversation.id);
    expect(sent).toBe(false);
  });
});
