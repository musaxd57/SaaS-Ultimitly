import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Deterministic transport — assert recipients/subjects without sending mail.
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn() } }));
import { emailService } from "@/lib/email";
import { sendDueTrialReminders } from "@/lib/billing/trial-reminders";

const mockSend = vi.mocked(emailService.send);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  mockSend.mockResolvedValue(undefined);
  vi.stubEnv("BILLING_ENFORCED", "true"); // reminders only fire when enforced
  vi.stubEnv("TRIAL_EMAILS_ENABLED", "1"); // opt-in flag (ships dormant)
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await prisma.$disconnect();
});

/** Org + owner user + a trialing subscription ending at `trialEndsAt`. */
async function trialOrg(opts: {
  trialEndsAt: Date | null;
  status?: string;
  ownerEmail?: string;
}): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Ayşe Host",
      email: opts.ownerEmail ?? "owner@example.com",
      passwordHash: "x",
      role: "owner",
    },
  });
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planCode: "pro",
      provider: "trial",
      status: opts.status ?? "trialing",
      trialEndsAt: opts.trialEndsAt,
    },
  });
  return org.id;
}

describe("reverse-trial reminder emails", () => {
  it("sends the 'ending soon' email once to the owner, then never again", async () => {
    const now = new Date();
    const orgId = await trialOrg({ trialEndsAt: new Date(now.getTime() + 2 * DAY) });

    const r1 = await sendDueTrialReminders(now);
    expect(r1.ending).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toBe("owner@example.com"); // per-tenant recipient
    expect(mockSend.mock.calls[0][1]).toMatch(/bitiyor/i);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(sub.trialEndingSentAt).not.toBeNull();

    // Idempotent: a second pass sends nothing.
    mockSend.mockClear();
    const r2 = await sendDueTrialReminders(now);
    expect(r2.ending).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends the 'ended' email once after expiry, then never again", async () => {
    const now = new Date();
    const orgId = await trialOrg({ trialEndsAt: new Date(now.getTime() - 1 * DAY) });

    const r1 = await sendDueTrialReminders(now);
    expect(r1.ended).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toMatch(/sona erdi/i);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(sub.trialEndedSentAt).not.toBeNull();

    mockSend.mockClear();
    const r2 = await sendDueTrialReminders(now);
    expect(r2.ended).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("ships dormant: sends NOTHING until TRIAL_EMAILS_ENABLED=1", async () => {
    vi.stubEnv("TRIAL_EMAILS_ENABLED", ""); // opt-in flag off
    const now = new Date();
    await trialOrg({ trialEndsAt: new Date(now.getTime() - 1 * DAY) });
    const r = await sendDueTrialReminders(now);
    expect(r).toEqual({ ending: 0, ended: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends NOTHING when billing is not enforced (expiry has no effect)", async () => {
    vi.stubEnv("BILLING_ENFORCED", ""); // off
    const now = new Date();
    await trialOrg({ trialEndsAt: new Date(now.getTime() - 1 * DAY) });
    const r = await sendDueTrialReminders(now);
    expect(r).toEqual({ ending: 0, ended: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not nudge a trial with plenty of time left", async () => {
    const now = new Date();
    await trialOrg({ trialEndsAt: new Date(now.getTime() + 10 * DAY) });
    const r = await sendDueTrialReminders(now);
    expect(r.ending).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("ignores paid/active subscriptions entirely", async () => {
    const now = new Date();
    await trialOrg({ status: "active", trialEndsAt: new Date(now.getTime() - 1 * DAY) });
    const r = await sendDueTrialReminders(now);
    expect(r).toEqual({ ending: 0, ended: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not blast about a trial that lapsed long ago (grace window)", async () => {
    const now = new Date();
    await trialOrg({ trialEndsAt: new Date(now.getTime() - 40 * DAY) });
    const r = await sendDueTrialReminders(now);
    expect(r.ended).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rolls back the stamp if the email send fails, so it retries", async () => {
    const now = new Date();
    const orgId = await trialOrg({ trialEndsAt: new Date(now.getTime() - 1 * DAY) });
    mockSend.mockRejectedValueOnce(new Error("smtp down"));

    const r1 = await sendDueTrialReminders(now);
    expect(r1.ended).toBe(0); // not counted as sent
    const after = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(after.trialEndedSentAt).toBeNull(); // rolled back → retryable

    // Next pass (transport healthy) succeeds.
    mockSend.mockResolvedValue(undefined);
    const r2 = await sendDueTrialReminders(now);
    expect(r2.ended).toBe(1);
  });
});
