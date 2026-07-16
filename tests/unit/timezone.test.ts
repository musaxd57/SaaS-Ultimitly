import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  orgTimezone,
  zonedDayRange,
  zonedDateStart,
} from "@/lib/timezone";

// Org-timezone tek kaynağı. Kritik sözleşmeler: bozuk/boş değer ASLA Intl'e
// ulaşmaz (Istanbul'a düşer) ve takvim-günü → UTC-an eşlemesi UTC'nin hem
// doğusunda hem BATISINDA doğrudur (probe-date kısayolu batıda gün kaydırırdı).

describe("orgTimezone / isValidTimeZone", () => {
  it("null/boş/bozuk değer varsayılana düşer; geçerli IANA aynen döner", () => {
    expect(orgTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone("")).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone("Mars/Olympus")).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone("America/New_York")).toBe("America/New_York");
    expect(orgTimezone("Europe/Istanbul")).toBe("Europe/Istanbul");
  });

  it("isValidTimeZone kapalı-set + Intl-kurulabilirlik toleransı", () => {
    expect(isValidTimeZone("Europe/Istanbul")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("zonedDateStart — takvim günü → yerel-geceyarısı UTC anı", () => {
  it("Istanbul (UTC+3): 16 Tem 2026 günü 15 Tem 21:00Z'de başlar", () => {
    expect(zonedDateStart(2026, 7, 16, "Europe/Istanbul").toISOString()).toBe(
      "2026-07-15T21:00:00.000Z",
    );
  });

  it("New York (yaz, UTC-4): 16 Tem 2026 günü 16 Tem 04:00Z'de başlar — batı dilimi geriye değil İLERİYE gider", () => {
    expect(zonedDateStart(2026, 7, 16, "America/New_York").toISOString()).toBe(
      "2026-07-16T04:00:00.000Z",
    );
  });

  it("ay taşması Date.UTC gibi normalize olur (13. ay = ertesi yılın Ocak'ı)", () => {
    expect(zonedDateStart(2026, 13, 1, "Europe/Istanbul").getTime()).toBe(
      zonedDateStart(2027, 1, 1, "Europe/Istanbul").getTime(),
    );
    expect(zonedDateStart(2026, 1 - 1, 1, "Europe/Istanbul").getTime()).toBe(
      zonedDateStart(2025, 12, 1, "Europe/Istanbul").getTime(),
    );
  });

  it("zonedDayRange.start aynı an için dilime göre farklıdır (org-tz gerçekten etkili)", () => {
    const now = new Date("2026-07-16T10:00:00.000Z");
    const ist = zonedDayRange(now, "Europe/Istanbul").start.getTime();
    const ny = zonedDayRange(now, "America/New_York").start.getTime();
    expect(ist).not.toBe(ny);
    expect(ist).toBe(Date.parse("2026-07-15T21:00:00.000Z"));
    expect(ny).toBe(Date.parse("2026-07-16T04:00:00.000Z"));
  });
});
