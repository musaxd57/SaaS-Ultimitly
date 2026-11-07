// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LandingPage } from "@/components/marketing/landing-page";
import { defaultPlans } from "@/lib/billing/plans";
import { formatMinor } from "@/lib/utils";
import { appLocale } from "@/lib/app-config";

// ---------------------------------------------------------------------------
// LANDING ↔ CHECKOUT FİYAT PARİTESİ.
//
// Landing eskiden kendi "₺449" literal'lerini taşıyordu ve tutarlılık yalnız bir
// YORUM ile korunuyordu ("keep in sync"). Fiyat iki yerde yazılıysa er geç
// ayrışır — ve müşteriye ana sayfada bir rakam, ödeme ekranında başka bir rakam
// göstermek en pahalı hatadır. Artık ikisi de defaultPlans()'tan okur; bu test
// kaynağın TEK olduğunu pinler.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("landing fiyatları checkout ile AYNI kaynaktan gelir", () => {
  it("ekrandaki üç fiyat defaultPlans() çıktısının birebir aynısıdır", () => {
    render(<LandingPage />);
    const locale = appLocale();

    for (const plan of defaultPlans()) {
      const expected = formatMinor(plan.priceMinor, plan.currency, locale);
      // Fiyat kendi başına bir düğümde basılıyor; tam eşleşme arıyoruz.
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    }
  });

  it("ana sayfada elle yazılmış para birimi sembolü KALMADI", () => {
    const { container } = render(<LandingPage />);
    const html = container.innerHTML;
    // ₺ yalnızca formatMinor'ın ürettiği fiyat düğümlerinde geçebilir; sayısı
    // plan sayısını aşarsa biri yeniden literal yazmış demektir.
    const liraCount = (html.match(/₺/g) ?? []).length;
    expect(liraCount).toBeLessThanOrEqual(defaultPlans().length);
  });

  it(".com varsayılanı: gösterilen tutarlar hâlâ 449 / 899 / 1.699", () => {
    render(<LandingPage />);
    // Kuruşsuz, Türkçe binlik ayracıyla — mevcut müşterinin gördüğü metin.
    expect(screen.getAllByText(/449/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/899/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1\.699/).length).toBeGreaterThan(0);
  });
});
