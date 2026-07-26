import { describe, it, expect } from "vitest";

import { appDefaultTimezone, resolveNewOrgTimezone } from "@/lib/app-config";
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

describe("resolveNewOrgTimezone — tarayıcı ipucu + doğrulama", () => {
  it("geçerli tarayıcı dilimi KULLANILIR (varsayılanı ezer)", () => {
    expect(resolveNewOrgTimezone("Europe/Berlin", env({}))).toBe("Europe/Berlin");
    expect(resolveNewOrgTimezone("America/New_York", env({}))).toBe("America/New_York");
    // Deployment varsayılanı Berlin olsa bile gerçek misafir dilimi kazanır.
    expect(resolveNewOrgTimezone("Asia/Dubai", env({ APP_DEFAULT_TIMEZONE: "Europe/Berlin" }))).toBe(
      "Asia/Dubai",
    );
  });

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
    const money = env({
      APP_LOCALE: "de-DE",
      APP_BILLING_CURRENCY: "EUR",
      PLAN_PRICE_BASLANGIC_MINOR: "1900",
      PLAN_PRICE_PRO_MINOR: "3900",
      PLAN_PRICE_ISLETME_MINOR: "7900",
    });
    expect(appDefaultTimezone(money)).toBe("Europe/Istanbul");
    expect(resolveNewOrgTimezone(undefined, money)).toBe("Europe/Istanbul");
    // Ters yön de doğru: İstanbul dilimi, EUR faturalamayı iptal etmez.
    expect(resolveNewOrgTimezone("Europe/Istanbul", money)).toBe("Europe/Istanbul");
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
