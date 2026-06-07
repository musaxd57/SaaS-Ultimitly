import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Capture outgoing emails without sending anything.
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn() } }));

import { emailService } from "@/lib/email";
import { sendDueAlerts } from "@/lib/automation";

const mockSend = vi.mocked(emailService.send);

async function seedConversation(opts: {
  body: string;
  status?: string;
  direction?: "inbound" | "outbound";
  createdAt?: Date;
}) {
  const when = opts.createdAt ?? new Date();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "nuve 7" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: opts.status ?? "new",
      lastMessageAt: when,
      messages: {
        create: [
          {
            direction: opts.direction ?? "inbound",
            senderName: "Alex",
            body: opts.body,
            createdAt: when,
          },
        ],
      },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("sendDueAlerts", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("ALERT_EMAIL", "host@example.com");
    mockSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emails the host and flags the conversation as 'problem' on a complaint", async () => {
    const { orgId, conversationId } = await seedConversation({
      body: "Klima çalışmıyor, oda çok kirli ve berbat!",
    });

    const out = await sendDueAlerts(orgId);

    expect(out.alerted).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to] = mockSend.mock.calls[0];
    expect(to).toBe("host@example.com");

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.status).toBe("problem");
  });

  it("does not re-alert once flagged (idempotent)", async () => {
    const { orgId } = await seedConversation({ body: "Daire berbat, su akıyor!" });

    await sendDueAlerts(orgId);
    mockSend.mockClear();
    const again = await sendDueAlerts(orgId);

    expect(again.alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("also alerts on refund requests", async () => {
    const { orgId } = await seedConversation({ body: "Para iadesi istiyorum lütfen." });
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
  });

  it("does NOT alert on a stale complaint resurfaced by a re-sync (weeks-old message)", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedConversation({
      body: "Klima çalışmıyor, oda berbat!",
      createdAt: tenDaysAgo,
    });
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("ignores ordinary questions (no alert)", async () => {
    const { orgId } = await seedConversation({ body: "Wifi şifresi nedir?" });
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when ALERT_EMAIL is not set", async () => {
    vi.stubEnv("ALERT_EMAIL", "");
    const { orgId } = await seedConversation({ body: "Klima bozuk, çalışmıyor!" });
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
