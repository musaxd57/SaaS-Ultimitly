// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// FİYAT/ÖN-KOŞUL DÜRÜSTLÜĞÜ — metin pinleri.
//
// Üç şey müşterinin PARA kararını doğrudan etkiliyor ve üçü de sessizce
// bozulabilecek düz metinler:
//
//  1) KDV: listelenen rakam müşterinin ödeyeceği TAM tutar. Kod-doğrulaması:
//     plan-değişim önizlemesindeki tutarlar Paddle'ın `grand_total`'ından gelir
//     (src/lib/payments/paddle.ts → formatPaddleTotal(rec?.grand_total)) ve
//     canlı ekranda liste fiyatıyla birebir aynı çıkıyor (₺1.699,00). Yani
//     vergi ödeme adımında ÜSTÜNE eklenmiyor. Metin bunu söylemeli.
//
//  2) Hospitable ön koşulu: bağlantı Hospitable üzerinden kurulur ve API /
//     Connected Integrations erişimi ÜCRETLİ planlarda. Bu, hostun karşılaşacağı
//     ilk gerçek maliyet ve Lixus aboneliğine DAHİL DEĞİL. Kurulumun ortasında
//     öğrenmek kötü sürpriz olur.
//
//  3) Rakam SABİTLENMEZ: Hospitable fiyatı bizim kontrolümüzde değil; sayfaya
//     rakam yazmak bayat/yanlış bilgi üretir → resmî fiyat sayfasına link.
//
// Kayıt formundaki "ücretsiz sürümle devam" vaadi de gerçek davranışla
// (LimitedModeBanner) çelişiyordu; aynı sözcüklerle hizalandı.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import { LandingPage } from "@/components/marketing/landing-page";
import IntegrationsPage from "@/app/(legal)/entegrasyonlar/page";
import { RegisterForm } from "@/components/auth/register-form";

const HOSPITABLE_PRICING = "https://hospitable.com/pricing";

describe("Fiyat kartları — KDV dahil ve Hospitable ön koşulu yazılı", () => {
  beforeEach(() => cleanup());

  function landing() {
    const { container } = render(<LandingPage />);
    return container;
  }

  /** Fiyat kartlarının hemen altındaki TEK SATIRLIK dipnot. */
  function pricingNote(container: HTMLElement): HTMLElement {
    const line = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("KDV dahildir"),
    );
    if (!line) throw new Error("fiyat dipnotu bulunamadı");
    return line;
  }

  it("listelenen fiyatın KDV DAHİL olduğunu ve ek vergi EKLENMEDİĞİNİ söyler", () => {
    const note = pricingNote(landing());
    expect(note.textContent).toContain("KDV dahildir");
    expect(note.textContent).toContain("ek vergi eklenmez");
  });

  it("KART ALTI NOT tek satırlık dipnottur — Hospitable ayrıntısı orada DEĞİL", () => {
    // Uzun paragraf fiyat kartlarıyla yarışıyordu (kullanıcı kararı: sil).
    // İddia NOTA kapsanır, sayfanın geneline değil: daha önce tüm sayfada
    // "Essentials" arandı ve SSS cevabındaki MEŞRU geçiş kırmızı vermişti.
    const note = pricingNote(landing());
    expect(note.textContent).not.toContain("Hospitable");
    expect((note.textContent ?? "").length).toBeLessThan(90);
  });

  it("ANA SAYFA Hospitable ön koşulunu YİNE söyler (SSS'te) — dürüstlük kaybolmadı", () => {
    // Dipnot silindi ama vaat silinmedi: hostun ücretli Hospitable planı
    // gerektiğini ve bunun Lixus'a dahil olmadığını ana sayfa hâlâ söylüyor.
    const text = landing().textContent ?? "";
    expect(text).toContain("Hospitable");
    expect(text).toMatch(/Host.*Professional.*Mogul/s);
    expect(text).toContain("Essentials");
    expect(text).toContain("Lixus aboneliğine dahil değildir");
  });

  it("Hospitable RAKAMI hiçbir yerde sabitlenmez", () => {
    // Rakam bizim kontrolümüzde değil → bayat/yanlış bilgi üretir. Resmî fiyat
    // sayfası linki /entegrasyonlar'da (aşağıdaki blokta pinli).
    expect(landing().textContent ?? "").not.toMatch(/\$\s?\d+[.,]?\d*\s*\/?\s*(ay|mo)/i);
  });
});

describe("Entegrasyonlar — ön koşul bağlan düğmesinden ÖNCE görünür", () => {
  beforeEach(() => cleanup());

  it("ücretli Hospitable planı şartı ve dahil-değildir notu vardır", () => {
    const { container } = render(<IntegrationsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("ücretli bir Hospitable planı gerekir");
    expect(text).toMatch(/Host/);
    expect(text).toMatch(/Professional/);
    expect(text).toMatch(/Mogul/);
    expect(text).toContain("Essentials");
    expect(text).toContain("Lixus AI aboneliğine dahil değildir");
    expect(container.querySelector(`a[href="${HOSPITABLE_PRICING}"]`)).not.toBeNull();
  });

  it("uyarı, kayıt CTA'sından ÖNCE gelir (sürpriz maliyet olmasın)", () => {
    // Sıra DOM üzerinden ölçülür, ham HTML'de indexOf ile DEĞİL: "Hesabınızı
    // bağlayın" ifadesi sayfanın giriş cümlesinde de geçiyor, indexOf o ilk
    // eşleşmeyi buluyordu ve test yanlış şeyi ölçüyordu (ilk yazımda kırmızı
    // verdi — iyi ki). Ölçtüğümüz şey GERÇEK CTA bağlantısı.
    const { container } = render(<IntegrationsPage />);
    const warning = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("ücretli bir Hospitable planı gerekir"),
    );
    const cta = container.querySelector('a[href="/register"]');
    expect(warning).toBeTruthy();
    expect(cta).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING = cta, warning'den SONRA geliyor.
    expect(warning!.compareDocumentPosition(cta!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Kayıt formu — deneme sonrası vaat GERÇEK davranışla aynı", () => {
  beforeEach(() => cleanup());

  it("'ücretsiz sürüm' vaadi yerine sınırlı-erişim gerçeği yazar", () => {
    const { container } = render(<RegisterForm />);
    const text = container.textContent ?? "";
    // Eski vaat: tam bir ücretsiz sürüm varmış gibi okunuyordu.
    expect(text).not.toContain("ücretsiz sürümle devam");
    expect(text).toContain("sınırlı erişimle açık kalır");
    expect(text).toContain("otomatik yanıtlar yalnızca ücretli planlarda");
    // Otomatik ücret alınmadığı + kart alınmadığı vaatleri KORUNUR (doğru ve satışın çekirdeği).
    expect(text).toContain("otomatik ücret alınmaz");
    expect(text).toContain("Kart gerekmez");
  });
});

describe("LimitedModeBanner ile kayıt metni AYNI şeyi söyler", () => {
  beforeEach(() => cleanup());

  it("iki yüzey de 'paneller açık, otomatik yanıtlar kapalı' der", async () => {
    const { LimitedModeBanner } = await import("@/components/billing/limited-mode-banner");
    render(<LimitedModeBanner />);
    const banner = screen.getByText(/deneme süreniz doldu/i).closest("div")!;
    expect(within(banner).getByText(/otomatik yanıtlar kapalı/i)).toBeTruthy();
    cleanup();

    const { container } = render(<RegisterForm />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/hesabınız sınırlı erişimle açık kalır/i);
  });
});
