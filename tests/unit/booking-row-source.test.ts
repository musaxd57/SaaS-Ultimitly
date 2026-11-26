import { describe, expect, it } from "vitest";
import {
  bookingRowSourceClass,
  isRemovableBookingRowClass,
  REMOVABLE_BOOKING_ROW_WHERE,
  type BookingRowSourceFacts,
} from "@/lib/booking-row-source";

// ---------------------------------------------------------------------------
// UA-1 (kurucu 11-19): rezervasyon satırının kaynak sınıfı — karşılaştırma sayfasında YALNIZ elle / dosya satırı kaldırılabilir.
// Değerler yazan kodlardan (sync.ts · import/route.ts · reservations/route.ts · write-service.ts · calendar-sources/[id]) okundu.
// ---------------------------------------------------------------------------

const row = (over: Partial<BookingRowSourceFacts>): BookingRowSourceFacts => ({
  calendarSourceId: null,
  connectionId: null,
  channel: "manual",
  guestNameSource: "host",
  ...over,
});

describe("bookingRowSourceClass", () => {
  it("elle tek kayıt (referanslı → kanal 'manual', ad kökeni 'host') → manual", () => {
    expect(bookingRowSourceClass(row({}))).toBe("manual");
  });

  it("CSV (kanal 'manual' + ad kökeni 'file') → file; .ics dosyası (kanal 'ics') → file", () => {
    expect(bookingRowSourceClass(row({ guestNameSource: "file" }))).toBe("file");
    expect(bookingRowSourceClass(row({ channel: "ics", guestNameSource: "file" }))).toBe("file");
    // Ad kökeni sonradan değişmiş / boş .ics satırı da dosyadır (kanal işareti yeter).
    expect(bookingRowSourceClass(row({ channel: "ics", guestNameSource: null }))).toBe("file");
  });

  it("öksüz besleme satırı (kaynak silinince kanal 'manual', ad kökeni 'calendar') ve kökeni bilinmeyen eski satır → manual", () => {
    expect(bookingRowSourceClass(row({ guestNameSource: "calendar" }))).toBe("manual");
    expect(bookingRowSourceClass(row({ guestNameSource: null }))).toBe("manual");
  });

  it("🚨 takvim kimliği varsa kanal etiketi ne olursa olsun takvim (silinemez)", () => {
    for (const channel of ["airbnb", "other", "manual", "ics"]) {
      expect(bookingRowSourceClass(row({ calendarSourceId: "cs-1", channel }))).toBe("calendar");
    }
  });

  it("🚨 bağlantı kimliği varsa kanal (silinemez) — 'manual' etiketli olsa da", () => {
    expect(bookingRowSourceClass(row({ connectionId: "conn-1", channel: "airbnb", guestNameSource: "channel" }))).toBe("channel");
    expect(bookingRowSourceClass(row({ connectionId: "conn-1" }))).toBe("channel");
  });

  it("🚨 güvenli yön: bağlantısız kanal satırı (eski ortam belirteci), bilinmeyen / boş kanal etiketi → kanal (silinemez)", () => {
    expect(bookingRowSourceClass(row({ channel: "airbnb", guestNameSource: "channel" }))).toBe("channel");
    expect(bookingRowSourceClass(row({ channel: "direct", guestNameSource: "placeholder" }))).toBe("channel");
    expect(bookingRowSourceClass(row({ channel: "" }))).toBe("channel");
    expect(bookingRowSourceClass(row({ channel: "Manual" }))).toBe("channel");
    expect(bookingRowSourceClass(row({ channel: "mystery", guestNameSource: "host" }))).toBe("channel");
  });

  it("kaldırılabilir sınıflar yalnız elle ve dosya", () => {
    expect(isRemovableBookingRowClass("manual")).toBe(true);
    expect(isRemovableBookingRowClass("file")).toBe(true);
    expect(isRemovableBookingRowClass("calendar")).toBe(false);
    expect(isRemovableBookingRowClass("channel")).toBe(false);
  });
});

describe("REMOVABLE_BOOKING_ROW_WHERE — saf kuralın sorgu ikizi (iki yön)", () => {
  /** Sorgu nesnesinin anlamı (Prisma: `null` = IS NULL; `OR` = kanal eşitliklerinden biri; anahtarlar AND). */
  function matches(where: typeof REMOVABLE_BOOKING_ROW_WHERE, r: BookingRowSourceFacts): boolean {
    return (
      Object.keys(where).sort().join(",") === "OR,calendarSourceId,connectionId" &&
      where.calendarSourceId === null &&
      r.calendarSourceId === null &&
      where.connectionId === null &&
      r.connectionId === null &&
      where.OR.every((c) => Object.keys(c).join(",") === "channel") &&
      where.OR.some((c) => c.channel === r.channel)
    );
  }

  it("her bileşimde sorgu ⟺ saf kural", () => {
    const facts: BookingRowSourceFacts[] = [];
    for (const calendarSourceId of [null, "cs-1"])
      for (const connectionId of [null, "conn-1"])
        for (const channel of ["manual", "ics", "airbnb", "booking", "direct", "other", "", "Manual"])
          for (const guestNameSource of [null, "host", "file", "calendar", "channel", "placeholder"])
            facts.push({ calendarSourceId, connectionId, channel, guestNameSource });
    let removable = 0;
    for (const f of facts) {
      const pure = isRemovableBookingRowClass(bookingRowSourceClass(f));
      if (pure) removable++;
      expect(matches(REMOVABLE_BOOKING_ROW_WHERE, f), JSON.stringify(f)).toBe(pure);
    }
    // Anti-vakum: iki yön de gerçekten görüldü.
    expect(removable).toBe(2 * 6);
    expect(facts.length - removable).toBeGreaterThan(100);
  });
});
