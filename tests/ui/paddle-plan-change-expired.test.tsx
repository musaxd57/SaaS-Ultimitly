// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// S9-03 (10-17 gece-4): plan değişikliği önizlemesinin süresi dolunca (sunucu 400) onay paneli KAPANIR — plan düğmeleri yeniden basılabilir,
// "planı yeniden seçin" yapılabilir (önceden panel açık kalıyor, düğmeler kilitli kalıyordu). S9-18: başarılı değişiklikten sonra sayfa
// birkaç kez yenilenir (webhook geç gelirse ekran eski planda kalmasın).
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PaddlePlans } from "@/components/settings/paddle-plans";
import { BILLING_REFRESH_DELAYS_MS } from "@/components/settings/refresh-after-billing";

const plans = [
  { code: "baslangic", name: "Başlangıç", priceMinor: 44900, annualPriceMinor: 449000, annualMonthlyEquivalentMinor: 37417, currency: "TRY", propertyLimit: 2, priceId: "pri_b", annualPriceId: "" },
  { code: "pro", name: "Pro", priceMinor: 89900, annualPriceMinor: 899000, annualMonthlyEquivalentMinor: 74917, currency: "TRY", propertyLimit: 7, priceId: "pri_pro", annualPriceId: "" },
];

function renderPlans() {
  return render(
    <PaddlePlans
      clientToken="ctok"
      environment="sandbox"
      email="o@x.com"
      organizationId="org1"
      currentPlanCode="baslangic"
      currentPlanName="Başlangıç"
      grandfathered={false}
      active
      manageable
      planChangeEnabled
      plans={plans}
      locale="tr-TR"
      currency="TRY"
      subscriptionStatus="active"
    />,
  );
}

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("PaddlePlans — plan değişikliği onayı", () => {
  beforeEach(() => {
    refresh.mockReset();
    (window as unknown as { Paddle: unknown }).Paddle = { Environment: { set: vi.fn() }, Initialize: vi.fn(), Checkout: { open: vi.fn() } };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("🚨 süresi dolmuş önizleme (400) → panel kapanır, 'Yükselt' yeniden basılabilir; ikinci tık TAZE önizleme ister", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/billing/plan-preview") return json(200, { mode: "upgrade", targetName: "Pro", targetMonthlyMinor: 89900, immediateTotal: "₺450,00", recurringTotal: "₺899,00", previewToken: "t1" });
      if (url === "/api/billing/plan-change") return json(400, { error: "Doğrulama hatası", fields: { error: "Tutar onayının süresi doldu. Planı yeniden seçip tutarı tekrar onaylayın." } });
      return json(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPlans();
    fireEvent.click(screen.getByRole("button", { name: "Yükselt" }));
    const confirm = await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" });
    fireEvent.click(confirm);
    await screen.findByText(/süresi doldu/u);
    // Panel kapandı → onay düğmesi yok, plan düğmesi yeniden etkin.
    await waitFor(() => expect(screen.queryByRole("button", { name: "₺450,00 öde ve yükselt" })).toBeNull());
    const upgrade = screen.getByRole("button", { name: "Yükselt" }) as HTMLButtonElement;
    expect(upgrade.disabled).toBe(false);
    fireEvent.click(upgrade);
    await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" });
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/billing/plan-preview")).toHaveLength(2);
  });

  it("KONTROL: başka bir 4xx/5xx (ör. 502) paneli kapatmaz — tutar aynı belirteçle yeniden onaylanabilir", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/billing/plan-preview") return json(200, { mode: "upgrade", targetName: "Pro", targetMonthlyMinor: 89900, immediateTotal: "₺450,00", recurringTotal: "₺899,00", previewToken: "t1" });
      return json(502, { error: "Ödeme sağlayıcısına ulaşılamadı." });
    }));
    renderPlans();
    fireEvent.click(screen.getByRole("button", { name: "Yükselt" }));
    fireEvent.click(await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" }));
    await screen.findByText(/ulaşılamadı/u);
    expect(screen.getByRole("button", { name: "₺450,00 öde ve yükselt" })).toBeTruthy();
  });

  it("🚨 S9-18: başarılı değişiklikten sonra sayfa birden çok kez yenilenir (webhook geç gelirse de ekran güncellenir)", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/billing/plan-preview") return json(200, { mode: "upgrade", targetName: "Pro", targetMonthlyMinor: 89900, immediateTotal: "₺450,00", recurringTotal: "₺899,00", previewToken: "t1" });
      return json(200, { ok: true });
    }));
    renderPlans();
    fireEvent.click(screen.getByRole("button", { name: "Yükselt" }));
    const confirm = await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(refresh).toHaveBeenCalledTimes(BILLING_REFRESH_DELAYS_MS.length);
    expect(BILLING_REFRESH_DELAYS_MS.length).toBeGreaterThan(1);
  });
});
