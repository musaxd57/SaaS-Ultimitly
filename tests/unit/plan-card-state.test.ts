import { describe, it, expect } from "vitest";
import { isLockedCurrentPlan } from "@/components/settings/paddle-plans";

// Guards the bug class we hit twice: a plan card must NEVER be locked as
// "Mevcut plan" when the user actually needs to pay for it — i.e. during a
// trial (continuing on Pro) or after a lapse (canceled/past_due → re-subscribe).
const plans = ["free", "pro", "business"];

describe("isLockedCurrentPlan — which plan card is the locked 'current' one", () => {
  it("PAID active: only the owned plan is locked, others selectable", () => {
    const locked = plans.filter((planCode) =>
      isLockedCurrentPlan({ active: true, trialing: false, planCode, currentPlanCode: "business" }),
    );
    expect(locked).toEqual(["business"]);
  });

  it("TRIAL (Pro): NO plan is locked — user can pay for any, incl. Pro", () => {
    const locked = plans.filter((planCode) =>
      isLockedCurrentPlan({ active: true, trialing: true, planCode, currentPlanCode: "pro" }),
    );
    expect(locked).toEqual([]);
  });

  it("LAPSED (canceled/past_due): NO plan is locked — user can re-subscribe", () => {
    // active=false is the key: their old plan code is still "pro" but must stay payable.
    const locked = plans.filter((planCode) =>
      isLockedCurrentPlan({ active: false, trialing: false, planCode, currentPlanCode: "pro" }),
    );
    expect(locked).toEqual([]);
  });

  it("GRANDFATHERED: currentPlanCode 'grandfathered' matches nothing → all selectable", () => {
    const locked = plans.filter((planCode) =>
      isLockedCurrentPlan({
        active: true,
        trialing: false,
        planCode,
        currentPlanCode: "grandfathered",
      }),
    );
    expect(locked).toEqual([]);
  });
});
