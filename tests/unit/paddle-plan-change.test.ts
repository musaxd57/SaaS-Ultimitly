import { describe, it, expect, afterEach, vi } from "vitest";
import { previewSubscriptionUpdate, updateSubscriptionPlan } from "@/lib/payments/paddle";

// Unit-test the plan-change Paddle calls with fetch mocked (no network).
describe("previewSubscriptionUpdate / updateSubscriptionPlan", () => {
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

  it("updateSubscriptionPlan → {ok:true} on 2xx, {ok:false, reason} on error, no-op without config", async () => {
    // No API key → not configured → {ok:false}, no fetch.
    vi.stubEnv("PADDLE_API_KEY", "");
    const spy = vi.spyOn(global, "fetch");
    expect(await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately")).toEqual({
      ok: false,
      reason: "unconfigured",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response);
    expect(await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately")).toEqual({ ok: true });
    vi.restoreAllMocks();

    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "subscription_locked" } }),
    } as Response);
    const res = await updateSubscriptionPlan("sub_1", "pri_pro", "prorated_immediately");
    expect(res.ok).toBe(false);
    // reason carries Paddle's status + code (no ids) so the route can show WHY.
    if (!res.ok) expect(res.reason).toContain("subscription_locked");
  });
});
