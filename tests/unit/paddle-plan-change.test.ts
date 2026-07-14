import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import {
  classifyPaddleFailure,
  isExpectedPaddleError,
  getSubscriptionCurrentPriceId,
  previewSubscriptionUpdate,
  updateSubscriptionPlan,
} from "@/lib/payments/paddle";
import { reportError } from "@/lib/report-error";

const mockReport = vi.mocked(reportError);

// Unit-test the plan-change Paddle calls with fetch mocked (no network).
describe("previewSubscriptionUpdate / updateSubscriptionPlan", () => {
  beforeEach(() => mockReport.mockClear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parses the immediate + recurring totals from the preview response", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          currency_code: "TRY",
          immediate_transaction: { details: { totals: { grand_total: "12345", currency_code: "TRY" } } },
          recurring_transaction_details: { totals: { grand_total: "89900", currency_code: "TRY" } },
        },
      }),
    } as Response);

    const preview = await previewSubscriptionUpdate("sub_1", "pri_pro", "prorated_immediately");
    expect(preview?.mode).toBe("prorated_immediately");
    // 12345 minor units = ₺123,45 ; 89900 = ₺899,00 (tr-TR currency formatting).
    expect(preview?.immediateTotal).toContain("123,45");
    expect(preview?.recurringTotal).toContain("899,00");
  });

  it("returns null amounts (never a wrong number) when fields are missing", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);
    const preview = await previewSubscriptionUpdate("sub_1", "pri_pro", "prorated_next_billing_period");
    expect(preview).toEqual({ mode: "prorated_next_billing_period", immediateTotal: null, recurringTotal: null });
  });

  it("preview never throws — returns null on a non-2xx Paddle response", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "entity_not_found" } }),
    } as Response);
    expect(await previewSubscriptionUpdate("sub_1", "pri_pro", "prorated_immediately")).toBeNull();
  });

  it("updateSubscriptionPlan → {ok:true} on 2xx; unconfigured is a definitive no-op", async () => {
    // No API key → not configured → definitive {ok:false}, no fetch (nothing sent).
    vi.stubEnv("PADDLE_API_KEY", "");
    const spy = vi.spyOn(global, "fetch");
    expect(await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately")).toEqual({
      ok: false,
      kind: "definitive",
      reason: "unconfigured",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response);
    expect(await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately")).toEqual({ ok: true });
  });

  it("updateSubscriptionPlan classifies a 4xx as DEFINITIVE (rejected → safe to retry)", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "subscription_locked" } }),
    } as Response);
    const res = await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe("definitive");
      expect(res.reason).toContain("subscription_locked"); // status + code, no ids
    }
  });

  it("updateSubscriptionPlan classifies a 5xx as AMBIGUOUS (may have applied → do NOT blindly retry)", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "internal_error" } }),
    } as Response);
    const res = await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("ambiguous");
  });

  it("updateSubscriptionPlan classifies a network/timeout throw as AMBIGUOUS", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("The operation was aborted due to timeout"));
    const res = await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("ambiguous");
  });

  it("isExpectedPaddleError: declined card / entity-not-found are expected; others are not", () => {
    expect(isExpectedPaddleError(new Error("Paddle HTTP 400 (subscription_payment_declined) env=production resource=subscriptions"))).toBe(true);
    expect(isExpectedPaddleError(new Error("Paddle HTTP 404 (entity_not_found) env=production resource=subscriptions"))).toBe(true);
    expect(isExpectedPaddleError(new Error("Paddle HTTP 404 (not_found) env=production resource=subscriptions"))).toBe(true);
    // Everything else is a real signal.
    expect(isExpectedPaddleError(new Error("Paddle HTTP 400 (subscription_locked) env=production resource=subscriptions"))).toBe(false);
    expect(isExpectedPaddleError(new Error("Paddle HTTP 403 (forbidden) env=production resource=subscriptions"))).toBe(false);
    expect(isExpectedPaddleError(new Error("Paddle HTTP 500 (internal) env=production resource=subscriptions"))).toBe(false);
    expect(isExpectedPaddleError(new Error("fetch failed"))).toBe(false);
  });

  it("plan-change does NOT page on a declined card (expected), but DOES on an unexpected error", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    // Declined card → expected → NOT paged (still returns definitive so the route can respond).
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: "subscription_payment_declined" } }),
    } as Response);
    const declined = await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.kind).toBe("definitive");
    expect(mockReport).not.toHaveBeenCalled();

    // An unexpected failure (e.g. subscription_locked) STILL pages.
    mockReport.mockClear();
    vi.restoreAllMocks();
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: "subscription_locked" } }),
    } as Response);
    await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it("preview does NOT page on entity_not_found (expected for a trialing org)", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: { code: "entity_not_found" } }),
    } as Response);
    expect(await previewSubscriptionUpdate("sub_1", "pri_pro", "prorated_immediately")).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("classifyPaddleFailure: 4xx→definitive (except 408), 5xx/408/network→ambiguous", () => {
    expect(classifyPaddleFailure(new Error("Paddle HTTP 400 (bad_request) env=x resource=subscriptions"))).toBe("definitive");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 404 (entity_not_found) env=x resource=subscriptions"))).toBe("definitive");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 409 (conflict) env=x resource=subscriptions"))).toBe("definitive");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 429 (rate_limit) env=x resource=subscriptions"))).toBe("definitive");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 408 (request_timeout) env=x resource=subscriptions"))).toBe("ambiguous");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 500 (internal) env=x resource=subscriptions"))).toBe("ambiguous");
    expect(classifyPaddleFailure(new Error("Paddle HTTP 503 (unavailable) env=x resource=subscriptions"))).toBe("ambiguous");
    expect(classifyPaddleFailure(new Error("fetch failed"))).toBe("ambiguous");
    expect(classifyPaddleFailure(new Error("The operation was aborted due to timeout"))).toBe("ambiguous");
  });

  it("getSubscriptionCurrentPriceId returns the first item's price id, or null on any failure", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { items: [{ price: { id: "pri_isletme" } }] } }),
    } as Response);
    expect(await getSubscriptionCurrentPriceId("sub_1")).toBe("pri_isletme");
    vi.restoreAllMocks();

    // Unreadable state (error) must be null (= "unknown", never falsely "applied").
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    expect(await getSubscriptionCurrentPriceId("sub_1")).toBeNull();
  });
});
