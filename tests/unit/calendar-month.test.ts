import { describe, it, expect } from "vitest";
import { CALENDAR_MAX_YEAR, CALENDAR_MIN_YEAR, parseCalendarMonthParam } from "@/lib/calendar-month";

// Takvim `?month=` parametresi (G2 tur 4 T4-B13): biçim + makul yıl aralığı; dışındaki her değer varsayılan aya düşer (hata değil).
describe("parseCalendarMonthParam", () => {
  const FALLBACK = "2026-11";

  it("geçerli ay olduğu gibi döner (aralığın iki ucu dahil)", () => {
    expect(parseCalendarMonthParam("2026-05", FALLBACK)).toBe("2026-05");
    expect(parseCalendarMonthParam(`${CALENDAR_MIN_YEAR}-01`, FALLBACK)).toBe(`${CALENDAR_MIN_YEAR}-01`);
    expect(parseCalendarMonthParam(`${CALENDAR_MAX_YEAR}-12`, FALLBACK)).toBe(`${CALENDAR_MAX_YEAR}-12`);
  });

  it("🚨 aralık dışı yıl varsayılan aya düşer (9999-12 sorgu penceresini 10000. yıla taşıyordu; 0050 `Date.UTC`te 1950 olurdu)", () => {
    for (const raw of ["9999-12", "9999-11", "3000-01", "1969-12", "0050-01", "0000-01"]) expect(parseCalendarMonthParam(raw, FALLBACK), raw).toBe(FALLBACK);
  });

  it("biçim dışı değer varsayılan aya düşer", () => {
    for (const raw of [undefined, null, 42, "", "2026-13", "2026-00", "2026-5", "26-05", "2026-05-01", " 2026-05", "2026-05\u0000"]) {
      expect(parseCalendarMonthParam(raw, FALLBACK), String(raw)).toBe(FALLBACK);
    }
  });
});
