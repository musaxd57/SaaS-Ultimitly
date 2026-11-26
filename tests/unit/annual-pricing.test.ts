import { describe, it, expect } from "vitest";
import {
  defaultPlans,
  annualPriceMinor,
  annualMonthlyEquivalentMinor,
  annualSavingsMinor,
  ANNUAL_PAID_MONTHS,
  SHIPPED_PRICE_MINOR,
} from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// YILLIK FİYAT = AYLIK × 10 ("yıllıkta 2 ay bedava")
//
// Bu dosya, sitede yazan CÜMLE ile ekrandaki SAYIYI birbirine bağlar. İkisi
// ayrı kaynaklardan gelseydi biri diğerinden habersiz değişebilir ve ürün
// "2 ay bedava" derken 11 aylık bir fiyat gösterebilirdi.
// ---------------------------------------------------------------------------

describe("yıllık fiyat türetmesi", () => {
  it("2 ay bedava = 12 ay hizmet, 10 ay ücret", () => {
    // 🚨 Bu sabit ÜRÜN SÖZÜDÜR. Değiştiren kişi landing'deki "2 ay bedava"
    // ifadesini VE Paddle'daki yıllık fiyatları da değiştirmek zorundadır.
    expect(ANNUAL_PAID_MONTHS).toBe(10);
    expect(12 - ANNUAL_PAID_MONTHS).toBe(2);
  });

  it("üç kademenin yıllık fiyatı Paddle'a girilen değerlerle BİREBİR aynı", () => {
    // Paddle'da elle oluşturulan fiyatlar (08-07): 4.490 / 8.990 / 16.990 TRY.
    // Ekranda gösterilen sayı bunlarla aynı olmalı — müşteri ₺8.990 görüp
    // checkout'ta başka bir tutarla karşılaşırsa satış orada biter.
    expect(annualPriceMinor(SHIPPED_PRICE_MINOR.free)).toBe(449000); // ₺4.490
    expect(annualPriceMinor(SHIPPED_PRICE_MINOR.pro)).toBe(899000); // ₺8.990
    expect(annualPriceMinor(SHIPPED_PRICE_MINOR.business)).toBe(1699000); // ₺16.990
  });

  it("tasarruf TAM OLARAK iki aylık ücrettir", () => {
    for (const p of defaultPlans()) {
      expect(annualSavingsMinor(p.priceMinor)).toBe(p.priceMinor * 2);
    }
  });

  it("aylık karşılık TAM LİRADIR (başlıkta kuruş gösterilmez)", () => {
    // Yanındaki aylık fiyat kuruşsuz ("₺899"); yıllık sütununda "₺749,17"
    // görmek kıyası zorlaştırıyor ve ucuz duruyor.
    for (const p of defaultPlans()) {
      expect(annualMonthlyEquivalentMinor(p.priceMinor) % 100).toBe(0);
    }
    expect(annualMonthlyEquivalentMinor(SHIPPED_PRICE_MINOR.free)).toBe(37400); // ₺374
    expect(annualMonthlyEquivalentMinor(SHIPPED_PRICE_MINOR.pro)).toBe(74900); // ₺749
    expect(annualMonthlyEquivalentMinor(SHIPPED_PRICE_MINOR.business)).toBe(141600); // ₺1.416
  });

  it("🚨 yuvarlama YAKLAŞIKTIR — bir aydan fazla sapmaz, kesin tutar ayrıca yazılır", () => {
    // ₺749 × 12 = ₺8.988 iken gerçek tahsilat ₺8.990. Bu fark KABUL EDİLİR
    // çünkü kartta "yıllık ₺8.990 olarak faturalanır" satırı var (test:
    // tests/ui/billing-period-toggle.test.tsx). Kabul edilmeyen şey SAPMANIN
    // BÜYÜMESİ — bir aylık ücretin yarısını aşarsa yuvarlama yanlıştır.
    for (const p of defaultPlans()) {
      const drift = Math.abs(
        annualMonthlyEquivalentMinor(p.priceMinor) * 12 - annualPriceMinor(p.priceMinor),
      );
      expect(drift).toBeLessThan(p.priceMinor / 2);
    }
  });

  it("yıllık her zaman aylık×12'den UCUZ (indirim yönü doğru)", () => {
    for (const p of defaultPlans()) {
      expect(annualPriceMinor(p.priceMinor)).toBeLessThan(p.priceMinor * 12);
    }
  });

  it("🚨 `defaultPlans()` GENİŞLEMEDİ — yıllık ayrı bir plan DEĞİL", () => {
    // Yıllık kalemler bu diziye eklenirse: `planChangeMode` kademe
    // karşılaştırması altı elemanlı olur, ayarlar altı kart çizer ve JSON-LD'ye
    // üç hayalet teklif düşer. Yıllık bir FATURA DÖNEMİDİR.
    const plans = defaultPlans();
    expect(plans.map((p) => p.code)).toEqual(["free", "pro", "business"]);
    expect(plans.every((p) => p.interval === "month")).toBe(true);
  });
});
