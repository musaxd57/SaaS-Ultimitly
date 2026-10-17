import { describe, it, expect } from "vitest";
import { buildIcalEvents, buildIcsCalendar } from "@/lib/export/ics";
import { parseIcs } from "@/lib/import/ics";

// ---------------------------------------------------------------------------
// CODEX 09-30 (A2): DIŞA AKTARILAN GÜN = TEK TARİH KURALI. Google Takvim / Vrbo / PMS beslemeleri saatli ve `TZID`li gelir
// (`DTSTART;TZID=Europe/Istanbul:20261005T000000`); içe aktarım bunu doğru AN olarak saklar (`2026-10-04T21:00Z`). Dışa aktarım
// günü UTC'den okuyordu → konaklama abone kanalda BİR GÜN ERKEN (4–7 Ekim) görünüyor, 7 Ekim gecesi boş kalıyordu → çift
// rezervasyon riski. Artık an, org diliminin günüdür; yalnız tarih (00:00Z / 12:00Z) aynen.
// ---------------------------------------------------------------------------

function feed(events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR", ""].join("\r\n");
}
function vevent(uid: string, start: string, end: string): string {
  return ["BEGIN:VEVENT", `UID:${uid}`, start, end, "SUMMARY:Rezervasyon", "END:VEVENT"].join("\r\n");
}

/** İçe aktar → rezervasyon satırı → dışa aktar; dışa aktarılan DTSTART / DTEND günleri. */
function roundTrip(ics: string, timeZone: string): Array<[string, string]> {
  const rows = parseIcs(ics).map((r, i) => ({
    id: `r${i}`,
    guestName: r.guestName,
    arrivalDate: r.arrivalDate,
    departureDate: r.departureDate,
    channel: "ics",
    sourceReference: r.sourceReference,
  }));
  const out = buildIcsCalendar("Lale 3", buildIcalEvents(rows, false, timeZone));
  const starts = [...out.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map((m) => m[1]);
  const ends = [...out.matchAll(/DTEND;VALUE=DATE:(\d{8})/g)].map((m) => m[1]);
  return starts.map((s, i) => [s, ends[i]]);
}

describe("iCal dışa aktarımı — gün org diliminde (Codex 09-30 A2)", () => {
  it("🚨 İstanbul: TZID'li gece yarısı girişi / çıkışı AYNI günlerle dışa aktarılır (eskiden bir gün erken)", () => {
    const ics = feed([vevent("a", "DTSTART;TZID=Europe/Istanbul:20261005T000000", "DTEND;TZID=Europe/Istanbul:20261008T000000")]);
    expect(roundTrip(ics, "Europe/Istanbul")).toEqual([["20261005", "20261008"]]);
  });

  it("🚨 İstanbul: UTC (Z) ile yazılmış yerel sabah saati de İstanbul günüdür", () => {
    const ics = feed([vevent("b", "DTSTART:20261004T220000Z", "DTEND:20261007T230000Z")]);
    expect(roundTrip(ics, "Europe/Istanbul")).toEqual([["20261005", "20261008"]]);
  });

  it("🚨 New York: geç saat girişi (UTC'de ertesi gün) New York günüyle dışa aktarılır", () => {
    const ics = feed([vevent("c", "DTSTART;TZID=America/New_York:20261005T210000", "DTEND;TZID=America/New_York:20261008T220000")]);
    expect(roundTrip(ics, "America/New_York")).toEqual([["20261005", "20261008"]]);
  });

  it("KONTROL — yalnız tarih (Airbnb / Booking biçimi) her dilimde aynen", () => {
    const ics = feed([vevent("d", "DTSTART;VALUE=DATE:20261005", "DTEND;VALUE=DATE:20261008")]);
    for (const tz of ["Europe/Istanbul", "America/New_York", "Pacific/Auckland", "UTC"]) {
      expect(roundTrip(ics, tz), tz).toEqual([["20261005", "20261008"]]);
    }
  });

  it("KONTROL — 00:00Z / 12:00Z çapalı saklı tarih dilimden bağımsız aynı gün", () => {
    const rows = [
      { id: "m", guestName: "", arrivalDate: new Date("2026-10-05T00:00:00Z"), departureDate: new Date("2026-10-08T12:00:00Z"), channel: null, sourceReference: null },
    ];
    for (const tz of ["Europe/Istanbul", "America/New_York", "Pacific/Auckland"]) {
      const out = buildIcsCalendar("x", buildIcalEvents(rows, false, tz));
      expect(out, tz).toContain("DTSTART;VALUE=DATE:20261005");
      expect(out, tz).toContain("DTEND;VALUE=DATE:20261008");
    }
  });
});
