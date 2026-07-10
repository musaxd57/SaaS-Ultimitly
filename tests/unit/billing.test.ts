import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Mock the DB so these stay pure unit tests (no test database needed).
vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    property: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getEntitlement, canAddProperty, billingEnforced, premiumAllowed } from "@/lib/billing/subscription";

const findUnique = vi.mocked(prisma.subscription.findUnique);
const count = vi.mocked(prisma.property.count);

describe("billing entitlements (safe-by-default)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("treats an org with NO subscription as grandfathered + active + unlimited", async () => {
    findUnique.mockResolvedValue(null);
    const ent = await getEntitlement("org1");
    expect(ent.grandfathered).toBe(true);
    expect(ent.active).toBe(true);
    expect(ent.propertyLimit).toBeNull();
  });

  // Operator-created customer billing modes (admin/customers route). Each mode
  // ALWAYS writes a Subscription row, so no operator-created org silently relies
  // on the accidental missing-row grandfathered default.
  it("free-internal mode (grandfathered ROW) → active + unlimited, even ENFORCED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o", planCode: "grandfathered", status: "grandfathered",
      provider: "manual", createdAt: new Date(),
    } as never);
    const ent = await getEntitlement("o");
    expect(ent.active).toBe(true);
    expect(ent.propertyLimit).toBeNull();
    expect(ent.grandfathered).toBe(true);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("manual-billing mode (active/provider=manual ROW) → premium allowed, even ENFORCED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o", planCode: "pro", status: "active",
      provider: "manual", createdAt: new Date(),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("reads plan + limit + status from an existing subscription", async () => {
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "pro", status: "active" } as never);
    const ent = await getEntitlement("org1");
    expect(ent.planCode).toBe("pro");
    expect(ent.propertyLimit).toBe(7); // Pro = 3–7
    expect(ent.active).toBe(true);
  });

  it("NEVER blocks adding a property while billing is not enforced (dormant)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    expect(billingEnforced()).toBe(false);
    // Even a canceled sub over any limit is allowed while dormant.
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "free", status: "canceled" } as never);
    count.mockResolvedValue(99);
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(true);
  });

  it("enforces the property limit ONLY when BILLING_ENFORCED=true", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "free", status: "active" } as never);
    count.mockResolvedValue(2); // free limit is 2
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("property_limit");
    expect(res.limit).toBe(2);
  });

  it("keeps grandfathered orgs unlimited even when enforcement is ON", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue(null); // no row → grandfathered
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(true);
    expect(count).not.toHaveBeenCalled();
  });
});

describe("premiumAllowed — paid/AI feature gate (free-tier downgrade)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("DORMANT: always allowed while BILLING_ENFORCED is off — even a canceled sub", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "canceled" } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + active sub → allowed (automation stays on)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "active" } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + grandfathered (no sub) → allowed (founder unaffected)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue(null);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + canceled → BLOCKED (free tier: automation off)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "canceled" } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + expired trial → BLOCKED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "trialing",
      trialEndsAt: new Date(Date.now() - 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + trialing with NO trialEndsAt (malformed) → BLOCKED (fail-closed, no infinite trial)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "trialing",
      trialEndsAt: null, // missing anchor must not grant an unlimited free trial
    } as never);
    const ent = await getEntitlement("o");
    expect(ent.trialExpired).toBe(true);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + PRIMARY_ORG_ID with a canceled sub → still allowed (founder never paywalled)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    findUnique.mockResolvedValue({
      organizationId: "founder-org",
      planCode: "pro",
      status: "canceled", // e.g. a test payment that later lapsed
    } as never);
    // A non-founder org with the same canceled sub IS blocked (proves the guard
    // is org-scoped, not a blanket bypass).
    expect(await premiumAllowed("some-customer")).toBe(false);
    expect(await premiumAllowed("founder-org")).toBe(true);
  });

  it("ENFORCED + past_due WITHIN dunning grace → allowed (one card decline can't cut off a payer)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() - 3 * 86_400_000), // renewal failed 3 days ago
      updatedAt: new Date(),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + past_due PAST the grace window → BLOCKED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000), // 30d > 14d grace
      updatedAt: new Date(Date.now() - 30 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("past_due grace anchors on pastDueSince (stable), NOT the bumping updatedAt", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: null,
      pastDueSince: new Date(Date.now() - 20 * 86_400_000), // went past_due 20d ago (> 14d grace)
      updatedAt: new Date(), // a fresh dunning webhook bumped this — must NOT re-open grace
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("past_due WITHIN grace via pastDueSince (currentPeriodEnd null) → allowed", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: null,
      pastDueSince: new Date(Date.now() - 2 * 86_400_000), // 2d ago, within 14d grace
      updatedAt: new Date(),
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("DORMANT: past_due allowed while BILLING_ENFORCED is off (even long past grace)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() - 100 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });
});
