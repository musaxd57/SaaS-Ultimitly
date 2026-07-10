// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PaddlePlans } from "@/components/settings/paddle-plans";

const plans = [
  { code: "pro", name: "Pro", priceMinor: 89900, currency: "TRY", propertyLimit: 7, priceId: "pri_pro" },
];

function renderPlans() {
  return render(
    <PaddlePlans
      clientToken="ctok"
      environment="sandbox"
      email="o@x.com"
      organizationId="org1"
      currentPlanCode="free"
      currentPlanName="Ücretsiz"
      grandfathered={false}
      active={false}
      trialDaysLeft={12}
      plans={plans}
    />,
  );
}

// Accept the consent checkbox, wait for the (ready-gated) plan button to enable,
// then click it. Returns the button.
async function acceptAndClickPlan() {
  const checkbox = await screen.findByRole("checkbox");
  fireEvent.click(checkbox);
  const btn = await screen.findByRole("button", { name: /bu planı seç/i }); // appears once ready
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);
  return btn;
}

describe("PaddlePlans checkout consent — FAIL-CLOSED", () => {
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    open = vi.fn();
    // Pre-set window.Paddle so loadPaddle() resolves immediately → component ready.
    (window as unknown as { Paddle: unknown }).Paddle = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn(),
      Checkout: { open },
    };
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { Paddle?: unknown }).Paddle;
    vi.unstubAllGlobals();
  });

  it("does NOT open Paddle checkout when the consent record fails (500)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    renderPlans();
    await acceptAndClickPlan();

    // consent POST was attempted...
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/billing/consent",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // ...but checkout NEVER opened (no payment without a committed record).
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText(/kaydedilemedi/i)).toBeTruthy();
  });

  it("does NOT open checkout on a network error (fetch throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    renderPlans();
    await acceptAndClickPlan();

    await waitFor(() => expect(screen.queryByText(/kaydedilemedi/i)).toBeTruthy());
    expect(open).not.toHaveBeenCalled();
  });

  it("opens checkout ONLY after the consent record succeeds (2xx)", async () => {
    // 201 must carry a consentId — the client passes it into the checkout customData.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ consentId: "cns_1" }) }),
    );
    renderPlans();
    await acceptAndClickPlan();

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    // the record was written BEFORE checkout opened, and its id rides along as the
    // server-trusted nonce in customData.
    expect(fetch).toHaveBeenCalledWith(
      "/api/billing/consent",
      expect.objectContaining({ method: "POST" }),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        customData: expect.objectContaining({ consentId: "cns_1", organizationId: "org1" }),
      }),
    );
    expect(screen.queryByText(/kaydedilemedi/i)).toBeNull();
  });
});
