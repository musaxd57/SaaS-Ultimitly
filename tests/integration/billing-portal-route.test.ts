import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// Drive the session (withManage → withAuth reads requireSession from @/lib/api).
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// Stub the Paddle API surface — no network. isPaddleConfigured + createPortalSession
// are the only two the route touches.
let paddleConfigured = true;
let portalLinks: { overview: string; cancel: string | null } | null = {
  overview: "https://portal.paddle.com/overview?token=x",
  cancel: "https://portal.paddle.com/cancel?token=x",
};
vi.mock("@/lib/payments/paddle", () => ({
  isPaddleConfigured: () => paddleConfigured,
  createPortalSession: vi.fn(async () => portalLinks),
}));

import { POST } from "@/app/api/billing/portal/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
function req() {
  return new NextRequest("http://localhost/api/billing/portal", { method: "POST" });
}

describe("POST /api/billing/portal (Paddle customer portal link)", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    paddleConfigured = true;
    portalLinks = { overview: "https://portal.paddle.com/overview?token=x", cancel: null };
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makePaddleSub() {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_123" },
    });
  }

  it("returns the portal url for an owner with a Paddle subscription", async () => {
    await makePaddleSub();
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toContain("portal.paddle.com");
  });

  it("403 for a staff member (billing is owner-only)", async () => {
    await makePaddleSub();
    session = { ...(session as SessionPayload), role: "staff" };
    expect((await POST(req(), ctx)).status).toBe(403);
  });

  it("403 for a MANAGER too — billing is owner-only (withOwner), matching the UI", async () => {
    // The UI hides billing from managers; the API now matches so a manager can't
    // mint a portal (cancel / card) link via a direct call.
    await makePaddleSub();
    session = { ...(session as SessionPayload), role: "manager" };
    expect((await POST(req(), ctx)).status).toBe(403);
  });

  it("401 when unauthenticated", async () => {
    session = null;
    expect((await POST(req(), ctx)).status).toBe(401);
  });

  it("400 when the org has no Paddle subscription", async () => {
    // No subscription row at all.
    expect((await POST(req(), ctx)).status).toBe(400);
    // A non-Paddle (e.g. manual) subscription is also not portal-manageable.
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "manual", providerRef: "x" },
    });
    expect((await POST(req(), ctx)).status).toBe(400);
  });

  it("400 when Paddle is not configured (no API key)", async () => {
    await makePaddleSub();
    paddleConfigured = false;
    expect((await POST(req(), ctx)).status).toBe(400);
  });

  it("500 when Paddle fails to mint a portal session", async () => {
    await makePaddleSub();
    portalLinks = null; // createPortalSession returned null (API error / missing customer)
    expect((await POST(req(), ctx)).status).toBe(500);
  });
});
