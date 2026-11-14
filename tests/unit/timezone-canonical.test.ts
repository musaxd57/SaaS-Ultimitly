import { describe, it, expect } from "vitest";
import { canonicalTimeZone } from "@/lib/timezone";
import { resolveNewOrgTimezone } from "@/lib/app-config";
import { __fmtCacheSize, formatDateTime } from "@/lib/utils";

// KANONİK SAAT DİLİMİ + SINIRLI BİÇİMLENDİRİCİ ÖNBELLEĞİ (sızma testi 11-14, L-7). Intl dilim adını harf duyarsız kabul eder; önbellekler ham
// dizeyle anahtarlanıyordu ve tavansızdı → işletme dilimini her seferinde başka bir harf biçimiyle kaydeden biri her varyantta kalıcı
// bir biçimlendirici bırakıyordu (bellek sızıntısı; dilim başına binlerce varyant).
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("canonicalTimeZone", () => {
  it("harf varyantı ve takma ad kanonik ada iner; geçersiz ad null", () => {
    expect(canonicalTimeZone("eUrOpE/iStAnBuL")).toBe("Europe/Istanbul");
    expect(canonicalTimeZone("Europe/Istanbul")).toBe("Europe/Istanbul");
    expect(canonicalTimeZone("utc")).toBe("UTC");
    expect(canonicalTimeZone("Mars/Olympus")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
  });
  it("yeni işletme dilimi (tarayıcıya güven açıkken) kanonik adla yazılır", () => {
    expect(resolveNewOrgTimezone("EUROPE/BERLIN", env({ APP_TRUST_BROWSER_TIMEZONE: "1" }))).toBe("Europe/Berlin");
  });
});

describe("biçimlendirici önbelleği sınırlı", () => {
  it("🚨 binlerce farklı harf varyantı önbelleği 1.000'in üstüne büyütmez; sonuç aynı kalır", () => {
    const base = "europe/istanbul";
    const d = new Date("2026-11-14T10:00:00Z");
    const expected = formatDateTime(d, "Europe/Istanbul");
    for (let i = 0; i < 1_500; i++) {
      // i'nin bitlerine göre harf büyüt — her i farklı bir varyant.
      const variant = [...base].map((c, j) => (i >> j) & 1 ? c.toUpperCase() : c).join("");
      expect(formatDateTime(d, variant)).toBe(expected);
    }
    expect(__fmtCacheSize()).toBeLessThanOrEqual(1_000);
  });
});
