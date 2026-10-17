import { describe, it, expect } from "vitest";
import { parseIcs, parseIcsDetailed } from "@/lib/import/ics";

// parseIcsDate builds `new Date(y, m-1, d)`, which ROLLS OVER an impossible
// calendar date (Feb 31 → Mar 3) into a VALID Date rather than NaN — so the
// downstream isNaN guard never catches it and a booking would import on the WRONG
// day. The round-trip guard rejects it (→ null), and parseIcs skips events with an
// unparseable DTSTART/DTEND.

function ics(events: string): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", events, "END:VCALENDAR"].join("\n");
}
function event(uid: string, dtstart: string, dtend: string): string {
  return ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${dtstart}`, `DTEND;VALUE=DATE:${dtend}`, "SUMMARY:Guest", "END:VEVENT"].join("\n");
}

describe("parseIcs — invalid date-only rollover", () => {
  it("SKIPS an event whose DTSTART is an impossible calendar date (no silent rollover)", () => {
    // Feb 31 does not exist; the old code imported it as Mar 3.
    const rows = parseIcs(ics(event("bad-1", "20260231", "20260302")));
    expect(rows).toHaveLength(0);
  });

  it("SKIPS an event with an impossible DTEND too", () => {
    const rows = parseIcs(ics(event("bad-2", "20260215", "20260230"))); // Feb 30
    expect(rows).toHaveLength(0);
  });

  it("still imports a VALID date-only event on its exact day", () => {
    const rows = parseIcs(ics(event("ok-1", "20260215", "20260218")));
    expect(rows).toHaveLength(1);
    const d = rows[0].arrivalDate;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // February (0-indexed)
    expect(d.getDate()).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// U33 (Codex 10-07, 15c8663): ISO yedek yolu TZID'yi yok sayıyordu. `TZID=Europe/Istanbul:2026-08-05T23:00:00` temel biçimle
// (`20260805T230000`) AYNI ANI vermeli (20:00Z); eskiden `new Date()` sunucu saatinde okuyup 23:00Z yapıyordu — İstanbul'da gün
// kayıyordu. Kontrol: tarih-yalnız ISO ve Z / ofset taşıyan ISO değişmez.
// ---------------------------------------------------------------------------
function tzEvent(uid: string, start: string, end: string, tzid?: string): string {
  const p = tzid ? `;TZID=${tzid}` : "";
  return ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART${p}:${start}`, `DTEND${p}:${end}`, "SUMMARY:Guest", "END:VEVENT"].join("\n");
}
const firstArrival = (text: string) => parseIcs(ics(text))[0]?.arrivalDate?.toISOString();

describe("U33 — ofsetsiz ISO saat TZID'li temel biçimle aynı okunur", () => {
  it("🚨 TZID=Europe/Istanbul:2026-08-05T23:00:00 → 2026-08-05T20:00:00Z (temel biçimle birebir)", () => {
    const iso = firstArrival(tzEvent("u33a", "2026-08-05T23:00:00", "2026-08-08T11:00:00", "Europe/Istanbul"));
    const basic = firstArrival(tzEvent("u33b", "20260805T230000", "20260808T110000", "Europe/Istanbul"));
    expect(iso).toBe("2026-08-05T20:00:00.000Z"); // ⬅️ ARIZADA 2026-08-05T23:00:00.000Z (TZID yok sayıldı)
    expect(iso).toBe(basic);
  });

  it("saniyesiz ve küçük 't' biçimi de aynı kuraldan geçer", () => {
    expect(firstArrival(tzEvent("u33c", "2026-08-05T23:00", "2026-08-08T11:00", "Europe/Istanbul"))).toBe("2026-08-05T20:00:00.000Z");
    expect(firstArrival(tzEvent("u33d", "2026-08-05t23:00:00", "2026-08-08t11:00:00", "Europe/Istanbul"))).toBe("2026-08-05T20:00:00.000Z");
  });

  it("TZID'siz (floating) ofsetsiz ISO saat temel biçim gibi öğlen çapasına iner — sunucu dilimine bağlı değil", () => {
    const iso = firstArrival(tzEvent("u33e", "2026-08-05T23:00:00", "2026-08-08T11:00:00"));
    expect(iso).toBe(firstArrival(tzEvent("u33f", "20260805T230000", "20260808T110000")));
    expect(iso).toBe("2026-08-05T12:00:00.000Z");
  });

  it("takvimde olmayan ISO saat okunmaz (temel biçimle aynı)", () => {
    const r = parseIcsDetailed(ics(tzEvent("u33g", "2026-08-05T25:00:00", "2026-08-08T11:00:00", "Europe/Istanbul")));
    expect(r.events).toHaveLength(0);
    expect(r.incomplete).toContain("unreadable_event");
  });

  it("KONTROL: tarih-yalnız ISO ve Z / ofsetli ISO değişmez", () => {
    expect(firstArrival(tzEvent("u33h", "2026-08-05T23:00:00Z", "2026-08-08T11:00:00Z", "Europe/Istanbul"))).toBe("2026-08-05T23:00:00.000Z");
    expect(firstArrival(tzEvent("u33i", "2026-08-05T23:00:00+03:00", "2026-08-08T11:00:00+03:00"))).toBe("2026-08-05T20:00:00.000Z");
    expect(firstArrival(tzEvent("u33j", "2026-08-05", "2026-08-08"))).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("gece-4 S6-08: kaçış çözümü tek geçiş", () => {
  it("kaçışlı ters eğik çizgi + n satır sonu DEĞİL; \\n satır sonu; \\, ve \\; korunur", () => {
    const body = [
      "BEGIN:VEVENT",
      "UID:esc-1",
      "DTSTART;VALUE=DATE:20260215",
      "DTEND;VALUE=DATE:20260218",
      "SUMMARY:Guest",
      "DESCRIPTION:Line1\\nLine2 C:\\\\temp\\\\new\\, ok\\;",
      "END:VEVENT",
    ].join("\n");
    const [row] = parseIcs(ics(body));
    expect(row?.notes).toBe("Line1\nLine2 C:\\temp\\new, ok;");
  });
});

