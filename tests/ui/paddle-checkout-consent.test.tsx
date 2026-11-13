// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PaddlePlans } from "@/components/settings/paddle-plans";
import { CHECKOUT_CONSENT_COPY } from "@/lib/billing/consent-copy";
import { checkAllCheckoutConsents } from "../helpers/checkout-consent-ui";

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

function renderPlans(extra: { cardTrialNotice?: string | null; trialDaysLeft?: number | null; annualAvailable?: boolean } = {}) {
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
      trialDaysLeft={extra.trialDaysLeft === undefined ? 12 : extra.trialDaysLeft}
      plans={plans.map((p) => ({ ...p, trialPriceId: "pri_pro_trial" }))}
      locale="tr-TR"
      currency="TRY"
      cardTrialNotice={extra.cardTrialNotice ?? null}
      annualAvailable={extra.annualAvailable ?? false}
    />,
  );
}

// Accept every consent box, wait for the (ready-gated) plan button to enable,
// then click it. Returns the button.
async function acceptAndClickPlan(name: RegExp = /bu planı seç/i) {
  await checkAllCheckoutConsents();
  const btn = await screen.findByRole("button", { name }); // appears once ready
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

    // K3 (kurucu 10-17): ağ hatası sunucu reddinden AYRI söylenir — müşteri bağlantısını kontrol etsin (eskiden ikisi de "kaydedilemedi").
    await waitFor(() => expect(screen.queryByText(/Bağlantı kurulamadı/i)).toBeTruthy());
    expect(screen.queryByText(/kaydedilemedi/i)).toBeNull();
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
    // Kurucu 11-13: üç onay ayrı alan olarak gider (sunucu üçünü de ister).
    const body = JSON.parse(String(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ planCode: "pro", priceId: "pri_pro", preInfoConfirmed: true, contractAccepted: true, immediateStartConsent: true });
  });
});

describe("PaddlePlans — ödeme öncesi onaylar (kurucu 11-13: en yasal şekilde)", () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    open = vi.fn();
    (window as unknown as { Paddle: unknown }).Paddle = { Environment: { set: vi.fn() }, Initialize: vi.fn(), Checkout: { open } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ consentId: "cns_1" }) }));
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { Paddle?: unknown }).Paddle;
    vi.unstubAllGlobals();
  });

  const group = () => screen.getByRole("group", { name: "Ödeme öncesi onaylar" });

  it("üç ayrı kutu, hepsi BOŞ başlar; belgeye bağlantılar ve fiiller doğru (bilgi: onaylıyorum · sözleşme: kabul ediyorum)", async () => {
    renderPlans();
    await screen.findByRole("group", { name: "Ödeme öncesi onaylar" });
    const boxes = within(group()).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    const labels = boxes.map((b) => b.closest("label")!.textContent);
    expect(labels).toEqual([
      "Ön Bilgilendirme Formu’nu okudum ve bu bilgileri aldığımı onaylıyorum.",
      "Mesafeli Satış Sözleşmesi’ni okudum ve kabul ediyorum.",
      CHECKOUT_CONSENT_COPY.immediateStart.text,
    ]);
    expect(within(group()).getByRole("link", { name: "Ön Bilgilendirme Formu" }).getAttribute("href")).toBe("/on-bilgilendirme");
    expect(within(group()).getByRole("link", { name: "Mesafeli Satış Sözleşmesi" }).getAttribute("href")).toBe("/mesafeli-satis");
  });

  it("iki kutu işaretli, üçüncüsü boş → ödeme açılmaz, kayıt gitmez; uyarı o kutunun altında, odak orada (denemedeyse seçenek de söylenir)", async () => {
    renderPlans();
    await screen.findByRole("group", { name: "Ödeme öncesi onaylar" });
    const boxes = within(group()).getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    const btn = (await screen.findByRole("button", { name: /bu planı seç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(`${CHECKOUT_CONSENT_COPY.immediateStart.missing} ${CHECKOUT_CONSENT_COPY.immediateStart.missingTrialHint}`);
    expect(boxes[2]!.closest("label")!.contains(alert)).toBe(true);
    expect(boxes[2]!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(boxes[2]);
  });

  it("denemede olmayan hesapta üçüncü kutunun uyarısı 'ücretsiz deneme' seçeneğini söylemez (yoksa yanlış olurdu)", async () => {
    renderPlans({ trialDaysLeft: null });
    await screen.findByRole("group", { name: "Ödeme öncesi onaylar" });
    const boxes = within(group()).getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    const btn = (await screen.findByRole("button", { name: /bu plana geç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByRole("alert").textContent).toBe(CHECKOUT_CONSENT_COPY.immediateStart.missing);
  });

  it("dönem değişince (aylık ↔ yıllık) bütün kutular boşalır: onay başka fiyat ve süreli sözleşmeye verilmişti", async () => {
    renderPlans({ annualAvailable: true });
    const boxes = await checkAllCheckoutConsents();
    expect(boxes.every((b) => b.checked)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    const after = within(group()).getAllByRole("checkbox") as HTMLInputElement[];
    expect(after.every((b) => !b.checked)).toBe(true);
  });

  it("🚨 kartla deneme yolu: 'hemen başlasın / cayma hakkımı kaybediyorum' kutusu YOK, istekte o alan GİTMEZ (hizmet deneme bitince başlar)", async () => {
    renderPlans({ cardTrialNotice: "Denemenize devam etmek için kartınızı ekleyin." });
    await screen.findByRole("group", { name: "Ödeme öncesi onaylar" });
    expect(within(group()).getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText(CHECKOUT_CONSENT_COPY.immediateStart.text)).toBeNull();
    await acceptAndClickPlan(/kart ekle/i);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ planCode: "pro", priceId: "pri_pro_trial", preInfoConfirmed: true, contractAccepted: true });
  });
});
