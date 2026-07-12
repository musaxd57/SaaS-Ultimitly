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
const { updateMock, previewMock, getPriceMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  previewMock: vi.fn(),
  getPriceMock: vi.fn(),
}));
vi.mock("@/lib/payments/paddle", () => ({
  isPaddleConfigured: () => true,
  previewSubscriptionUpdate: previewMock,
  updateSubscriptionPlan: updateMock,
  getSubscriptionCurrentPriceId: getPriceMock,
}));

import { POST as PREVIEW } from "@/app/api/billing/plan-preview/route";
import { POST as CHANGE } from "@/app/api/billing/plan-change/route";
import { signPlanChangeToken } from "@/lib/billing/plan-change";

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
  // Mint a valid preview token the way /plan-preview does. Apply requires one that
  // matches the resolved change (org + target price + mode) AND whose amount still
  // matches a fresh apply-time preview (previewMock returns "₺123,45" by default).
  const tok = (
    priceId: string,
    mode: "upgrade" | "downgrade",
    org = orgId,
    amount: string | null = "₺123,45",
  ) => signPlanChangeToken({ org, priceId, mode, amount });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    updateMock.mockReset().mockResolvedValue({ ok: true });
    previewMock.mockReset().mockResolvedValue({
      mode: "prorated_immediately",
      immediateTotal: "₺123,45",
      recurringTotal: "₺899,00",
    });
    getPriceMock.mockReset().mockResolvedValue(null); // reconcile: nothing by default
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
    const body = await res.json();
    expect(body.mode).toBe("upgrade");
    expect(typeof body.previewToken).toBe("string");
    expect(body.previewToken.length).toBeGreaterThan(0);
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately");
  });

  it("round-trip: the token minted by preview authorizes the apply", async () => {
    const previewBody = await (await PREVIEW(req({ planCode: "business" }), ctx)).json();
    const res = await CHANGE(req({ planCode: "business", previewToken: previewBody.previewToken }), ctx);
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately");
  });

  it("preview: pro→free is a downgrade (next billing period)", async () => {
    const res = await PREVIEW(req({ planCode: "free" }), ctx);
    expect((await res.json()).mode).toBe("downgrade");
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_baslangic", "prorated_next_billing_period");
  });

  it("change: applies an upgrade with immediate proration", async () => {
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately");
  });

  it("change: 502 + Paddle reason on a DEFINITIVE (4xx) rejection", async () => {
    updateMock.mockResolvedValue({ ok: false, kind: "definitive", reason: "Paddle HTTP 400 (subscription_locked) env=production resource=subscriptions" });
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toContain("subscription_locked");
  });

  it("change: 400 when no preview token is supplied (no blind apply)", async () => {
    const res = await CHANGE(req({ planCode: "business" }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is for a different price (no reuse across plans)", async () => {
    // A token minted for a downgrade to free can't authorize the business upgrade.
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_baslangic", "downgrade") }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is for a different org (no cross-tenant reuse)", async () => {
    const res = await CHANGE(
      req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade", "someone-else") }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is tampered/forged (bad HMAC)", async () => {
    const valid = tok("pri_isletme", "upgrade");
    const forged = `${valid.split(".")[0]}.deadbeef`;
    const res = await CHANGE(req({ planCode: "business", previewToken: forged }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: a valid token is SINGLE-USE — the second apply is rejected, only one Paddle mutation", async () => {
    const t = tok("pri_isletme", "upgrade");
    const first = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(200);
    // Same token, still inside its 10-min TTL: a replay (double-submit / stolen
    // token) must NOT drive a second PATCH/charge.
    const second = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(second.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("change: a DEFINITIVE (4xx) failure RELEASES the nonce so the same token can be retried", async () => {
    const t = tok("pri_isletme", "upgrade");
    updateMock.mockResolvedValueOnce({ ok: false, kind: "definitive", reason: "Paddle HTTP 400 (bad_request) env=production resource=subscriptions" });
    expect((await CHANGE(req({ planCode: "business", previewToken: t }), ctx)).status).toBe(502);
    // Paddle rejected → nothing mutated → the token isn't burned → retry proceeds.
    const retry = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it("change: an AMBIGUOUS failure keeps the nonce consumed; reconcile sees target price → success, NO second PATCH", async () => {
    const t = tok("pri_isletme", "upgrade");
    // The PATCH reached Paddle and applied, but the response was lost (timeout).
    updateMock.mockResolvedValueOnce({ ok: false, kind: "ambiguous", reason: "The operation timed out" });
    getPriceMock.mockResolvedValueOnce(null); // pre-PATCH check: not yet on target
    getPriceMock.mockResolvedValue("pri_isletme"); // reconcile GET: subscription IS on the target
    const first = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(200);
    expect((await first.json()).reconciled).toBe(true);
    // Same token again: nonce already consumed → 409, and NO second Paddle mutation.
    const retry = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("change: an AMBIGUOUS failure NOT reconciled to target → 202 pending, nonce stays consumed, NO second PATCH", async () => {
    const t = tok("pri_isletme", "upgrade");
    updateMock.mockResolvedValueOnce({ ok: false, kind: "ambiguous", reason: "fetch failed" });
    getPriceMock.mockResolvedValue("pri_pro"); // still the old price / unknown
    const first = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(202);
    expect((await first.json()).pending).toBe(true);
    // We must NOT blindly re-send (could double-apply) → the same token is still spent.
    const retry = await CHANGE(req({ planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("change: 409 when the apply-time amount differs from the previewed amount (no blind charge)", async () => {
    // The customer confirmed "₺123,45"; by apply time Paddle now computes a
    // different immediate charge → refuse and make them re-confirm.
    previewMock.mockResolvedValue({ mode: "prorated_immediately", immediateTotal: "₺200,00", recurringTotal: "₺899,00" });
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade", orgId, "₺123,45") }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).amountChanged).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 409 when the currency differs at apply time (formatted string changes)", async () => {
    previewMock.mockResolvedValue({ mode: "prorated_immediately", immediateTotal: "$123.45", recurringTotal: "$899.00" });
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade", orgId, "₺123,45") }), ctx);
    expect(res.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 409 for an upgrade when the apply-time preview can't return an amount (fail-closed)", async () => {
    previewMock.mockResolvedValue(null); // Paddle preview failed at apply time
    const res = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
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
  it("CONCURRENT applies with two DIFFERENT valid tokens: only ONE reaches Paddle", async () => {
    // First PATCH hangs in-flight; the second apply must be refused by the ATOMIC
    // pending claim (the old upsert let both through → double PATCH/charge).
    let releaseFirst!: (v: { ok: boolean }) => void;
    let entered!: () => void;
    const enteredFirstPatch = new Promise<void>((r) => (entered = r));
    updateMock.mockImplementationOnce(() => {
      entered(); // deterministic barrier: resolves the moment the PATCH is entered
      return new Promise((res) => (releaseFirst = res));
    });
    const p1 = CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    await enteredFirstPatch; // first request is INSIDE the PATCH, holding the claim
    const second = await CHANGE(req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(second.status).toBe(409);
    expect((await second.json()).pendingVerification).toBe(true);
    releaseFirst({ ok: true });
    expect((await p1).status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

});
