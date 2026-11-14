import { describe, it, expect } from "vitest";
import { __wallClockCacheSize, canonicalTimeZone, shiftZonedDaysKeepingWallClock } from "@/lib/timezone";
import { resolveNewOrgTimezone } from "@/lib/app-config";
import { __fmtCacheSize, formatDateTime } from "@/lib/utils";

// KANONİK SAAT DİLİMİ + SINIRLI BİÇİMLENDİRİCİ ÖNBELLEĞİ (sızma testi 11-14, L-7). Intl dilim adını harf duyarsız kabul eder; önbellekler ham
// dizeyle anahtarlanıyordu ve tavansızdı → işletme dilimini her seferinde başka bir harf biçimiyle kaydeden biri her varyantta kalıcı
// bir biçimlendirici bırakıyordu (bellek sızıntısı; dilim başına binlerce varyant).
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
/** Yalnız HARF konumlarında büyük / küçük kombinasyonları — i'nin bitleri harfleri seçer, her i farklı bir varyant. */
function caseVariants(base: string, n: number): string[] {
  const letters = [...base].map((c, idx) => (/[a-z]/.test(c) ? idx : -1)).filter((idx) => idx >= 0);
  return Array.from({ length: n }, (_, i) => [...base].map((c, idx) => ((i >> letters.indexOf(idx)) & 1 && letters.includes(idx) ? c.toUpperCase() : c)).join(""));
}

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
    const d = new Date("2026-11-14T10:00:00Z");
    const expected = formatDateTime(d, "Europe/Istanbul");
    const variants = caseVariants("europe/istanbul", 1_500);
    expect(new Set(variants).size).toBe(1_500); // gerçekten 1.500 FARKLI varyant (mutasyon T3: "/" çevrilince tekrar ediyordu)
    for (const v of variants) expect(formatDateTime(d, v)).toBe(expected);
    expect(__fmtCacheSize()).toBeLessThanOrEqual(1_000);
  });

  it("🚨 duvar saati biçimlendiricisi de sınırlı (aynı sınıf)", () => {
    const d = new Date("2026-11-14T20:30:00Z");
    const expected = shiftZonedDaysKeepingWallClock(d, 1, "Europe/Istanbul").toISOString();
    for (const v of caseVariants("europe/istanbul", 1_200)) expect(shiftZonedDaysKeepingWallClock(d, 1, v).toISOString()).toBe(expected);
    expect(__wallClockCacheSize()).toBeLessThanOrEqual(1_000);
  });
});
