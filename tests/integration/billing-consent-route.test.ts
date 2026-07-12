import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import type { SessionPayload } from "@/lib/auth";

// route-guard's withAuth reads requireSession from @/lib/api (cross-module) — mock
// it so we can drive the session. null = unauthenticated.
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/billing/consent/route";

function postReq(body: unknown, extraHeaders?: Record<string, string>) {
  return new NextRequest("http://localhost/api/billing/consent", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("POST /api/billing/consent (checkout distance-sales evidence)", () => {
  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    userId = user.id;
    session = { userId, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records the acceptance with server-derived version/IP/UA + session org+user", async () => {
    const res = await POST(
      postReq(
        { planCode: "pro", priceId: "pri_123" },
        { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "TestBrowser/1.0" },
      ),
      ctx,
    );
    expect(res.status).toBe(201);
    const rows = await prisma.checkoutConsent.findMany({ where: { organizationId: orgId } });
    expect(rows).toHaveLength(1);
    // The row id is returned as the server-trusted nonce for the checkout customData.
    expect((await res.json()).consentId).toBe(rows[0].id);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      userId,
      planCode: "pro",
      priceId: "pri_123",
      legalVersion: LEGAL_VERSION,
      ip: "5.6.7.8", // rightmost XFF, spoofed leftmost discarded
      userAgent: "TestBrowser/1.0",
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("FORBIDS staff (403, no row) — contract/payment authority is owner/manager only", async () => {
    session = { ...(session as NonNullable<typeof session>), role: "staff" };
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_1" }), ctx);
    expect(res.status).toBe(403);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("rejects unauthenticated requests (401, no row)", async () => {
    session = null;
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(401);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("validates the body (400 on empty planCode, no row)", async () => {
    const res = await POST(postReq({ planCode: "", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(400);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("is IDOR-proof: a body-supplied org/user id is IGNORED — records for the session only", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const res = await POST(
      postReq({ planCode: "pro", priceId: "pri_123", organizationId: otherOrg.id, userId: "hacker" }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: otherOrg.id } })).toBe(0);
    const mine = await prisma.checkoutConsent.findMany({ where: { organizationId: orgId } });
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe(userId); // the session user, not the body's "hacker"
  });

  it("is null-safe when IP/UA headers are absent", async () => {
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.checkoutConsent.findFirst({ where: { organizationId: orgId } });
    expect(row?.ip).toBe("unknown"); // clientIp fallback
    expect(row?.userAgent).toBeNull(); // header absent → null
  });

  it("rejects a planCode that does not match the priceId (fail-closed); a matching pair records normally", async () => {
    // Configure the server price→plan map so the cross-check is active.
    const prev = process.env.PADDLE_PRICE_PRO;
    process.env.PADDLE_PRICE_PRO = "pri_pro_live";
    try {
      // Mismatch: the "business" label against the Pro price → 400, no row.
      const bad = await POST(postReq({ planCode: "business", priceId: "pri_pro_live" }), ctx);
      expect(bad.status).toBe(400);
      expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(0);

      // Matching pair → recorded, and the stored plan is the price-derived "pro".
      const ok = await POST(postReq({ planCode: "pro", priceId: "pri_pro_live" }), ctx);
      expect(ok.status).toBe(201);
      const row = await prisma.checkoutConsent.findFirst({ where: { organizationId: orgId } });
      expect(row?.planCode).toBe("pro");
      expect(row?.priceId).toBe("pri_pro_live");
    } finally {
      if (prev === undefined) delete process.env.PADDLE_PRICE_PRO;
      else process.env.PADDLE_PRICE_PRO = prev;
    }
  });

  it("throttles abusive repeats (429 after the 20/user cap; no extra row)", async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
      expect(ok.status).toBe(201);
    }
    const throttled = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(throttled.status).toBe(429); // best-effort on the client → never blocks purchase
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(20); // 21st not written
  });
});
