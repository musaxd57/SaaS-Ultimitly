import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// Stub the Paddle API layer (no network); capture the args the routes pass so we
// can assert upgrade→immediate / downgrade→next-period.
const { updateMock, previewMock } = vi.hoisted(() => ({ updateMock: vi.fn(), previewMock: vi.fn() }));
vi.mock("@/lib/payments/paddle", () => ({
  isPaddleConfigured: () => true,
  previewSubscriptionUpdate: previewMock,
  updateSubscriptionPlan: updateMock,
}));

import { POST as PREVIEW } from "@/app/api/billing/plan-preview/route";
import { POST as CHANGE } from "@/app/api/billing/plan-change/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("plan change routes (gated, PATCH /subscriptions)", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    updateMock.mockReset().mockResolvedValue({ ok: true });
    previewMock.mockReset().mockResolvedValue({
      mode: "prorated_immediately",
      immediateTotal: "₺123,45",
      recurringTotal: "₺899,00",
    });
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "1");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC", "pri_baslangic");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");

    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_1" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("preview: pro→business is an upgrade (immediate proration)", async () => {
    const res = await PREVIEW(req({ planCode: "business" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("upgrade");
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately");
  });

  it("preview: pro→free is a downgrade (next billing period)", async () => {
    const res = await PREVIEW(req({ planCode: "free" }), ctx);
    expect((await res.json()).mode).toBe("downgrade");
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_baslangic", "prorated_next_billing_period");
  });

  it("change: applies an upgrade with immediate proration", async () => {
    const res = await CHANGE(req({ planCode: "business" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately");
  });

  it("change: 502 + Paddle reason when the update is rejected", async () => {
    updateMock.mockResolvedValue({ ok: false, reason: "Paddle HTTP 400 (subscription_locked) env=production resource=subscriptions" });
    const res = await CHANGE(req({ planCode: "business" }), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toContain("subscription_locked");
  });

  it("404 (dormant) when the feature flag is OFF — nothing reaches Paddle", async () => {
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "");
    expect((await PREVIEW(req({ planCode: "business" }), ctx)).status).toBe(404);
    expect((await CHANGE(req({ planCode: "business" }), ctx)).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400 on the same plan, and on an org without a Paddle subscription", async () => {
    expect((await CHANGE(req({ planCode: "pro" }), ctx)).status).toBe(400); // same plan
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "manual" } });
    expect((await CHANGE(req({ planCode: "business" }), ctx)).status).toBe(400); // not a Paddle sub
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("403 for a staff member (owner/manager only)", async () => {
    session = { ...(session as SessionPayload), role: "staff" };
    expect((await CHANGE(req({ planCode: "business" }), ctx)).status).toBe(403);
  });
});
