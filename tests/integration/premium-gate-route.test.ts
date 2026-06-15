import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// welcome-test is a representative premium (automation) route. It must 402 for a
// non-active org once billing is enforced, and stay open while dormant.
import { POST } from "@/app/api/hospitable/welcome-test/route";

describe("premium route gate (free-tier downgrade)", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O" };
  });
  afterEach(() => {
    delete process.env.BILLING_ENFORCED;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("DORMANT: open (not 402) even with a canceled subscription", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle" },
    });
    delete process.env.BILLING_ENFORCED;
    const res = await POST();
    expect(res.status).not.toBe(402);
  });

  it("ENFORCED + canceled subscription → 402 (automation blocked)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle" },
    });
    process.env.BILLING_ENFORCED = "true";
    const res = await POST();
    expect(res.status).toBe(402);
  });

  it("ENFORCED + grandfathered (no sub) → open (founder unaffected)", async () => {
    process.env.BILLING_ENFORCED = "true";
    const res = await POST();
    expect(res.status).not.toBe(402);
  });
});
