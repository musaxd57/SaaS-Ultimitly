import { describe, it, expect } from "vitest";

import {
  DEFAULT_BILLING_CURRENCY,
  DEFAULT_LOCALE,
  SUPPORTED_BILLING_CURRENCIES,
  appBillingCurrency,
  appLocale,
  explicitPlanPriceMinor,
  isSupportedBillingCurrency,
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

  it("currency: yalnız FATURALAYABİLDİĞİMİZ para birimleri — biçimlenebilirlik YETMEZ", () => {
    expect(isSupportedBillingCurrency("TRY")).toBe(true);
    expect(isSupportedBillingCurrency("EUR")).toBe(true);
    expect(isSupportedBillingCurrency("eur")).toBe(true); // büyük harfe çevrilir
    expect(isSupportedBillingCurrency("TR")).toBe(false); // 2 harf
    expect(isSupportedBillingCurrency("TRYX")).toBe(false); // 4 harf
    expect(isSupportedBillingCurrency("1UR")).toBe(false); // rakam
    expect(isSupportedBillingCurrency("")).toBe(false);
    // ASIL BULGU: Intl bunları sorunsuz BİÇİMLENDİRİR ("EUU 1.00"), yani eski
    // "Intl kabul ediyor mu" kontrolü hepsini geçiriyordu. EUR yerine EUU yazan
    // bir env değişkeni sessizce üretime çıkardı.
    for (const bogus of ["EUU", "ZZZ", "QQQ", "ABC"]) {
      expect(isSupportedBillingCurrency(bogus), `${bogus} kabul edilmemeli`).toBe(false);
    }
    // XXX gerçek bir ISO 4217 kodudur ("para birimi yok") ama faturalanamaz.
    expect(isSupportedBillingCurrency("XXX")).toBe(false);
    // Gerçek ama DESTEKLENMEYEN para birimleri de reddedilir: üç plan fiyatı ve
    // üç Paddle price id'si olmadan bir para birimi eklenemez, o yüzden liste
    // bilinçli olarak kapalıdır (genişletmek kod değişikliğidir).
    expect(isSupportedBillingCurrency("USD")).toBe(false);
    expect(isSupportedBillingCurrency("GBP")).toBe(false);
    expect([...SUPPORTED_BILLING_CURRENCIES]).toEqual(["TRY", "EUR"]);
  });

  it("locale: YAPISAL olarak geçerli ama VERİSİ olmayan etiket reddedilir", () => {
    // zz-ZZ / qq / xx-XX BCP-47 açısından iyi biçimli, `new Intl.NumberFormat`
    // bunlarda FIRLATMAZ — sessizce varsayılana düşer. Eski kontrol bu yüzden
    // hepsini geçiriyordu ve "geçersiz değer boot'u durdurur" sözleşmesi yalandı.
    for (const bogus of ["zz-ZZ", "qq", "xx-XX"]) {
      expect(isValidLocale(bogus), `${bogus} kabul edilmemeli`).toBe(false);
    }
    // Gerçek locale'ler geçmeye devam eder (aşırı-reddetme YOK):
    for (const good of ["tr-TR", "de-DE", "en", "en-US", "fr", "it-IT"]) {
      expect(isValidLocale(good), `${good} kabul edilmeli`).toBe(true);
    }
  });

  it("fiyat: 0 ve güvenli-tamsayı ÜSTÜ değerler yapılandırılmış SAYILMAZ", () => {
    const env = (v: string) => ({ PLAN_PRICE_PRO_MINOR: v }) as unknown as NodeJS.ProcessEnv;
    const read = (v: string) => explicitPlanPriceMinor("PLAN_PRICE_PRO_MINOR", env(v));
    expect(read("120000")).toBe(120000);
    // Üç planın ÜÇÜ DE ücretli (Başlangıç "free" kodunu taşısa da ücretli giriş
    // seviyesidir; kalıcı ücretsiz sürüm YOK) → 0 geçerli bir fiyat değildir.
    expect(read("0")).toBeNull();
    expect(read("00")).toBeNull();
    // Number.isSafeInteger sınırının üstü: sessizce yuvarlanmış bir tutar
    // tahsil etmektense yapılandırılmamış say.
    expect(read("99999999999999999999")).toBeNull();
    expect(read("9007199254740993")).toBeNull(); // MAX_SAFE_INTEGER + 2
    expect(read("9007199254740991")).toBe(9007199254740991); // tam sınır geçer
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
});

// ---------------------------------------------------------------------------
// TRY DIŞI PARA BİRİMİ = FAIL-CLOSED BOOT KAPISI.
//
// Bu bölüm tek bir kuralı pinler: TRY dışı bir para birimi seçildiyse ÜÇ plan
// fiyatı da ÜÇ Paddle price id'si de ZORUNLUDUR. Biri bile eksikse boot DURUR
// (uyarı DEĞİL, hata). Gerekçe iki tarafı da vurur:
//   • fiyat eksikse → gönderilen TRY rakamları yabancı sembolle basılırdı,
//   • price id eksik/eski ise → müşteri €X görüp ₺X ödeyebilirdi.
// Eski sözleşme yalnız uyarıyordu ve `.some()` kullandığı için TEK fiyat
// verilince uyarı bile susuyordu — ikisi de burada kırmızıyla kapatıldı.
// ---------------------------------------------------------------------------
describe("boot kapısı — TRY dışı para birimi fiyatsız BAŞLAYAMAZ", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a-real-production-secret-value-32ch",
    ENCRYPTION_KEY: "a-different-real-production-key-32c",
    DATABASE_URL: "postgresql://u@h:5432/d",
    RESEND_API_KEY: "re_x",
  } as unknown as Record<string, string | undefined>;

  const EUR_PRICES = {
    PLAN_PRICE_BASLANGIC_MINOR: "1900",
    PLAN_PRICE_PRO_MINOR: "3900",
    PLAN_PRICE_ISLETME_MINOR: "7900",
  };
  const EUR_IDS = {
    PADDLE_PRICE_BASLANGIC: "pri_eur_baslangic",
    PADDLE_PRICE_PRO: "pri_eur_pro",
    PADDLE_PRICE_ISLETME: "pri_eur_isletme",
  };
  const priceErrors = (env: Record<string, string | undefined>) =>
    checkProductionEnv(env).errors.filter((e: string) => /PLAN_PRICE|PADDLE_PRICE/.test(e));

  it("HİÇ fiyat yok → HATA (boot durur), uyarıyla geçiştirilmez", () => {
    const { errors, warnings } = checkProductionEnv({ ...base, APP_BILLING_CURRENCY: "EUR", ...EUR_IDS });
    expect(errors.some((e: string) => e.includes("PLAN_PRICE"))).toBe(true);
    // Uyarıya düşürülmüş bir kalıntı kalmadığını da pinle.
    expect(warnings.some((w: string) => w.includes("PLAN_PRICE"))).toBe(false);
  });

  it("YALNIZ BİR fiyat var → yine HATA (kısmi config sessizce geçemez)", () => {
    const errs = priceErrors({
      ...base,
      APP_BILLING_CURRENCY: "EUR",
      ...EUR_IDS,
      PLAN_PRICE_PRO_MINOR: "3900",
    });
    expect(errs.length).toBeGreaterThan(0);
    // Hata mesajı EKSİK OLANLARI adıyla söylemeli; verilen tekini suçlamamalı.
    const joined = errs.join(" | ");
    expect(joined).toContain("PLAN_PRICE_BASLANGIC_MINOR");
    expect(joined).toContain("PLAN_PRICE_ISLETME_MINOR");
  });

  it("üç fiyat tam ama Paddle price id'leri eksik → HATA (gösterilen fiyat satılamaz/yanlış tahsil edilir)", () => {
    const errs = priceErrors({ ...base, APP_BILLING_CURRENCY: "EUR", ...EUR_PRICES });
    expect(errs.some((e: string) => e.includes("PADDLE_PRICE"))).toBe(true);
  });

  it("üç fiyat + üç price id TAM → para birimi yüzünden hata YOK", () => {
    const { errors } = checkProductionEnv({
      ...base,
      APP_BILLING_CURRENCY: "EUR",
      ...EUR_PRICES,
      ...EUR_IDS,
    });
    expect(errors.filter((e: string) => /APP_BILLING_CURRENCY|PLAN_PRICE|PADDLE_PRICE/.test(e))).toEqual([]);
  });

  it("TRY varsayılanı (.com): fiyatsız da, kısmi override ile de HATA YOK", () => {
    // Env hiç verilmemiş — bugünkü canlı .com.
    expect(priceErrors({ ...base })).toEqual([]);
    // Açıkça TRY + tek plan fiyatı override — aynı para biriminde, meşru.
    expect(priceErrors({ ...base, APP_BILLING_CURRENCY: "TRY", PLAN_PRICE_PRO_MINOR: "120000" })).toEqual([]);
    // Paddle price id'leri .com'da da zorunlu DEĞİL (billing uykudayken kurulabilir).
    expect(priceErrors({ ...base, PLAN_PRICE_PRO_MINOR: "120000" })).toEqual([]);
  });

  it("geçersiz para birimi kodu → fiyat hatası ÜRETMEZ (zaten kod hatası var, çift alarm yok)", () => {
    const { errors } = checkProductionEnv({ ...base, APP_BILLING_CURRENCY: "TRYX" });
    expect(errors.some((e: string) => e.includes("APP_BILLING_CURRENCY"))).toBe(true);
    expect(errors.filter((e: string) => /PLAN_PRICE|PADDLE_PRICE/.test(e))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AYNI KURALIN ÇALIŞMA-ZAMANI KARŞILIĞI.
//
// Boot kapısı bir PROSEDÜR; tek başına bırakılırsa kapının atlandığı her ortamda
// (dev, test, kapı devre dışı bir kurulum) yalan geri gelir. Bu yüzden kural
// KODUN İÇİNDE de duruyor: para birimi ve fiyatlar BİRLİKTE geçerlidir, biri
// eksikse İKİSİ de gönderilen TRY değerlerine düşer. Böylece "bir tutar asla
// ait olmadığı para biriminin sembolüyle basılmaz" invaryantı yapısaldır.
//
// Kritik nokta: Ayarlar sayfası para birimini (appBillingCurrency) ve fiyatları
// (defaultPlans) AYRI AYRI okuyor. İki okuma ayrışırsa yalan başka kapıdan geri
// gelir — bu yüzden ikisi de TEK çözücüden (resolveBilling) besleniyor.
// ---------------------------------------------------------------------------
describe("çalışma zamanı — para birimi ve fiyatlar birlikte düşer", () => {
  const eur = (extra: Record<string, string> = {}) =>
    ({ APP_BILLING_CURRENCY: "EUR", ...extra }) as unknown as NodeJS.ProcessEnv;

  it("EUR + fiyat YOK → TRY fiyatları EUR sembolüyle BASILMAZ (para birimi de TRY'ye döner)", () => {
    const env = eur();
    expect(appBillingCurrency(env)).toBe("TRY");
    const plans = defaultPlans(env);
    expect(plans.map((p) => [p.priceMinor, p.currency])).toEqual([
      [44900, "TRY"],
      [89900, "TRY"],
      [169900, "TRY"],
    ]);
  });

  it("EUR + KISMİ fiyat → kısmi rakam da kullanılmaz (yanlış tutar/yanlış sembol ikisi de yok)", () => {
    const env = eur({ PLAN_PRICE_PRO_MINOR: "3900" });
    expect(appBillingCurrency(env)).toBe("TRY");
    // 3900 EUR-cent niyetiyle yazılmıştı; ₺39 diye basılamaz.
    expect(defaultPlans(env).map((p) => p.priceMinor)).toEqual([44900, 89900, 169900]);
  });

  it("EUR + ÜÇ fiyat TAM → hem para birimi hem rakamlar env'den gelir", () => {
    const env = eur({
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "3900",
      PLAN_PRICE_ISLETME_MINOR: "7900",
    });
    expect(appBillingCurrency(env)).toBe("EUR");
    expect(defaultPlans(env).map((p) => [p.priceMinor, p.currency])).toEqual([
      [1900, "EUR"],
      [3900, "EUR"],
      [7900, "EUR"],
    ]);
  });

  it("EUR + bir fiyat BOZUK (float) → eksik sayılır, TRY'ye düşer", () => {
    const env = eur({
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "39.00", // minor birim değil
      PLAN_PRICE_ISLETME_MINOR: "7900",
    });
    expect(appBillingCurrency(env)).toBe("TRY");
    expect(defaultPlans(env).map((p) => p.priceMinor)).toEqual([44900, 89900, 169900]);
  });

  it("Ayarlar sayfasının İKİ ayrı okuması asla ayrışamaz", () => {
    // page.tsx: currency={appBillingCurrency()} + plans={defaultPlans()} — ikisi
    // ayrı çağrı. Her env kombinasyonunda aynı para birimini vermeliler.
    const cases: NodeJS.ProcessEnv[] = [
      {} as NodeJS.ProcessEnv,
      eur(),
      eur({ PLAN_PRICE_PRO_MINOR: "3900" }),
      eur({ PLAN_PRICE_BASLANGIC_MINOR: "1900", PLAN_PRICE_PRO_MINOR: "3900", PLAN_PRICE_ISLETME_MINOR: "7900" }),
      { APP_BILLING_CURRENCY: "XX" } as unknown as NodeJS.ProcessEnv,
      { APP_BILLING_CURRENCY: "TRY", PLAN_PRICE_PRO_MINOR: "120000" } as unknown as NodeJS.ProcessEnv,
    ];
    for (const env of cases) {
      const fromCurrency = appBillingCurrency(env);
      for (const plan of defaultPlans(env)) expect(plan.currency).toBe(fromCurrency);
    }
  });

  it("TRY varsayılanında tek plan override'ı hâlâ çalışır (.com davranışı)", () => {
    const env = { PLAN_PRICE_PRO_MINOR: "120000" } as unknown as NodeJS.ProcessEnv;
    expect(appBillingCurrency(env)).toBe("TRY");
    expect(defaultPlans(env).map((p) => p.priceMinor)).toEqual([44900, 120000, 169900]);
  });
});

// ---------------------------------------------------------------------------
// BOOT ↔ RUNTIME PARİTESİ.
//
// Boot kapısı (scripts/env-check.mjs) düz ESM'dir ve TS runtime'ından ÖNCE
// koştuğu için app-config.ts'i import EDEMEZ — kurallar zorunlu olarak iki yerde
// yazılı. Kod paylaşımı mümkün olmadığına göre eşitliği DAVRANIŞ üzerinden
// pinliyoruz: aşağıdaki tablo her girdiyi HEM kapıdan HEM runtime'dan geçirir ve
// aynı kararı vermelerini şart koşar.
//
// Ayrışma neden tehlikeli: kapının kabul edip runtime'ın reddettiği bir değer
// sessizce gönderilen varsayılanlara düşer (yanlış fiyat/para birimi görünür);
// tersi ise çalışabilir bir deployment'ı boot'ta durdurur.
// ---------------------------------------------------------------------------
describe("boot ↔ runtime — aynı sözleşme", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a-real-production-secret-value-32ch",
    ENCRYPTION_KEY: "a-different-real-production-key-32c",
    DATABASE_URL: "postgresql://u@h:5432/d",
    RESEND_API_KEY: "re_x",
    CRON_SECRET: "x",
  } as unknown as Record<string, string | undefined>;

  const EUR_IDS = {
    PADDLE_PRICE_BASLANGIC: "pri_a",
    PADDLE_PRICE_PRO: "pri_b",
    PADDLE_PRICE_ISLETME: "pri_c",
  };

  describe("para birimi", () => {
    // [kod, kabul edilmeli mi]
    const CASES: [string, boolean][] = [
      ["TRY", true],
      ["EUR", true],
      ["eur", true],
      ["EUU", false], // Intl biçimlendirir ama para birimi DEĞİL
      ["ZZZ", false],
      ["XXX", false], // gerçek ISO kodu ("para birimi yok"), faturalanamaz
      ["USD", false], // gerçek ama bu üründe desteklenmiyor
      ["TRYX", false],
      ["1UR", false],
    ];

    // Fiyatlar HER İKİ tarafta da eksiksiz verilir: burada ölçülen şey yalnız
    // KODUN kabul edilip edilmediği. Eksik fiyat ayrı bir kural (yukarıdaki
    // bölüm) ve karıştırılırsa geçerli EUR bile "reddedildi" görünür.
    const PRICES = {
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "3900",
      PLAN_PRICE_ISLETME_MINOR: "7900",
    };

    it.each(CASES)("%s → kapı ve runtime aynı kararı verir", (code, shouldAccept) => {
      // Runtime: kabul edilmeyen kod gönderilen TRY'ye düşer.
      const runtimeAccepted =
        appBillingCurrency({
          APP_BILLING_CURRENCY: code,
          ...PRICES,
        } as unknown as NodeJS.ProcessEnv) === code.toUpperCase();
      // Kapı: kabul edilmeyen kod APP_BILLING_CURRENCY hatası üretir.
      const gateRejected = checkProductionEnv({
        ...base,
        APP_BILLING_CURRENCY: code,
        ...PRICES,
        ...EUR_IDS,
      }).errors.some((e: string) => e.includes("APP_BILLING_CURRENCY"));
      if (shouldAccept) {
        // TRY zaten varsayılan; "kabul" onun için de doğru sonucu verir.
        expect(runtimeAccepted, `${code} runtime'da kabul edilmeli`).toBe(true);
        expect(gateRejected, `${code} kapıda reddedilmemeli`).toBe(false);
      } else {
        expect(runtimeAccepted, `${code} runtime'da reddedilmeli`).toBe(false);
        expect(gateRejected, `${code} kapıda reddedilmeli`).toBe(true);
      }
    });
  });

  describe("plan fiyatı", () => {
    // [ham değer, geçerli bir fiyat mı]
    const CASES: [string, boolean][] = [
      ["120000", true],
      ["1900", true],
      ["9007199254740991", true], // MAX_SAFE_INTEGER
      ["0", false], // ücretsiz plan yok
      ["00", false],
      ["-5", false],
      ["12.5", false],
      ["abc", false],
      ["99999999999999999999", false], // güvenli tamsayı üstü
      ["9007199254740993", false],
    ];

    it.each(CASES)("%s → kapı ve runtime aynı kararı verir", (raw, isValidPrice) => {
      const runtimeAccepted =
        explicitPlanPriceMinor(
          "PLAN_PRICE_PRO_MINOR",
          { PLAN_PRICE_PRO_MINOR: raw } as unknown as NodeJS.ProcessEnv,
        ) !== null;
      const gateRejected = checkProductionEnv({
        ...base,
        PLAN_PRICE_PRO_MINOR: raw,
      }).errors.some((e: string) => e.includes("PLAN_PRICE_PRO_MINOR"));
      expect(runtimeAccepted, `${raw} runtime kararı`).toBe(isValidPrice);
      expect(gateRejected, `${raw} kapı kararı`).toBe(!isValidPrice);
    });

    it("eksiksizlik kontrolü YALNIZ geçerli değerleri sayar — 0 'verilmiş' sayılmaz", () => {
      // EUR + üç fiyat "verilmiş" görünüyor ama biri 0: eksik muamelesi görmeli,
      // yoksa €0'lık bir Pro planı yayına çıkardı.
      const { errors } = checkProductionEnv({
        ...base,
        APP_BILLING_CURRENCY: "EUR",
        ...EUR_IDS,
        PLAN_PRICE_BASLANGIC_MINOR: "1900",
        PLAN_PRICE_PRO_MINOR: "0",
        PLAN_PRICE_ISLETME_MINOR: "7900",
      });
      expect(errors.some((e: string) => e.includes("PLAN_PRICE_PRO_MINOR"))).toBe(true);
      // Runtime de aynı sonuca varır: para birimi TRY'ye düşer.
      expect(
        appBillingCurrency({
          APP_BILLING_CURRENCY: "EUR",
          PLAN_PRICE_BASLANGIC_MINOR: "1900",
          PLAN_PRICE_PRO_MINOR: "0",
          PLAN_PRICE_ISLETME_MINOR: "7900",
        } as unknown as NodeJS.ProcessEnv),
      ).toBe("TRY");
    });
  });

  describe("locale", () => {
    const CASES: [string, boolean][] = [
      ["tr-TR", true],
      ["de-DE", true],
      ["en", true],
      ["zz-ZZ", false], // yapısal olarak geçerli, verisi YOK
      ["qq", false],
      ["xx-XX", false],
      ["!!bad!!", false],
    ];

    it.each(CASES)("%s → kapı ve runtime aynı kararı verir", (tag, shouldAccept) => {
      const runtimeAccepted =
        appLocale({ APP_LOCALE: tag } as unknown as NodeJS.ProcessEnv) === tag;
      const gateRejected = checkProductionEnv({ ...base, APP_LOCALE: tag }).errors.some(
        (e: string) => e.includes("APP_LOCALE"),
      );
      expect(runtimeAccepted, `${tag} runtime kararı`).toBe(shouldAccept);
      expect(gateRejected, `${tag} kapı kararı`).toBe(!shouldAccept);
    });
  });

  it(".com REGRESYONU: env hiç verilmezse tek bir locale/currency/price hatası bile yok", () => {
    const { errors } = checkProductionEnv({ ...base });
    expect(
      errors.filter((e: string) => /APP_LOCALE|APP_BILLING_CURRENCY|PLAN_PRICE|PADDLE_PRICE/.test(e)),
    ).toEqual([]);
    // Ve runtime çıktısı bire bir aynı.
    const plans = defaultPlans({} as unknown as NodeJS.ProcessEnv);
    expect(plans.map((p) => [p.priceMinor, p.currency])).toEqual([
      [44900, "TRY"],
      [89900, "TRY"],
      [169900, "TRY"],
    ]);
    expect(appLocale({} as unknown as NodeJS.ProcessEnv)).toBe("tr-TR");
  });
});
