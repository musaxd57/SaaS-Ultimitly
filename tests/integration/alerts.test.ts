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
  alertEmail?: string | null;
  withOwner?: boolean; // default true — the org's owner user (fallback recipient)
  taskToggle?: boolean; // autoTaskFromMessageEnabled (default false)
}) {
  const when = opts.createdAt ?? new Date();
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: opts.alertEmail ?? null,
      autoTaskFromMessageEnabled: opts.taskToggle ?? false,
    },
  });
  if (opts.withOwner !== false) {
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Owner",
        email: "owner@example.com",
        passwordHash: "x",
        role: "owner",
      },
    });
  }
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
    // Operator env address is set — alerts must NEVER fall back to it for a
    // customer org (that would leak one tenant's complaints to the operator).
    vi.stubEnv("ALERT_EMAIL", "operator@example.com");
    mockSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("alerts the org OWNER (not the operator env address) on a complaint + flags 'problem'", async () => {
    const { orgId, conversationId } = await seedConversation({
      body: "Klima çalışmıyor, oda çok kirli ve berbat!",
    });

    const out = await sendDueAlerts(orgId);

    expect(out.alerted).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to] = mockSend.mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(to).not.toBe("operator@example.com"); // no cross-tenant leak

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.status).toBe("problem");
  });

  it("Codex P1: alerts the OWNER even when an OLDER staff user exists (no PII leak to staff)", async () => {
    const { orgId } = await seedConversation({ body: "Oda berbat, şikayetçiyim!" });
    // A staff account that predates the owner (impersonation/backfill/reorg). The
    // old "oldest user" query would send the guest name + message body HERE.
    await prisma.user.create({
      data: {
        organizationId: orgId,
        name: "Staff",
        email: "staff@example.com",
        passwordHash: "x",
        role: "staff",
        createdAt: new Date("2020-01-01T00:00:00Z"), // older than the owner
      },
    });

    const out = await sendDueAlerts(orgId);

    expect(out.alerted).toBe(1);
    const [to] = mockSend.mock.calls[0];
    expect(to).toBe("owner@example.com"); // role-filtered → the owner
    expect(to).not.toBe("staff@example.com"); // NEVER the older staff account
  });

  it("records ONE RiskEvent per escalation (history wired end-to-end; re-run adds none)", async () => {
    // Codex #32: the keyword escalation must land in the append-only history —
    // decision-level fields only, no fabricated riskLevel on the keyword path.
    const { orgId, conversationId } = await seedConversation({ body: "Klima bozuk, para iadesi istiyorum!" });
    await sendDueAlerts(orgId);
    await sendDueAlerts(orgId); // idempotent pass — no second event

    const events = await prisma.riskEvent.findMany({ where: { organizationId: orgId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "alerts",
      finalDecision: "human_review",
      reason: "keyword_escalated",
      conversationId,
      riskLevel: null, // keyword path has no model verdict — never fabricated
    });
    expect(events[0].riskType).toBeTruthy();
  });

  it("uses the org's own alert address when set (over the owner email)", async () => {
    const { orgId } = await seedConversation({
      body: "Para iadesi istiyorum lütfen.",
      alertEmail: "alarm@musteri.com",
    });
    await sendDueAlerts(orgId);
    expect(mockSend.mock.calls[0][0]).toBe("alarm@musteri.com");
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

  it("does nothing when the org has no alert address and no owner", async () => {
    const { orgId } = await seedConversation({ body: "Klima bozuk, çalışmıyor!", withOwner: false });
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("opens an operational task on a keyword complaint when the toggle is ON", async () => {
    const { orgId } = await seedConversation({ body: "Klima çalışmıyor, oda çok sıcak!", taskToggle: true });
    await sendDueAlerts(orgId);
    const task = await prisma.task.findFirst();
    expect(task?.type).toBe("maintenance");
    expect(task?.status).toBe("todo");
    expect(task?.dueAt).toBeTruthy();
    expect(task?.dedupeKey).toContain(":maintenance:");
  });

  it("does NOT open a task when the toggle is OFF (default — behavior unchanged)", async () => {
    const { orgId } = await seedConversation({ body: "Klima çalışmıyor, oda çok sıcak!" });
    const out = await sendDueAlerts(orgId);
    expect(out.alerted).toBe(1); // still escalates + emails
    expect(await prisma.task.count()).toBe(0); // but creates no task
  });

  it("does NOT open a physical task for a pure refund escalation (toggle ON)", async () => {
    const { orgId } = await seedConversation({ body: "Para iadesi istiyorum lütfen.", taskToggle: true });
    await sendDueAlerts(orgId);
    expect(await prisma.task.count()).toBe(0);
  });
});
