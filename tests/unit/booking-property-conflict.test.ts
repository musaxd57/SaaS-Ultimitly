import { describe, it, expect } from "vitest";
import {
  BOOKING_ENDED_SLACK_MS,
  activePropertyIdsOf,
  isActiveBookingRow,
  isActiveBookingStatus,
  spansMultipleProperties,
} from "@/lib/booking-property-conflict";

// Kurucu 11-18 akşam: aynı rezervasyon iki FARKLI dairede ETKİN kayıtlıysa sistem daire tahmin etmez (otomatik mesaj tutulur).
// Etkin = iptal edilmemiş + konaklaması bitmemiş. Saf yüklemler; veritabanı yok.

const NOW = new Date("2026-11-18T10:00:00Z");
const row = (propertyId: string, status = "confirmed", endsInMs = 3 * 86_400_000) => ({ propertyId, status, departureDate: new Date(NOW.getTime() + endsInMs) });

describe("iki farklı dairede etkin kayıt", () => {
  it("iptal yazımları etkin değildir; bekliyor / onaylı / tamamlandı etkindir", () => {
    expect(["cancelled", "canceled", "Cancelled", "CANCELED"].map(isActiveBookingStatus)).toEqual([false, false, false, false]);
    expect(["pending", "confirmed", "completed"].map(isActiveBookingStatus)).toEqual([true, true, true]);
  });

  it("konaklaması biten kayıt etkin değildir — pay tam iki gün (çıkış günü içindeki kayıt her saat diliminde bitmemiş sayılır)", () => {
    expect(isActiveBookingRow(row("a", "confirmed", -BOOKING_ENDED_SLACK_MS), NOW)).toBe(true); // tam sınır: hâlâ etkin
    expect(isActiveBookingRow(row("a", "confirmed", -BOOKING_ENDED_SLACK_MS - 1), NOW)).toBe(false);
    expect(isActiveBookingRow(row("a", "confirmed", -30 * 86_400_000), NOW)).toBe(false); // bir ay önce bitmiş bayat kopya
    expect(isActiveBookingRow(row("a", "cancelled"), NOW)).toBe(false);
  });

  it("🚨 iki AYRI dairede etkin kayıt → çatışma; aynı dairede iki kayıt, tek kayıt ya da boş liste → çatışma yok", () => {
    expect(spansMultipleProperties([row("a"), row("b")], NOW)).toBe(true);
    expect(spansMultipleProperties([row("a"), row("a")], NOW)).toBe(false);
    expect(spansMultipleProperties([row("a")], NOW)).toBe(false);
    expect(spansMultipleProperties([], NOW)).toBe(false);
  });

  it("🚨 öteki dairedeki kayıt iptal ya da bitmişse çatışma YOK; 'bekliyor' ise VAR", () => {
    expect(spansMultipleProperties([row("a"), row("b", "cancelled")], NOW)).toBe(false);
    expect(spansMultipleProperties([row("a"), row("b", "confirmed", -30 * 86_400_000)], NOW)).toBe(false);
    expect(spansMultipleProperties([row("a"), row("b", "pending")], NOW)).toBe(true);
    // Üç daire, ikisi etkin değil → kalan tek daire.
    expect(spansMultipleProperties([row("a"), row("b", "cancelled"), row("c", "completed", -10 * 86_400_000)], NOW)).toBe(false);
  });

  it("panel satırının daireleri: yalnız ETKİN satırların daireleri, tekil, ilk görülme sırasıyla; tutma yüklemiyle aynı karar", () => {
    expect(activePropertyIdsOf([row("b"), row("a"), row("b")], NOW)).toEqual(["b", "a"]);
    expect(activePropertyIdsOf([row("a"), row("b", "cancelled"), row("c", "confirmed", -BOOKING_ENDED_SLACK_MS - 1)], NOW)).toEqual(["a"]);
    expect(activePropertyIdsOf([], NOW)).toEqual([]);
    const cases = [
      [row("a"), row("b")],
      [row("a"), row("a")],
      [row("a"), row("b", "canceled")],
      [row("a"), row("b", "pending"), row("c")],
    ];
    for (const rows of cases) expect(activePropertyIdsOf(rows, NOW).length > 1).toBe(spansMultipleProperties(rows, NOW));
  });
});
