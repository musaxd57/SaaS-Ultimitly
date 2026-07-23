import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  orgTimezone,
  zonedDayRange,
  zonedDateStart,
  addZonedDays,
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

// ---------------------------------------------------------------------------
// DST düzeltmesi (Codex 07-23 #4): Berlin/Roma gibi dilimlerde bazı günler 23
// veya 25 saattir. Eski zonedDayRange "start + sabit 24h" kullanıyordu → geçiş
// günlerinde pencere 1 saat kayıyordu; Türkiye'de görünmez (DST yok). EU kuralı:
// Mart'ın son Pazar'ı 01:00Z (CET→CEST) · Ekim'in son Pazar'ı 01:00Z (CEST→CET).
// ---------------------------------------------------------------------------
describe("DST — Berlin 23/25 saatlik günler (Codex 07-23 #4)", () => {
  it("zonedDayRange: 2026-03-29 (ileri alma) Berlin günü tam 23 saat", () => {
    const { start, end } = zonedDayRange(new Date("2026-03-29T12:00:00Z"), "Europe/Berlin");
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z"); // yerel geceyarısı (CET +1)
    expect(end.toISOString()).toBe("2026-03-29T21:59:59.999Z"); // ERTESİ yerel geceyarısı (CEST +2) − 1ms
    expect(end.getTime() - start.getTime() + 1).toBe(23 * 60 * 60 * 1000);
  });

  it("zonedDayRange: 2026-10-25 (geri alma) Berlin günü tam 25 saat", () => {
    const { start, end } = zonedDayRange(new Date("2026-10-25T12:00:00Z"), "Europe/Berlin");
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z"); // CEST +2
    expect(end.toISOString()).toBe("2026-10-25T22:59:59.999Z"); // CET +1
    expect(end.getTime() - start.getTime() + 1).toBe(25 * 60 * 60 * 1000);
  });

  it("Istanbul (DST yok): gün her zaman tam 24 saat (regresyon pini)", () => {
    const { start, end } = zonedDayRange(new Date("2026-03-29T12:00:00Z"), "Europe/Istanbul");
    expect(end.getTime() - start.getTime() + 1).toBe(24 * 60 * 60 * 1000);
  });

  it("zonedDateStart geçişin iki yanında doğru yerel geceyarısını verir", () => {
    expect(zonedDateStart(2026, 3, 29, "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(zonedDateStart(2026, 3, 30, "Europe/Berlin").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(zonedDateStart(2026, 10, 25, "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(zonedDateStart(2026, 10, 26, "Europe/Berlin").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("addZonedDays: TAKVİM günü ekler (sabit 24h değil); gün-yürüyüşleri DST'de kaymaz", () => {
    const d0 = zonedDateStart(2026, 3, 29, "Europe/Berlin"); // 23 saatlik günün başı
    const d1 = addZonedDays(d0, 1, "Europe/Berlin");
    expect(d1.toISOString()).toBe("2026-03-29T22:00:00.000Z"); // 23 saat sonra — 24 değil
    expect(addZonedDays(d1, -1, "Europe/Berlin").toISOString()).toBe(d0.toISOString()); // ters yön simetrik
    const o0 = zonedDateStart(2026, 10, 25, "Europe/Berlin"); // 25 saatlik gün
    expect(addZonedDays(o0, 1, "Europe/Berlin").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    // Istanbul: 24h ile birebir aynı (davranış değişikliği yok).
    const i0 = zonedDateStart(2026, 7, 16, "Europe/Istanbul");
    expect(addZonedDays(i0, 3, "Europe/Istanbul").getTime()).toBe(i0.getTime() + 3 * 24 * 60 * 60 * 1000);
  });
});
