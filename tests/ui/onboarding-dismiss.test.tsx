// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// next/link needs no router for a plain anchor; isolate the test from its internals.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { OnboardingGuide, type OnboardingStep } from "@/components/onboarding-guide";

const steps: OnboardingStep[] = [
  { done: true, title: "Airbnb / Booking bağlantısını kur", desc: "", href: "/settings", cta: "Bağlantıyı kur" },
  { done: false, title: "AI sesini ve imzanı ayarla", desc: "Tonu seç", href: "/settings", cta: "Ayarla" },
];

// 🚨 SÖZLEŞME DEĞİŞTİ (08-07 (2), kullanıcı bildirdi): × kartı KALICI olarak
// yok ediyordu — uyarı yok, geri dönüş yok. Yanlışlıkla basan host kalan
// kurulum adımlarını bir daha göremiyordu. Artık kapatmak KATLIYOR ve geriye
// tek tıkla açılan bir ŞERİT bırakıyor.
describe("OnboardingGuide katlama (UI)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("katlanınca kart gider ama ŞERİT KALIR (kalıcı kayıp YOK)", async () => {
    render(<OnboardingGuide steps={steps} />);
    expect(screen.getByText(/Başlarken/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Kurulum rehberini küçült"));

    await waitFor(() => expect(screen.queryByText(/Başlarken/)).toBeNull());
    // 🚨 ASIL DEĞİŞMEZ: geriye tıklanabilir bir yol kalmalı.
    const serit = screen.getByRole("button", { name: /Kurulum rehberi/ });
    expect(serit).toBeTruthy();
    expect(serit.textContent).toMatch(/1\/2 tamam/); // ilerleme şeritte de görünür
    expect(localStorage.getItem("lixus_onboarding_dismissed")).toBe("1");
  });

  it("şeride basınca kart GERİ AÇILIR ve bayrak temizlenir", async () => {
    localStorage.setItem("lixus_onboarding_dismissed", "1");
    render(<OnboardingGuide steps={steps} />);
    const serit = await screen.findByRole("button", { name: /Kurulum rehberi/ });

    fireEvent.click(serit);

    await waitFor(() => expect(screen.getByText(/Başlarken/)).toBeTruthy());
    // Bayrak SİLİNİR — yoksa yenilemede yine katlı gelirdi.
    expect(localStorage.getItem("lixus_onboarding_dismissed")).toBeNull();
  });

  it("önceden katlanmışsa mount'ta ŞERİT gelir (sessizlik DEĞİL)", async () => {
    localStorage.setItem("lixus_onboarding_dismissed", "1");
    render(<OnboardingGuide steps={steps} />);
    await waitFor(() => expect(screen.queryByText(/Başlarken/)).toBeNull());
    expect(screen.getByRole("button", { name: /Kurulum rehberi/ })).toBeTruthy();
  });

  it("6/6 tamamken ve YENİ bitmemişse hiç render EDİLMEZ", async () => {
    // Kurulumu çoktan bitmiş host sayfada kart görmemeli. Kapı artık
    // bileşenin içinde (sunucu her zaman mount ediyor).
    localStorage.setItem("lixus_onboarding_seen_count", "2");
    const hepsi = steps.map((s) => ({ ...s, done: true }));
    const { container } = render(<OnboardingGuide steps={hepsi} />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("🚀 son adım AZ ÖNCE bitmişse kutlama görünür", async () => {
    localStorage.setItem("lixus_onboarding_seen_count", "1"); // önce 1/2 görülmüştü
    const hepsi = steps.map((s) => ({ ...s, done: true }));
    render(<OnboardingGuide steps={hepsi} />);
    await waitFor(() => expect(screen.getByText(/Kurulum tamam/)).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// 🚨 DEPOLAMA ATTIĞINDA KART GÖRÜNÜR KALIR (P1 pini, 08-08).
//
// Bu tam olarak bir kez CANLIYA GİRMİŞ bir hatadır: `setCompletedBefore(...)`
// `try` bloğunun İÇİNDE ve `setItem`'dan SONRA duruyordu. Gizli sekmede /
// kota dolduğunda `setItem` atıyor, o satıra hiç gelinmiyor, `completedBefore`
// sonsuza kadar `null` kalıyor ve render kapısı (`=== null` → return null)
// kurulum rehberini KALICI OLARAK gizliyordu — yani catch'in "kartı göstermeye
// düş" sözünün TAM TERSİ oluyordu.
//
// Denetim ajanı bu düzeltmenin DOĞRU ama PİNSİZ olduğunu ölçtü: hatayı geri
// getiren mutasyon 3015 testin hepsini yeşil bırakıyordu. Artık bırakmıyor.
// ---------------------------------------------------------------------------
describe("OnboardingGuide — localStorage arızası", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("setItem ATIYORSA kart YİNE GÖRÜNÜR (mühür yok sayılır, gizlenmez)", async () => {
    // Okuma çalışıyor (mühür YOK), yazma atıyor — kotası dolmuş tarayıcı.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    render(<OnboardingGuide steps={steps} />);

    // Kurulum yarım (1/2) ve mühür yok → rehber GÖRÜNMELİ.
    expect(await screen.findByText(/Başlarken/)).toBeTruthy();
  });

  it("getItem ATIYORSA da kart görünür (okuma bacağı da fail-safe)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    render(<OnboardingGuide steps={steps} />);

    expect(await screen.findByText(/Başlarken/)).toBeTruthy();
  });

  it("mühür BASILIYSA kart gizlenir — yani test 'her hâlde görünür' demiyor", async () => {
    // Ters yön: pin yalnız "hep göster" deseydi, mührün tamamen bozulması da
    // yeşil kalırdı. Bu senaryo mührün GERÇEKTEN çalıştığını asserte eder.
    localStorage.setItem("lixus_onboarding_completed", "1");

    const { container } = render(<OnboardingGuide steps={steps} />);

    await waitFor(() => expect(screen.queryByText(/Başlarken/)).toBeNull());
    expect(container.textContent).toBe("");
  });
});
