import { describe, it, expect } from "vitest";
import { bookingSourceLabel, bookingSourceLabelWithChannel, dayKeyLabel, nightsBetweenKeys, partyParts } from "@/lib/reservations/detail-format";

describe("rezervasyon sayfaları — ortak biçimleyiciler", () => {
  it("kaynak etiketi dört sınıf (karşılaştırma sayfasıyla AYNI metin)", () => {
    expect(bookingSourceLabel({ sourceClass: "manual", calendarSourceLabel: null })).toBe("Elle girildi");
    expect(bookingSourceLabel({ sourceClass: "file", calendarSourceLabel: null })).toBe("Dosyadan içe aktarıldı");
    expect(bookingSourceLabel({ sourceClass: "calendar", calendarSourceLabel: "Booking takvimi" })).toBe("Takvimden geliyor: Booking takvimi");
    expect(bookingSourceLabel({ sourceClass: "calendar", calendarSourceLabel: null })).toBe("Takvimden geliyor");
    expect(bookingSourceLabel({ sourceClass: "channel", calendarSourceLabel: null })).toBe("Kanaldan geliyor");
  });

  it("detayda yalnız bilinen kanal adı eklenir; elle / diğer / ics / bilinmeyen değer eklenmez", () => {
    const ch = (channel: string) => bookingSourceLabelWithChannel({ sourceClass: "channel", calendarSourceLabel: null, channel });
    expect(ch("airbnb")).toBe("Kanaldan geliyor · Airbnb");
    expect(ch("booking")).toBe("Kanaldan geliyor · Booking");
    expect(ch("other")).toBe("Kanaldan geliyor");
    expect(ch("x-unknown")).toBe("Kanaldan geliyor");
    expect(bookingSourceLabelWithChannel({ sourceClass: "manual", calendarSourceLabel: null, channel: "airbnb" })).toBe("Elle girildi");
  });

  it("gün etiketi ve gece sayısı (yarı açık aralık; ters / aynı gün 0; ay ve yıl sınırı)", () => {
    expect(dayKeyLabel("2026-11-23")).toBe("23 Kas 2026");
    expect(nightsBetweenKeys("2026-11-23", "2026-11-26")).toBe(3);
    expect(nightsBetweenKeys("2026-12-30", "2027-01-02")).toBe(3);
    expect(nightsBetweenKeys("2026-11-23", "2026-11-23")).toBe(0);
    expect(nightsBetweenKeys("2026-11-26", "2026-11-23")).toBe(0);
  });

  it("kişi sayısı yalnız yetişkin sayısı biliniyorsa; evcil hayvan yalnız > 0", () => {
    expect(partyParts({ adults: 2, children: 1, infants: 1, pets: 0 })).toEqual(["4 kişi"]);
    expect(partyParts({ adults: 1, children: null, infants: null, pets: 2 })).toEqual(["1 kişi", "2 evcil hayvan"]);
    expect(partyParts({ adults: null, children: 2, infants: null, pets: null })).toEqual([]);
    expect(partyParts({ adults: 0, children: 0, infants: 0, pets: 0 })).toEqual([]);
  });
});
