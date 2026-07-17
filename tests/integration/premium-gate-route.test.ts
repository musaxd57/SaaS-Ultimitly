import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// welcome-test is a representative premium (automation) route. It must 402 for a
// non-active org once billing is enforced, and stay open while dormant. It is now
// withManage-wrapped (owner/manager only — a preview surfaces guest PII), so it
// takes (req, ctx) and 403s a staff session.
import { POST } from "@/app/api/hospitable/welcome-test/route";

const callPost = () =>
  POST(
    new Request("http://t/api/hospitable/welcome-test", { method: "POST" }) as never,
    { params: Promise.resolve({}) } as never,
  );

describe("premium route gate (free-tier downgrade)", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
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
    const res = await callPost();
    expect(res.status).not.toBe(402);
  });

  it("ENFORCED + canceled subscription → 402 (automation blocked)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle" },
    });
    process.env.BILLING_ENFORCED = "true";
    const res = await callPost();
    expect(res.status).toBe(402);
  });

  it("ENFORCED + grandfathered (no sub) → open (founder unaffected)", async () => {
    process.env.BILLING_ENFORCED = "true";
    const res = await callPost();
    expect(res.status).not.toBe(402);
  });

  it("STAFF role → 403 (preview surfaces guest PII; owner/manager only)", async () => {
    session = { userId: "u", organizationId: orgId, role: "staff", email: "s@x.com", name: "S", sessionEpoch: 0 };
    const res = await callPost();
    expect(res.status).toBe(403);
  });
});
