import { describe, it, expect } from "vitest";
import { parseIcsDetailed } from "@/lib/import/ics";

// ---------------------------------------------------------------------------
// iCal içe alımı — 15 ajan incelemesi A09 (10-01, ölçüldü):
//  1. Etkinliğin İÇİNDEKİ alt bileşenin (VALARM / X-…) özellikleri etkinliğe yazılıyordu: Google dışa aktarımındaki hatırlatıcının
//     SUMMARY'si misafir adı ("Alarm notification"), iç bileşendeki "STATUS:CANCELLED" rezervasyonu İPTAL yapıyordu → müsaitlik
//     "boş" der → çift rezervasyon riski.
//  2. Tarih geri çekilmesi serbest `new Date()` idi: "2026" / "2027" bir yıllık konaklama, "1" / "12" 2001 yılı, "October 10, 2026"
//     sunucu diliminde okunuyordu. Artık yalnız RFC 5545 + ISO 8601 biçimi; dışı okunamayan etkinlik (F16: eksik okuma hüküm vermez).
//  3. NUL (U+0000) silinmiyordu → PostgreSQL `text` saklayamaz, o kaynağın yazması HER senkronda düşerdi.
// ---------------------------------------------------------------------------

const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...lines, "END:VCALENDAR"].join("\r\n");
const event = (inner: string[]) => ["BEGIN:VEVENT", ...inner, "END:VEVENT"];
const base = (uid = "abc@example") => [`UID:${uid}`, "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261012", "SUMMARY:Lale"];

describe("alt bileşenin özellikleri etkinliğe YAZILMAZ", () => {
  it("🚨 VALARM'ın SUMMARY / DESCRIPTION'ı misafir adı ve not olmaz (Google dışa aktarım biçimi)", () => {
    const r = parseIcsDetailed(
      cal(...event([...base(), "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M", "SUMMARY:Alarm notification", "DESCRIPTION:This is an event reminder", "END:VALARM"])),
    );
    expect(r.incomplete).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].guestName).toBe("Lale");
    expect(r.events[0].notes).toBeNull();
  });

  it("🚨 iç bileşendeki STATUS:CANCELLED / DTEND rezervasyonu iptal etmez, tarihini değiştirmez", () => {
    const r = parseIcsDetailed(
      cal(...event([...base("x1"), "BEGIN:X-LALE-META", "STATUS:CANCELLED", "DTEND;VALUE=DATE:20261030", "END:X-LALE-META"])),
    );
    expect(r.incomplete).toEqual([]);
    expect(r.events[0].status).toBeNull();
    expect(r.events[0].departureDate.toISOString()).toBe("2026-10-12T12:00:00.000Z");
  });

  it("alt bileşenden SONRA gelen etkinlik özellikleri yine okunur (iç içe iki düzey dahil)", () => {
    const r = parseIcsDetailed(
      cal(
        ...event([
          "UID:n1",
          "BEGIN:VALARM",
          "BEGIN:X-INNER",
          "SUMMARY:iç",
          "END:X-INNER",
          "TRIGGER:-PT5M",
          "END:VALARM",
          "DTSTART;VALUE=DATE:20261010",
          "DTEND;VALUE=DATE:20261012",
          "SUMMARY:Lale",
          "STATUS:CONFIRMED",
        ]),
      ),
    );
    expect(r.incomplete).toEqual([]);
    expect(r.events[0]).toMatchObject({ guestName: "Lale", status: "CONFIRMED", sourceReference: "n1" });
  });

  it("kapanmamış alt bileşenle biten etkinlik → eksik okuma (yapı bozuk); açılmamış alt bileşen bitişi de", () => {
    const open = parseIcsDetailed(cal(...event([...base("o1"), "BEGIN:VALARM", "TRIGGER:-PT5M"])));
    expect(open.incomplete).toEqual(["unreadable_event"]);
    const stray = parseIcsDetailed(cal(...event([...base("o2"), "END:VALARM"])));
    expect(stray.incomplete).toEqual(["unreadable_event"]);
  });

  it("KONTROL: alt bileşensiz etkinlik ve VTIMEZONE (etkinlik dışı) bugünkü gibi", () => {
    const tz = ["BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZNAME:CET", "END:STANDARD", "END:VTIMEZONE"];
    const r = parseIcsDetailed(cal(...tz, ...event([...base("k1"), "STATUS:CANCELLED"])));
    expect(r.incomplete).toEqual([]);
    expect(r.events[0]).toMatchObject({ guestName: "Lale", status: "CANCELLED" });
  });
});

describe("tarih yalnız RFC 5545 / ISO 8601 biçiminde okunur", () => {
  it.each([
    ["yalnız yıl", "2026", "2027"],
    ["çıplak rakam", "1", "12"],
    ["insan yazısı", "October 10, 2026", "October 12, 2026 23:30"],
    ["noktalı gün", "10.10.2026", "12.10.2026"],
  ])("🚨 %s → okunamayan etkinlik, uydurma konaklama YOK", (_ad, start, end) => {
    const r = parseIcsDetailed(cal(...event(["UID:y1", `DTSTART:${start}`, `DTEND:${end}`, "SUMMARY:x"])));
    expect(r.events).toHaveLength(0);
    expect(r.incomplete).toEqual(["unreadable_event"]);
  });

  it.each([
    ["RFC tarih", "20261010", "20261012", "2026-10-10T12:00:00.000Z"],
    ["RFC an (Z)", "20261010T150000Z", "20261012T090000Z", "2026-10-10T15:00:00.000Z"],
    ["ISO tarih", "2026-10-10", "2026-10-12", "2026-10-10T00:00:00.000Z"],
    ["ISO an + ofset", "2026-10-10T15:00:00+03:00", "2026-10-12T11:00:00+03:00", "2026-10-10T12:00:00.000Z"],
  ])("KONTROL: %s okunur", (_ad, start, end, iso) => {
    const r = parseIcsDetailed(cal(...event(["UID:k2", `DTSTART:${start}`, `DTEND:${end}`, "SUMMARY:x"])));
    expect(r.incomplete).toEqual([]);
    expect(r.events[0].arrivalDate.toISOString()).toBe(iso);
  });

  it("takvimde olmayan ISO günü okunmaz (30 Şubat)", () => {
    const r = parseIcsDetailed(cal(...event(["UID:k3", "DTSTART:2026-02-30", "DTEND:2026-03-02", "SUMMARY:x"])));
    expect(r.events).toHaveLength(0);
    expect(r.incomplete).toEqual(["unreadable_event"]);
  });
});

describe("NUL silinir", () => {
  it("🚨 SUMMARY / UID / DESCRIPTION'daki NUL kayda gitmez; başka karaktere dokunulmaz", () => {
    const r = parseIcsDetailed(
      cal(...event(["UID:ab\u0000c", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261012", "SUMMARY:La\u0000le Şen", "DESCRIPTION:not\u0000 1"])),
    );
    expect(r.events[0]).toMatchObject({ guestName: "Lale Şen", sourceReference: "abc", notes: "not 1" });
  });
});
