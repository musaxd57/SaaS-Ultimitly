import { describe, it, expect, afterEach, vi } from "vitest";
import {
  planChangeMode,
  prorationModeFor,
  planChangeEnabled,
  priceIdForPlanCode,
} from "@/lib/billing/plan-change";

describe("plan-change helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("classifies upgrade / downgrade / same by catalog order", () => {
    // Order: free (0) < pro (1) < business (2).
    expect(planChangeMode("free", "pro")).toBe("upgrade");
    expect(planChangeMode("pro", "business")).toBe("upgrade");
    expect(planChangeMode("business", "pro")).toBe("downgrade");
    expect(planChangeMode("pro", "free")).toBe("downgrade");
    expect(planChangeMode("pro", "pro")).toBe("same");
    expect(planChangeMode("pro", "nope")).toBe("unknown");
    // No known current (grandfathered) → treated as buying up.
    expect(planChangeMode("grandfathered", "pro")).toBe("upgrade");
  });

  it("maps upgrade→immediate, downgrade→next-period proration", () => {
    expect(prorationModeFor("upgrade")).toBe("prorated_immediately");
    expect(prorationModeFor("downgrade")).toBe("prorated_next_billing_period");
    expect(prorationModeFor("same")).toBe("prorated_immediately");
  });

  it("planChangeEnabled is OFF unless the flag is 'true' or '1'", () => {
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "");
    expect(planChangeEnabled()).toBe(false);
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "true");
    expect(planChangeEnabled()).toBe(true);
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "1");
    expect(planChangeEnabled()).toBe(true);
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "yes");
    expect(planChangeEnabled()).toBe(false);
  });

  it("resolves the Paddle price id per plan from env (null when unset)", () => {
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    expect(priceIdForPlanCode("pro")).toBe("pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "");
    expect(priceIdForPlanCode("business")).toBeNull();
    expect(priceIdForPlanCode("nope")).toBeNull();
  });
});
