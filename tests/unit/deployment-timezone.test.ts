import { describe, it, expect } from "vitest";

import { appDefaultTimezone, resolveNewOrgTimezone, trustsBrowserTimezone } from "@/lib/app-config";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { checkProductionEnv } from "../../scripts/env-check.mjs";

// ---------------------------------------------------------------------------
// YENİ ORGANİZASYONUN SAAT DİLİMİ.
//
// Organization.timezone raporların gün sınırlarını, otomatik mesaj saat
// pencerelerini ve QR sohbetin açık-saat kapısını sürüyor. Şemadaki varsayılan
// 00_init'ten beri Europe/Istanbul ve kayıt rotası bu alanı HİÇ yazmıyordu —
// yani .eu'da kaydolan bir Berlin hostu İstanbul takvimiyle başlıyordu. Görünür
// bir hata değil: yanlış saatte mesaj gider, "Bugün" yanlış günü gösterir.
//
// İki katman: deployment varsayılanı (APP_DEFAULT_TIMEZONE) + tarayıcının
// bildirdiği gerçek dilim. Tarayıcı değeri istemciden gelir, bu yüzden
// DOĞRULANIR; doğrulanmayan her şey varsayılana düşer, kaydı ASLA reddetmez.
//
// KURAL: saat dilimi para biriminden veya locale'den TAHMİN EDİLMEZ. Berlin'de
// oturan bir host TRY ile faturalanabilir; de-DE arayüz seçen biri İstanbul'da
// olabilir. Üçü bağımsız girdidir.
// ---------------------------------------------------------------------------

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("appDefaultTimezone — deployment varsayılanı", () => {
  it("env yoksa .com varsayılanı (Europe/Istanbul) — mevcut davranış", () => {
    expect(appDefaultTimezone(env({}))).toBe("Europe/Istanbul");
    expect(appDefaultTimezone(env({}))).toBe(DEFAULT_TIMEZONE);
  });

  it("geçerli IANA değeri aynen kullanılır (.eu için Europe/Berlin)", () => {
    expect(appDefaultTimezone(env({ APP_DEFAULT_TIMEZONE: "Europe/Berlin" }))).toBe("Europe/Berlin");
    expect(appDefaultTimezone(env({ APP_DEFAULT_TIMEZONE: "UTC" }))).toBe("UTC");
  });

  it("geçersiz/çöp değer sayfayı patlatmaz, varsayılana düşer (boot kapısı ayrıca reddeder)", () => {
    expect(appDefaultTimezone(env({ APP_DEFAULT_TIMEZONE: "Mars/Olympus" }))).toBe(DEFAULT_TIMEZONE);
    expect(appDefaultTimezone(env({ APP_DEFAULT_TIMEZONE: "  " }))).toBe(DEFAULT_TIMEZONE);
    expect(appDefaultTimezone(env({ APP_DEFAULT_TIMEZONE: "!!!" }))).toBe(DEFAULT_TIMEZONE);
  });
});

describe("tarayıcı dilimine GÜVEN — deployment kararı, varsayılan KAPALI", () => {
  // .com'un cevabı KAPALI. Her .com müşterisi Türkiye'deki daireleri yöneten bir
  // Türk host: deployment varsayılanı neredeyse her zaman doğru, tarayıcı ise
  // yalnızca YANLIŞ OLMA YOLU ekliyor — yurt dışındayken kaydolan bir host
  // sessizce yanlış takvimle başlar ve belirti (mesajın yanlış saatte gitmesi,
  // "Bugün"ün dünü göstermesi) saat dilimi hatasına BENZEMEZ.
  //
  // Çok-dilimli bir deployment (.eu) bunu 1 yapıp tarayıcının gerçek dilimini
  // alır. Aynı kod, farklı env — kararı DEPLOYMENT verir, istemci asla.
  it("bayrak yokken tarayıcının dilimi YOK SAYILIR (.com)", () => {
    expect(trustsBrowserTimezone(env({}))).toBe(false);
    expect(resolveNewOrgTimezone("Europe/Berlin", env({}))).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone("America/New_York", env({}))).toBe("Europe/Istanbul");
    // Geçerli bir IANA değeri olması fark etmez — sorun geçerlilik değil, yetki.
    expect(resolveNewOrgTimezone("Asia/Dubai", env({}))).toBe("Europe/Istanbul");
  });

  it("bayrak açıkken tarayıcının dilimi KULLANILIR (.eu)", () => {
    const on = (extra: Record<string, string> = {}) =>
      env({ APP_TRUST_BROWSER_TIMEZONE: "1", ...extra });
    expect(trustsBrowserTimezone(on())).toBe(true);
    expect(resolveNewOrgTimezone("Europe/Berlin", on())).toBe("Europe/Berlin");
    expect(resolveNewOrgTimezone("America/New_York", on())).toBe("America/New_York");
    // Deployment varsayılanı Berlin olsa bile host'un gerçek dilimi kazanır.
    expect(resolveNewOrgTimezone("Asia/Dubai", on({ APP_DEFAULT_TIMEZONE: "Europe/Berlin" }))).toBe(
      "Asia/Dubai",
    );
    expect(trustsBrowserTimezone(env({ APP_TRUST_BROWSER_TIMEZONE: "true" }))).toBe(true);
  });

  it("tanınmayan bayrak değeri KAPALI sayılır (yanlış yön güvenli yön)", () => {
    for (const v of ["", " ", "0", "false", "evet", "yes", "on", "İ", "1 "]) {
      expect(trustsBrowserTimezone(env({ APP_TRUST_BROWSER_TIMEZONE: v })), v).toBe(
        v.trim() === "1",
      );
    }
    // Yazım hatası → varsayılana düşer, tarayıcıya güvenilmez.
    expect(resolveNewOrgTimezone("Europe/Berlin", env({ APP_TRUST_BROWSER_TIMEZONE: "yes" }))).toBe(
      "Europe/Istanbul",
    );
  });

  it("bayrak AÇIK olsa bile doğrulama katmanı aynen çalışır", () => {
    const on = env({ APP_TRUST_BROWSER_TIMEZONE: "1" });
    expect(resolveNewOrgTimezone("Mars/Olympus", on)).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone("A".repeat(5000), on)).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone(42, on)).toBe("Europe/Istanbul");
    expect(() => resolveNewOrgTimezone(null, on)).not.toThrow();
  });
});

describe("resolveNewOrgTimezone — doğrulama (bayraktan bağımsız)", () => {
  it("eksik/boş değer → deployment varsayılanı", () => {
    expect(resolveNewOrgTimezone(undefined, env({}))).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone("", env({}))).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone("   ", env({}))).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone(undefined, env({ APP_DEFAULT_TIMEZONE: "Europe/Berlin" }))).toBe(
      "Europe/Berlin",
    );
  });

  it("geçersiz/düşmanca girdi → varsayılan; ASLA fırlatmaz", () => {
    const hostile: unknown[] = [
      "Mars/Olympus",
      "'; DROP TABLE Organization; --",
      "../../etc/passwd",
      "A".repeat(5000), // uzun çöp: Intl'e hiç gitmeden reddedilmeli
      42,
      null,
      {},
      [],
      true,
    ];
    for (const v of hostile) {
      expect(() => resolveNewOrgTimezone(v, env({}))).not.toThrow();
      expect(resolveNewOrgTimezone(v, env({}))).toBe("Europe/Istanbul");
    }
  });

  it("deployment varsayılanının KENDİSİ de doğrulanır (çöp varsayılan sızmaz)", () => {
    expect(resolveNewOrgTimezone(undefined, env({ APP_DEFAULT_TIMEZONE: "Mars/Olympus" }))).toBe(
      DEFAULT_TIMEZONE,
    );
  });

  it("saat dilimi para biriminden veya locale'den TAHMİN EDİLMEZ", () => {
    // Almanca arayüz + euro faturalama: hiçbiri saat dilimini oynatmaz.
    const money = {
      APP_LOCALE: "de-DE",
      APP_BILLING_CURRENCY: "EUR",
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "3900",
      PLAN_PRICE_ISLETME_MINOR: "7900",
    };
    expect(appDefaultTimezone(env(money))).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone(undefined, env(money))).toBe("Europe/Istanbul");
    // Dördüncü bağımsız girdi: EUR faturalama tarayıcı-güvenini de AÇMAZ.
    expect(trustsBrowserTimezone(env(money))).toBe(false);
    expect(resolveNewOrgTimezone("Europe/Berlin", env(money))).toBe("Europe/Istanbul");
    // Ters yön de doğru: güven açıkken bile İstanbul dilimi EUR'yu iptal etmez.
    const both = env({ ...money, APP_TRUST_BROWSER_TIMEZONE: "1" });
    expect(resolveNewOrgTimezone("Europe/Istanbul", both)).toBe("Europe/Istanbul");
  });
});

describe("org yaratan yollar — kapalı liste", () => {
  it("WRITER HARİTASI PİNİ: Organization yaratan HER yol dilimi AÇIKÇA yazar", async () => {
    // Kayıt rotasını düzeltmek yetmiyordu: operatör panelinden yaratılan müşteri
    // org'u da şema varsayılanına düşüyordu (.com'da doğru, .eu'da değil). Bu pin
    // İLERİDE eklenecek üçüncü bir yaratıcının aynı sessiz varsayılana düşmesini
    // engeller — listeye girmeden fark edilmemesi imkânsız.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const creators = new Map<string, string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) {
          const src = readFileSync(p, "utf8");
          if (/\borganization\.create\s*\(/.test(src)) {
            creators.set(p.replace(/\\/g, "/").replace(/^.*?src\//, "src/"), src);
          }
        }
      }
    };
    walk("src");

    expect([...creators.keys()].sort()).toEqual([
      "src/app/api/admin/customers/route.ts", // operatör → deployment varsayılanı
      "src/app/api/auth/register/route.ts", //   kayıt → resolveNewOrgTimezone (bayrağa bağlı)
    ]);

    // Her biri create çağrısında timezone GEÇİRMELİ — şema varsayılanına
    // güvenmek .com dışında yanlış cevaptır.
    for (const [file, src] of creators) {
      const call = src.match(/organization\.create\s*\(([\s\S]{0,400})/);
      expect(call, `${file}: organization.create okunamadı`).not.toBeNull();
      expect(call![1], `${file}: create çağrısında timezone YOK`).toMatch(/timezone/);
    }
  });
});

describe("boot kapısı — APP_DEFAULT_TIMEZONE", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a-real-production-secret-value-32ch",
    ENCRYPTION_KEY: "a-different-real-production-key-32c",
    DATABASE_URL: "postgresql://u@h:5432/d",
    RESEND_API_KEY: "re_x",
  } as unknown as Record<string, string | undefined>;
  const tzErrors = (e: Record<string, string | undefined>) =>
    checkProductionEnv(e).errors.filter((x: string) => x.includes("APP_DEFAULT_TIMEZONE"));

  it("verilmezse hata YOK (.com bozulmaz)", () => {
    expect(tzErrors({ ...base })).toEqual([]);
  });

  it("geçerli IANA → hata YOK", () => {
    expect(tzErrors({ ...base, APP_DEFAULT_TIMEZONE: "Europe/Berlin" })).toEqual([]);
  });

  it("geçersiz değer → HATA (sessizce İstanbul'a düşen bir .eu istemiyoruz)", () => {
    expect(tzErrors({ ...base, APP_DEFAULT_TIMEZONE: "Mars/Olympus" }).length).toBeGreaterThan(0);
    expect(tzErrors({ ...base, APP_DEFAULT_TIMEZONE: "Europe" }).length).toBeGreaterThan(0);
  });
});
