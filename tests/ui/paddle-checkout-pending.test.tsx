// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" — istemci (kurucu onayı 10-10). Ödeme ekranı BAŞARIYLA kapanınca (`checkout.completed`) plan düğmeleri kilitlenir,
// sunucuya kilit sinyali (onay kaydıyla) gider; vazgeçilen ödeme (olay yok) kilitlemez; sunucu kilidi prop'la gelir.
// ---------------------------------------------------------------------------

// Yönlendirici nesnesi gerçekte olduğu gibi SABİT (her çizimde yeni nesne dönerse etkiler boşuna yeniden kurulur).
const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { PaddlePlans, PROCESSING_RECHECK_MS } from "@/components/settings/paddle-plans";
import { CHECKOUT_PENDING_MS } from "@/lib/billing/checkout-pending-shared";
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

const plansEl = (checkoutPending: boolean) => (
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
    />
);
function renderPlans(checkoutPending = false) {
  return render(plansEl(checkoutPending));
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
    vi.useRealTimers();
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

  // ---------------------------------------------------------------------------
  // ÖDEME P7 (Codex 11-10): "Ödemeniz işleniyor" ile AÇILAN sayfa kendiliğinden yeniden bakmıyordu; sayfa açıkken sunucu kilidi SONRADAN
  // gelirse de (ödeme başka sekmede tamamlandı) kartlar açık kalıyordu.
  // ---------------------------------------------------------------------------
  it("🚨 P7: sunucu kilidi SONRADAN gelirse (sayfa yenilendi, prop değişti) düğme kilitlenir ve mesaj görünür; kilit kalkınca açılır", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const view = renderPlans(false);
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = (await screen.findByRole("button", { name: /bu planı seç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    view.rerender(plansEl(true));
    await waitFor(() => expect(btn.disabled).toBe(true)); // ⬅️ ESKİDE açık kalıyordu
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    view.rerender(plansEl(false));
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("🚨 P7: 'işleniyor' ile açılan sayfa aralıklarla kendiliğinden yeniden bakar; kilit kalkınca ve kilit süresi dolunca durur", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
    const view = renderPlans(true);
    expect(router.refresh).toHaveBeenCalledTimes(0);
    await act(async () => void vi.advanceTimersByTime(PROCESSING_RECHECK_MS * 3));
    expect(router.refresh).toHaveBeenCalledTimes(3); // ⬅️ ESKİDE 0 (müşteri sayfayı elle yenilemek zorundaydı)
    view.rerender(plansEl(false)); // sunucu: abonelik yazıldı, kilit kalktı
    await act(async () => void vi.advanceTimersByTime(PROCESSING_RECHECK_MS * 3));
    expect(router.refresh).toHaveBeenCalledTimes(3);

    // Kilit hiç kalkmazsa (webhook gelmedi) sonsuza kadar yenilemez: kilit süresi dolunca durur.
    view.rerender(plansEl(true));
    await act(async () => void vi.advanceTimersByTime(CHECKOUT_PENDING_MS + PROCESSING_RECHECK_MS * 2));
    const after = vi.mocked(router.refresh).mock.calls.length;
    await act(async () => void vi.advanceTimersByTime(PROCESSING_RECHECK_MS * 5));
    expect(vi.mocked(router.refresh).mock.calls.length).toBe(after);
  });

  it("KONTROL (P7): kilitsiz açılan sayfa kendiliğinden yenilenmez", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
    renderPlans(false);
    await act(async () => void vi.advanceTimersByTime(PROCESSING_RECHECK_MS * 4));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
