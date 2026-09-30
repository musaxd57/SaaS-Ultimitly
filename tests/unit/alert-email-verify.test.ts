import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import {
  ALERT_EMAIL_VERIFY_TTL_MS,
  alertEmailVerifyEnabled,
  alertEmailVerifyHtml,
  signAlertEmailToken,
  verifyAlertEmailToken,
} from "@/lib/alert-email-verify";

// ---------------------------------------------------------------------------
// Uyarı adresi doğrulama belirteci (kurucu kararı 09-30). İmza + süre + alan ayrımı + biçim; e-posta kişiselleştirilmez.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-01T10:00:00.000Z");
const CLAIM = { organizationId: "org_1", email: "ops@example.net", previous: null as string | null };

describe("uyarı adresi doğrulama belirteci", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-0123456789abcdef"));
  afterEach(() => vi.unstubAllEnvs());

  it("imzalanan belirteç doğrulanır; önceki adres (null / dolu) taşınır", () => {
    expect(verifyAlertEmailToken(signAlertEmailToken(CLAIM, NOW), NOW)).toEqual(CLAIM);
    const withPrev = { ...CLAIM, previous: "owner@example.com" };
    expect(verifyAlertEmailToken(signAlertEmailToken(withPrev, NOW), NOW)).toEqual(withPrev);
  });

  it("24 saat geçerli: sınırda geçerli, sonrasında geçersiz", () => {
    const token = signAlertEmailToken(CLAIM, NOW)!;
    expect(verifyAlertEmailToken(token, new Date(NOW.getTime() + ALERT_EMAIL_VERIFY_TTL_MS))).toEqual(CLAIM);
    expect(verifyAlertEmailToken(token, new Date(NOW.getTime() + ALERT_EMAIL_VERIFY_TTL_MS + 1))).toBeNull();
  });

  it("🚨 gövde ya da imza değişirse geçersiz (başka adres / başka işletme yazılamaz)", () => {
    const token = signAlertEmailToken(CLAIM, NOW)!;
    const [body, mac] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ p: "alert-email", o: "org_2", e: "x@evil.test", v: null, x: NOW.getTime() + 1e6 })).toString(
      "base64url",
    );
    expect(verifyAlertEmailToken(`${forged}.${mac}`, NOW)).toBeNull();
    expect(verifyAlertEmailToken(`${body}.${mac.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(verifyAlertEmailToken(`${body}`, NOW)).toBeNull();
    expect(verifyAlertEmailToken(`.${mac}`, NOW)).toBeNull();
  });

  it("🚨 alan ayrımı: aynı sırla alan ETİKETİ OLMADAN imzalanmış gövde geçmez (başka özelliğin belirteci)", () => {
    const body = Buffer.from(JSON.stringify({ p: "alert-email", o: "org_1", e: "a@b.co", v: null, x: NOW.getTime() + 1e6 })).toString(
      "base64url",
    );
    const bare = createHmac("sha256", "test-secret-0123456789abcdef").update(body).digest("base64url");
    expect(verifyAlertEmailToken(`${body}.${bare}`, NOW)).toBeNull();
  });

  it("biçim: amaç etiketi yanlışsa, alan eksik / tipi yanlışsa geçersiz (imza doğru olsa da)", () => {
    const sign = (payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const mac = createHmac("sha256", "test-secret-0123456789abcdef").update(`lixus/alert-email-verify/v1.${body}`).digest("base64url");
      return `${body}.${mac}`;
    };
    const ok = { p: "alert-email", o: "org_1", e: "a@b.co", v: null, x: NOW.getTime() + 1e6 };
    expect(verifyAlertEmailToken(sign(ok), NOW)).toEqual({ organizationId: "org_1", email: "a@b.co", previous: null });
    expect(verifyAlertEmailToken(sign({ ...ok, p: "plan-change" }), NOW)).toBeNull();
    expect(verifyAlertEmailToken(sign({ ...ok, o: "" }), NOW)).toBeNull();
    expect(verifyAlertEmailToken(sign({ ...ok, e: 5 }), NOW)).toBeNull();
    expect(verifyAlertEmailToken(sign({ ...ok, v: 7 }), NOW)).toBeNull();
    expect(verifyAlertEmailToken(sign({ ...ok, x: "later" }), NOW)).toBeNull();
    expect(verifyAlertEmailToken(sign({ ...ok, o: undefined }), NOW)).toBeNull();
  });

  it("metin olmayan / aşırı uzun girdi geçersiz", () => {
    expect(verifyAlertEmailToken(undefined, NOW)).toBeNull();
    expect(verifyAlertEmailToken(12345, NOW)).toBeNull();
    expect(verifyAlertEmailToken("a".repeat(2_001), NOW)).toBeNull();
  });

  it("🚨 sır tanımlı değilse imzasız belirteç ÜRETİLMEZ ve hiçbiri doğrulanmaz", () => {
    const token = signAlertEmailToken(CLAIM, NOW)!;
    vi.stubEnv("AUTH_SECRET", "");
    expect(signAlertEmailToken(CLAIM, NOW)).toBeNull();
    expect(verifyAlertEmailToken(token, NOW)).toBeNull();
  });

  it("bayrak yalnız '1' ile açılır (varsayılan KAPALI)", () => {
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "");
    expect(alertEmailVerifyEnabled()).toBe(false);
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "true");
    expect(alertEmailVerifyEnabled()).toBe(false);
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "1");
    expect(alertEmailVerifyEnabled()).toBe(true);
  });
});

describe("doğrulama e-postası — kişiselleştirilmez", () => {
  it("bağlantı kaçışlı gömülür; işletme adı / kullanıcı metni için yer yoktur", () => {
    const html = alertEmailVerifyHtml('https://www.lixusai.com/uyari-adresi-dogrula#t=a"b<c');
    expect(html).toContain("Uyarı adresinizi doğrulayın");
    expect(html).toContain("Adresi onayla");
    expect(html).toContain("#t=a&quot;b&lt;c");
    expect(html).not.toContain('a"b<c');
    // İmza tek parametre: fonksiyon başka metin kabul etmez (kişiselleştirme yolu yok).
    expect(alertEmailVerifyHtml.length).toBe(1);
  });
});
