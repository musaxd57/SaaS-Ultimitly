// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" — istemci (kurucu onayı 10-10). Ödeme ekranı BAŞARIYLA kapanınca (`checkout.completed`) plan düğmeleri kilitlenir,
// sunucuya kilit sinyali (onay kaydıyla) gider; vazgeçilen ödeme (olay yok) kilitlemez; sunucu kilidi prop'la gelir.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PaddlePlans } from "@/components/settings/paddle-plans";
import { CHECKOUT_PENDING_MESSAGE } from "@/lib/billing/checkout-pending-shared";

const plans = [
  {
    code: "pro",
    name: "Pro",
    priceMinor: 89900,
    annualPriceMinor: 899000,
    annualMonthlyEquivalentMinor: 74917,
    currency: "TRY",
    propertyLimit: 7,
    priceId: "pri_pro",
    annualPriceId: "pri_pro_yil",
  },
];

function renderPlans(checkoutPending = false) {
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
      locale="tr-TR"
      currency="TRY"
      checkoutPending={checkoutPending}
    />,
  );
}

describe("PaddlePlans — ödemeniz işleniyor", () => {
  let eventCallback: ((ev: { name?: string }) => void) | undefined;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallback = undefined;
    open = vi.fn();
    (window as unknown as { Paddle: unknown }).Paddle = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn((opts: { eventCallback?: (ev: { name?: string }) => void }) => {
        eventCallback = opts.eventCallback;
      }),
      Checkout: { open },
    };
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { Paddle?: unknown }).Paddle;
    vi.unstubAllGlobals();
  });

  async function payOnce() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/billing/consent"
          ? { ok: true, status: 201, json: async () => ({ ok: true, consentId: "cons_1" }) }
          : { ok: true, status: 200, json: async () => ({ ok: true }) },
      ),
    );
    renderPlans();
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = await screen.findByRole("button", { name: /bu planı seç/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    return btn as HTMLButtonElement;
  }

  it("🚨 başarılı ödeme → düğme kilitlenir, sade mesaj görünür, sunucuya kilit sinyali ONAY KAYDIYLA gider", async () => {
    const btn = await payOnce();
    act(() => eventCallback?.({ name: "checkout.completed" }));
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/billing/checkout-pending");
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ consentId: "cons_1" });
  });

  it("KONTROL: ödeme ekranı kapatıldı / vazgeçildi (başarı olayı yok) → kilit YOK, sinyal YOK", async () => {
    const btn = await payOnce();
    act(() => eventCallback?.({ name: "checkout.closed" }));
    expect(btn.disabled).toBe(false);
    expect(screen.queryByText(CHECKOUT_PENDING_MESSAGE)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/billing/checkout-pending")).toBe(false);
  });

  it("sunucu kilidi (prop) geçerliyken düğme kilitli ve mesaj görünür", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderPlans(true);
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = await screen.findByRole("button", { name: /bu planı seç/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
  });
});
