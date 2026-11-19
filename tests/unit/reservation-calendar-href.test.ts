import { describe, it, expect } from "vitest";
import { reservationCalendarHref } from "@/lib/reservations/compare";

// ---------------------------------------------------------------------------
// "Rezervasyonu aç" hedefi (kurucu 11-19 akşam, madde 4): kaydın dairesine süzülmüş, varış ayındaki takvim. Ay, takvimin rezervasyonu
// yerleştirdiği günden (tek tarih kuralı `calendarDateOf`): yalnız tarih çapası (00:00Z / 12:00Z) UTC tarihidir, an olarak saklanan varış
// işletmenin saat diliminde okunur — ay sınırındaki varış başka aya düşmez.
// ---------------------------------------------------------------------------

describe("reservationCalendarHref", () => {
  it("yalnız tarih (00:00Z ve 12:00Z): UTC tarihinin ayı, saat dilimi kaydırmaz", () => {
    expect(reservationCalendarHref({ propertyId: "p1", arrivalDate: new Date("2026-12-01T00:00:00Z") }, "America/New_York")).toBe(
      "/calendar?property=p1&month=2026-12",
    );
    expect(reservationCalendarHref({ propertyId: "p1", arrivalDate: new Date("2026-11-30T12:00:00Z") }, "Europe/Istanbul")).toBe(
      "/calendar?property=p1&month=2026-11",
    );
  });

  it("🚨 an olarak saklanan varış işletmenin gününde: 30 Kasım 22:30Z İstanbul'da 1 Aralık → Aralık takvimi", () => {
    expect(reservationCalendarHref({ propertyId: "p1", arrivalDate: new Date("2026-11-30T22:30:00Z") }, "Europe/Istanbul")).toBe(
      "/calendar?property=p1&month=2026-12",
    );
    // KONTROL: aynı an UTC'de hâlâ Kasım.
    expect(reservationCalendarHref({ propertyId: "p1", arrivalDate: new Date("2026-11-30T22:30:00Z") }, "UTC")).toBe(
      "/calendar?property=p1&month=2026-11",
    );
  });

  it("daire kimliği adrese kodlanarak girer", () => {
    expect(reservationCalendarHref({ propertyId: "a&b c", arrivalDate: new Date("2027-01-05T00:00:00Z") }, "UTC")).toBe(
      "/calendar?property=a%26b%20c&month=2027-01",
    );
  });
});
