import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Mock the DB so these stay pure unit tests (no test database needed).
vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    property: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getEntitlement, canAddProperty, billingEnforced } from "@/lib/billing/subscription";

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
