// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { RegisterForm } from "@/components/auth/register-form";
import { PaddlePlans } from "@/components/settings/paddle-plans";
import { REGISTER_CONSENT_REQUIRED } from "@/lib/auth/register-messages";
import { CHECKOUT_CONSENT_COPY } from "@/lib/billing/consent-copy";
import { checkAllCheckoutConsents } from "../helpers/checkout-consent-ui";

// ---------------------------------------------------------------------------
// UX-3 (kurucu 11-13: "düğme hep basılabilir; soluk olması garip — büyük siteler nasıl yapıyorsa öyle"). Eskiden onay kutusu boşken
// "Hesap Oluştur" ve plan düğmeleri soluk / pasifti ve nedenini söylemiyordu (UX denetimi A028 A031 D012 D054). Şimdi: düğme basılır,
// İSTEK GİTMEZ, uyarı kutunun ALTINDA çıkar (ekran okuyucuya `role=alert` + kutuya `aria-describedby`), odak kutuya gider; kutu
// işaretlenince uyarı kalkar ve akış eskisi gibi sürer.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("Kayıt formu — onay kutusu boşken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ verifyEmail: true }), { status: 200 })));
  });

  function fillFields() {
    typeInto(/İşletme adı/, "Lale");
    typeInto(/Adınız/, "Musa");
    typeInto(/E-posta/, "yeni@ornek.com");
    typeInto("Şifre", "sifre12345");
  }

  it("düğme soluk değil; basınca istek GİTMEZ, uyarı kutunun altında çıkar ve odak kutuya gider", async () => {
    render(<RegisterForm />);
    fillFields();
    const button = screen.getByRole("button", { name: /Hesap Oluştur/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(fetch).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(REGISTER_CONSENT_REQUIRED);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(box);
  });

  it("kutu işaretlenince uyarı kalkar; ikinci basış isteği onayla gönderir", async () => {
    render(<RegisterForm />);
    fillFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(REGISTER_CONSENT_REQUIRED)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("/api/auth/register");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ consent: true, email: "yeni@ornek.com" });
  });

  it("kutu tarayıcıya bırakılmaz (`required` yok: uyarı tarayıcının balonu değil bizim metnimiz); metin alanları tarayıcıda zorunlu kalır", () => {
    render(<RegisterForm />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).required).toBe(false);
    for (const label of [/İşletme adı/, /Adınız/, /E-posta/]) expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(true);
  });
});

describe("Abonelik — onay kutusu boşken plan düğmesi", () => {
  const plans = [{ code: "pro", name: "Pro", priceMinor: 89900, annualPriceMinor: 899000, annualMonthlyEquivalentMinor: 74917, currency: "TRY", propertyLimit: 7, priceId: "pri_pro", annualPriceId: "pri_pro_yil" }];
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn();
    (window as unknown as { Paddle: unknown }).Paddle = { Environment: { set: vi.fn() }, Initialize: vi.fn(), Checkout: { open } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ consentId: "cns_1" }), { status: 201 })));
  });
  afterEach(() => {
    delete (window as unknown as { Paddle?: unknown }).Paddle;
  });
  const renderPlans = () =>
    render(
      <PaddlePlans clientToken="ctok" environment="sandbox" email="o@x.com" organizationId="org1" currentPlanCode="free" currentPlanName="Ücretsiz"
        grandfathered={false} active={false} trialDaysLeft={12} plans={plans} locale="tr-TR" currency="TRY" />,
    );

  it("düğme hazır olunca basılabilir (onay beklemez); basınca ödeme AÇILMAZ, onay kaydı GİTMEZ, uyarı kutunun altında, odak kutuda", async () => {
    renderPlans();
    const btn = (await screen.findByRole("button", { name: /bu planı seç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // Kurucu 11-13: üç ayrı kutu — uyarı İLK boş kutunun (Ön Bilgilendirme) altında.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(CHECKOUT_CONSENT_COPY.preInfo.missing);
    const box = screen.getAllByRole("checkbox")[0]!;
    expect(box.closest("label")!.contains(alert)).toBe(true);
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(box);
  });

  it("kutu işaretlenince uyarı kalkar ve ödeme akışı eskisi gibi açılır (önce onay kaydı)", async () => {
    renderPlans();
    const btn = (await screen.findByRole("button", { name: /bu planı seç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(btn);
    });
    await checkAllCheckoutConsents();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe("/api/billing/consent");
  });
});
