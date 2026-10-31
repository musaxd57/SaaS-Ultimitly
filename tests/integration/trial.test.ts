import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { getEntitlement, newTrialSubscriptionData } from "@/lib/billing/subscription";

// Reverse-trial entitlement. The cardinal safety rule: a live org is NEVER
// blocked while billing is dormant (BILLING_ENFORCED unset). Only when
// enforcement is explicitly on does an EXPIRED trial lose access.
beforeEach(resetDb);
afterEach(() => {
  delete process.env.BILLING_ENFORCED;
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function orgWithSub(sub?: { status: string; trialEndsAt?: Date | null }): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  if (sub) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: "pro",
        provider: "trial",
        status: sub.status,
        trialEndsAt: sub.trialEndsAt ?? null,
      },
    });
  }
  return org.id;
}

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe("reverse-trial entitlement", () => {
  it("a fresh signup trial is active with days remaining", async () => {
    const id = await orgWithSub({ status: "trialing", trialEndsAt: days(14) });
    const ent = await getEntitlement(id);
    expect(ent.active).toBe(true);
    expect(ent.trialing).toBe(true);
    expect(ent.trialExpired).toBe(false);
    expect(ent.trialDaysLeft).toBeGreaterThan(12);
    expect(ent.trialDaysLeft).toBeLessThanOrEqual(14);
  });

  it("newTrialSubscriptionData starts a ~14-day Pro trial", () => {
    const d = newTrialSubscriptionData();
    expect(d.status).toBe("trialing");
    expect(d.planCode).toBe("pro");
    const left = (d.trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(left).toBeGreaterThan(13);
    expect(left).toBeLessThanOrEqual(14);
  });

  it("an EXPIRED trial still has access while billing is DORMANT (never blocks live orgs)", async () => {
    const id = await orgWithSub({ status: "trialing", trialEndsAt: days(-1) });
    delete process.env.BILLING_ENFORCED;
    const ent = await getEntitlement(id);
    expect(ent.trialExpired).toBe(true);
    expect(ent.active).toBe(true); // dormant → unblocked
    expect(ent.trialDaysLeft).toBe(0);
  });

  it("an EXPIRED trial LOSES access once billing is ENFORCED", async () => {
    const id = await orgWithSub({ status: "trialing", trialEndsAt: days(-1) });
    process.env.BILLING_ENFORCED = "true";
    const ent = await getEntitlement(id);
    expect(ent.trialExpired).toBe(true);
    expect(ent.active).toBe(false);
  });

  it("a not-yet-expired trial keeps access even when enforced", async () => {
    const id = await orgWithSub({ status: "trialing", trialEndsAt: days(3) });
    process.env.BILLING_ENFORCED = "true";
    const ent = await getEntitlement(id);
    expect(ent.active).toBe(true);
  });

  it("a paid active subscription is active (not a trial)", async () => {
    const id = await orgWithSub({ status: "active" });
    process.env.BILLING_ENFORCED = "true";
    const ent = await getEntitlement(id);
    expect(ent.active).toBe(true);
    expect(ent.trialing).toBe(false);
    expect(ent.trialDaysLeft).toBeNull();
  });

  it("a canceled subscription is inactive even when not enforced (QR/paid-feature cutoff)", async () => {
    const id = await orgWithSub({ status: "canceled" });
    const ent = await getEntitlement(id);
    expect(ent.active).toBe(false);
  });

  it("an org with NO subscription stays grandfathered + unlimited", async () => {
    const id = await orgWithSub();
    process.env.BILLING_ENFORCED = "true";
    const ent = await getEntitlement(id);
    expect(ent.grandfathered).toBe(true);
    expect(ent.active).toBe(true);
    expect(ent.propertyLimit).toBeNull();
  });
});
