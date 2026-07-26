import { describe, it, expect } from "vitest";

import {
  DEFAULT_BILLING_CURRENCY,
  DEFAULT_LOCALE,
  appBillingCurrency,
  appLocale,
  isValidCurrencyCode,
  isValidLocale,
  planPriceMinor,
} from "@/lib/app-config";
import { SHIPPED_PRICE_MINOR, defaultPlans, planByCode } from "@/lib/billing/plans";
import { formatCurrency, formatMinor } from "@/lib/utils";
import { checkProductionEnv } from "../../scripts/env-check.mjs";

// ---------------------------------------------------------------------------
// LOCALE / CURRENCY — .eu hazırlığı.
//
// Dört kavram AYRI: locale (biçim) · billing currency (bizim tahsilatımız) ·
// record currency (satırın kendi para birimi — rezervasyon/fatura) · org
// timezone (parayla İLGİSİZ). Hiçbir yerde DÖNÜŞÜM yok: sembolü değiştirip
// sayıyı bırakmak yanlış beyandır, o yüzden her tutar KENDİ para biriminde
// basılır.
//
// EN ÖNEMLİ REGRESYON: .com çıktısı bire bir aynı kalmalı.
// ---------------------------------------------------------------------------

describe("app-config — doğrulayıcılar", () => {
  it("locale: Intl'in kabul ettiği etiket geçer, çöp geçmez", () => {
    expect(isValidLocale("tr-TR")).toBe(true);
    expect(isValidLocale("de-DE")).toBe(true);
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale("!!not-a-locale!!")).toBe(false);
  });

  it("currency: yalnız 3 harfli geçerli ISO 4217", () => {
    expect(isValidCurrencyCode("TRY")).toBe(true);
    expect(isValidCurrencyCode("eur")).toBe(true); // büyük harfe çevrilir
    expect(isValidCurrencyCode("TR")).toBe(false); // 2 harf
    expect(isValidCurrencyCode("TRYX")).toBe(false); // 4 harf
    expect(isValidCurrencyCode("1UR")).toBe(false); // rakam
    expect(isValidCurrencyCode("")).toBe(false);
  });

  it("env boşsa .com varsayılanları döner", () => {
    expect(appLocale({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_LOCALE);
    expect(appBillingCurrency({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_BILLING_CURRENCY);
    expect(DEFAULT_LOCALE).toBe("tr-TR");
    expect(DEFAULT_BILLING_CURRENCY).toBe("TRY");
  });

  it("geçersiz env sayfayı patlatmaz, varsayılana düşer (boot kapısı ayrıca reddeder)", () => {
    expect(appLocale({ APP_LOCALE: "!!bad!!" } as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_LOCALE);
    expect(appBillingCurrency({ APP_BILLING_CURRENCY: "XX" } as unknown as NodeJS.ProcessEnv)).toBe(
      DEFAULT_BILLING_CURRENCY,
    );
  });

  it("fiyat YALNIZ tam sayı minor birim kabul eder — float sessizce yuvarlanmaz", () => {
    const env = (v: string) => ({ PLAN_PRICE_PRO_MINOR: v }) as unknown as NodeJS.ProcessEnv;
    expect(planPriceMinor("PLAN_PRICE_PRO_MINOR", 89900, env("120000"))).toBe(120000);
    // Float / işaretli / çöp → varsayılan (yanlış tutar tahsil etmektense bilineni kullan)
    expect(planPriceMinor("PLAN_PRICE_PRO_MINOR", 89900, env("1200.50"))).toBe(89900);
    expect(planPriceMinor("PLAN_PRICE_PRO_MINOR", 89900, env("-5"))).toBe(89900);
    expect(planPriceMinor("PLAN_PRICE_PRO_MINOR", 89900, env("abc"))).toBe(89900);
    expect(planPriceMinor("PLAN_PRICE_PRO_MINOR", 89900, {} as unknown as NodeJS.ProcessEnv)).toBe(89900);
  });
});

describe("plan katalogu — .com regresyonu ve deployment override", () => {
  it("env yokken TRY fiyatları BİREBİR aynı kalır", () => {
    const plans = defaultPlans({} as unknown as NodeJS.ProcessEnv);
    expect(plans.map((p) => [p.code, p.priceMinor, p.currency])).toEqual([
      ["free", 44900, "TRY"],
      ["pro", 89900, "TRY"],
      ["business", 169900, "TRY"],
    ]);
    expect(SHIPPED_PRICE_MINOR).toEqual({ free: 44900, pro: 89900, business: 169900 });
  });

  it("mülk limitleri değişmedi (fiyat turu limitlere dokunmaz)", () => {
    const plans = defaultPlans({} as unknown as NodeJS.ProcessEnv);
    expect(plans.map((p) => p.propertyLimit)).toEqual([2, 7, 25]);
  });

  it("EUR deployment: para birimi VE fiyatlar birlikte gelir", () => {
    const env = {
      APP_BILLING_CURRENCY: "EUR",
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "3900",
      PLAN_PRICE_ISLETME_MINOR: "7900",
    } as unknown as NodeJS.ProcessEnv;
    const plans = defaultPlans(env);
    expect(plans.map((p) => [p.priceMinor, p.currency])).toEqual([
      [1900, "EUR"],
      [3900, "EUR"],
      [7900, "EUR"],
    ]);
    expect(planByCode("pro", env)?.currency).toBe("EUR");
  });
});

describe("para biçimlendirme — sembol tutarın KENDİ birimini izler", () => {
  it("formatMinor tam sayıyı kuruşsuz, kuruşluyu iki haneli basar", () => {
    expect(formatMinor(44900, "TRY", "tr-TR")).toContain("449");
    expect(formatMinor(44900, "TRY", "tr-TR")).not.toContain(",00");
    expect(formatMinor(44950, "TRY", "tr-TR")).toContain("449,50");
  });

  it("aynı sayı FARKLI para biriminde farklı sembol alır — dönüşüm YOK", () => {
    const tryOut = formatMinor(44900, "TRY", "tr-TR");
    const eurOut = formatMinor(44900, "EUR", "tr-TR");
    expect(tryOut).not.toBe(eurOut);
    // Sayı aynı kalır: yalnız etiket değişti, tutar çevrilmedi.
    expect(tryOut.replace(/[^\d]/g, "")).toBe(eurOut.replace(/[^\d]/g, ""));
  });

  it("formatCurrency verilen para birimini kullanır, locale'den TAHMİN ETMEZ", () => {
    // Rezervasyon EUR ise Türkçe locale'de bile EUR gösterilir.
    const out = formatCurrency(1200, "EUR", "tr-TR");
    expect(out).not.toContain("₺");
    expect(formatCurrency(1200, "TRY", "tr-TR")).toContain("₺");
  });

  it("locale yalnız biçimi değiştirir, para birimini DEĞİL", () => {
    const tr = formatMinor(169900, "TRY", "tr-TR");
    const de = formatMinor(169900, "TRY", "de-DE");
    expect(tr).not.toBe(de); // gruplama/sembol yeri farklı
    expect(tr.replace(/[^\d]/g, "")).toBe(de.replace(/[^\d]/g, "")); // sayı aynı
  });
});

describe("boot kapısı — geçersiz locale/currency üretimi DURDURUR", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a-real-production-secret-value-32ch",
    ENCRYPTION_KEY: "a-different-real-production-key-32c",
    DATABASE_URL: "postgresql://u@h:5432/d",
    RESEND_API_KEY: "re_x",
  } as unknown as Record<string, string | undefined>;

  it("env verilmezse locale/currency yüzünden hata YOK (.com bozulmaz)", () => {
    const { errors } = checkProductionEnv({ ...base });
    expect(errors.filter((e: string) => /APP_LOCALE|APP_BILLING_CURRENCY|PLAN_PRICE/.test(e))).toEqual([]);
  });

  it("geçersiz APP_LOCALE → hata", () => {
    const { errors } = checkProductionEnv({ ...base, APP_LOCALE: "!!bad!!" });
    expect(errors.some((e: string) => e.includes("APP_LOCALE"))).toBe(true);
  });

  it("geçersiz APP_BILLING_CURRENCY → hata", () => {
    expect(
      checkProductionEnv({ ...base, APP_BILLING_CURRENCY: "TRYX" }).errors.some((e: string) =>
        e.includes("APP_BILLING_CURRENCY"),
      ),
    ).toBe(true);
    expect(
      checkProductionEnv({ ...base, APP_BILLING_CURRENCY: "12X" }).errors.some((e: string) =>
        e.includes("APP_BILLING_CURRENCY"),
      ),
    ).toBe(true);
  });

  it("float fiyat → hata (minor birim tam sayı olmalı)", () => {
    const { errors } = checkProductionEnv({ ...base, PLAN_PRICE_PRO_MINOR: "899.00" });
    expect(errors.some((e: string) => e.includes("PLAN_PRICE_PRO_MINOR"))).toBe(true);
  });

  it("TRY dışı para birimi + fiyat YOKSA uyarır (lira tutarı yabancı sembolle basılırdı)", () => {
    const { warnings, errors } = checkProductionEnv({ ...base, APP_BILLING_CURRENCY: "EUR" });
    expect(errors.some((e: string) => e.includes("APP_BILLING_CURRENCY"))).toBe(false); // geçerli kod
    expect(warnings.some((w: string) => w.includes("APP_BILLING_CURRENCY"))).toBe(true);
  });

  it("para birimi + fiyatlar BİRLİKTE verilirse uyarı yok", () => {
    const { warnings } = checkProductionEnv({
      ...base,
      APP_BILLING_CURRENCY: "EUR",
      PLAN_PRICE_PRO_MINOR: "3900",
    });
    expect(warnings.some((w: string) => w.includes("APP_BILLING_CURRENCY"))).toBe(false);
  });
});
