// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// S9-03 (10-17 gece-4): plan değişikliği önizlemesinin süresi dolunca (sunucu 400) onay paneli KAPANIR — plan düğmeleri yeniden basılabilir,
// "planı yeniden seçin" yapılabilir (önceden panel açık kalıyor, düğmeler kilitli kalıyordu). S9-18: başarılı değişiklikten sonra sayfa
// birkaç kez yenilenir (webhook geç gelirse ekran eski planda kalmasın).
// ---------------------------------------------------------------------------

const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } }; // yönlendirici nesnesi gerçekte olduğu gibi sabit
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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

  // ---------------------------------------------------------------------------
  // ÖDEME P6 (Codex 11-10): plan değişikliği BAŞARILI ama cevabın gövdesi okunamadıysa ekran "planınız değişmedi" yazıyor ve yenilenmiyordu —
  // müşteri tahsil edilmiş yükseltmeyi yeniden deniyordu. Sonuç bilinmiyorsa "değişmedi" denmez.
  // ---------------------------------------------------------------------------
  const preview = () => json(200, { mode: "upgrade", targetName: "Pro", targetMonthlyMinor: 89900, immediateTotal: "₺450,00", recurringTotal: "₺899,00", previewToken: "t1" });
  const brokenBody = (status: number) => Promise.resolve(new Response("<html>bozuk", { status, headers: { "content-type": "text/html" } }));

  it.each([
    ["başarılı (200) ama gövde okunamıyor", 200],
    ["araya giren sunucunun 504 sayfası", 504],
  ])("🚨 P6: %s → 'planınız değişmedi' DENMEZ; 'onay bekleniyor' görünür, panel kapanır, sayfa yenilenir", async (_label, status) => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url === "/api/billing/plan-preview" ? preview() : brokenBody(status))));
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
    expect(screen.queryByText(/planınız değişmedi/u)).toBeNull(); // ⬅️ ESKİDE görünüyordu
    expect(screen.getByText(/onay bekleniyor/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "₺450,00 öde ve yükselt" })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(BILLING_REFRESH_DELAYS_MS.length); // ⬅️ ESKİDE 0
  });

  it("KONTROL (P6): okunamayan 4xx (istek uygulamaya ulaşmadan reddedildi) → 'değişmedi' metni kalır, sayfa yenilenmez", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url === "/api/billing/plan-preview" ? preview() : brokenBody(403))));
    renderPlans();
    fireEvent.click(screen.getByRole("button", { name: "Yükselt" }));
    fireEvent.click(await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" }));
    await screen.findByText(/planınız değişmedi/u);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("P6: bağlantı hatası (cevap yolda kayboldu) → bağlantı metni + sayfa yine yenilenir (değişiklik uygulandıysa görünsün)", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url === "/api/billing/plan-preview" ? preview() : Promise.reject(new TypeError("Failed to fetch")))));
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
    expect(screen.getByText(/Bağlantı kurulamadı/u)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(BILLING_REFRESH_DELAYS_MS.length); // ⬅️ ESKİDE 0
  });

  // Codex 11-10 "plan onayında klavye odağı": onay paneli kartların ÜSTÜNDE açılır; odak panele geçmeli, kapanınca düğmeye dönmeli.
  it("🚨 onay paneli açılınca odak panele geçer; 'Vazgeç' ile kapanınca paneli açan düğmeye döner", async () => {
    vi.stubGlobal("fetch", vi.fn(() => preview()));
    renderPlans();
    const upgrade = screen.getByRole("button", { name: "Yükselt" });
    upgrade.focus();
    fireEvent.click(upgrade);
    const confirm = await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" });
    const panel = screen.getByRole("group");
    expect(panel.contains(confirm)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(panel)); // ⬅️ ESKİDE odak (artık kilitli) plan düğmesinde / gövdede kalıyordu
    expect(panel.getAttribute("aria-labelledby")).toBe("plan-change-summary");
    expect(document.getElementById("plan-change-summary")?.textContent).toMatch(/yükseltiyorsunuz/u);
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yükselt" })));
  });

  it("'tutar değişti' ile panel yeniden kurulunca da (odak panelin içindeyken) kapanışta odak ilk açan düğmeye döner", async () => {
    let previews = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/billing/plan-preview") {
        previews += 1;
        return json(200, { mode: "upgrade", targetName: "Pro", targetMonthlyMinor: 89900, immediateTotal: previews === 1 ? "₺450,00" : "₺460,00", recurringTotal: "₺899,00", previewToken: `t${previews}` });
      }
      return json(409, { error: "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın.", amountChanged: true, immediateTotal: "₺460,00" });
    }));
    renderPlans();
    const upgrade = screen.getByRole("button", { name: "Yükselt" });
    upgrade.focus();
    fireEvent.click(upgrade);
    const confirm = await screen.findByRole("button", { name: "₺450,00 öde ve yükselt" });
    confirm.focus(); // klavye kullanıcısı onay düğmesinde
    fireEvent.click(confirm);
    await screen.findByRole("button", { name: "₺460,00 öde ve yükselt" }); // yeni tutarla panel yeniden kuruldu
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yükselt" })));
  });
});
