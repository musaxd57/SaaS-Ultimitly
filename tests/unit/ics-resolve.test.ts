import { describe, it, expect } from "vitest";
import { parseIcsDetailed } from "@/lib/import/ics";
import { resolveIcsUidGroups } from "@/lib/import/ics-resolve";

// ---------------------------------------------------------------------------
// Tur 7 CAL-2 (kurucu onayı 11-05, Codex görüşüyle): aynı UID'nin satırları SIRADAN BAĞIMSIZ tek etkin satıra çözülür. Eski kural
// "ilk satır" idi: iptal edilmiş tekrar örneği / eski kopya canlı satırdan önce gelirse rezervasyon iptal oluyordu.
// Her vaka iki sırada da koşar — sonuç aynı olmalı.
// ---------------------------------------------------------------------------

const vevent = (lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR`;
const master = (uid: string, from: string, to: string, extra: string[] = []) =>
  vevent([`UID:${uid}`, `DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`, "SUMMARY:Reserved", ...extra]);
const instance = (uid: string, recId: string, from: string, to: string, extra: string[] = []) =>
  vevent([`UID:${uid}`, `RECURRENCE-ID;VALUE=DATE:${recId}`, `DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`, "SUMMARY:Reserved", ...extra]);

/** Her iki sırada çöz; ikisi aynı olmalı. Dönen: [tarih aralığı, durum] çiftleri. */
function resolveBothOrders(a: string, b: string) {
  const fwd = resolveIcsUidGroups(parseIcsDetailed(cal(a, b)).events);
  const rev = resolveIcsUidGroups(parseIcsDetailed(cal(b, a)).events);
  const shape = (rows: typeof fwd) =>
    rows.map((r) => `${r.sourceReference}|${r.arrivalDate.toISOString().slice(0, 10)}..${r.departureDate.toISOString().slice(0, 10)}|${r.status ?? "-"}`);
  expect(shape(rev)).toEqual(shape(fwd));
  return shape(fwd);
}

describe("ayrıştırıcı — sürüm ve örnek alanları", () => {
  it("RECURRENCE-ID, tekrar kuralı, SEQUENCE ve LAST-MODIFIED (yoksa DTSTAMP) okunur", () => {
    const [m, i, d] = parseIcsDetailed(
      cal(
        master("r-1", "20261110", "20261112", ["RRULE:FREQ=WEEKLY;COUNT=3", "SEQUENCE:4", "LAST-MODIFIED:20261101T100000Z"]),
        instance("r-1", "20261117", "20261117", "20261119", ["STATUS:CANCELLED"]),
        master("d-1", "20261120", "20261122", ["DTSTAMP:20261102T080000Z", "SEQUENCE:x"]),
      ),
    ).events;
    expect(m.recurrenceId).toBeNull();
    expect(m.hasRecurrenceRule).toBe(true);
    expect(m.sequence).toBe(4);
    expect(m.lastModified?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(i.recurrenceId).not.toBeNull();
    expect(i.recurrenceId!.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(i.hasRecurrenceRule).toBe(false);
    expect(d.lastModified?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(d.sequence).toBeNull(); // sayı olmayan SEQUENCE yok sayılır
  });
});

describe("çözücü — ana kayıt ile tekrar örneği ayrı", () => {
  it("🚨 tekrarlayan serinin İPTAL edilmiş örneği (ilk örneği dahil) ana kaydı iptal ETMEZ — iki sırada da dolu", () => {
    const m = master("s-1", "20261110", "20261112", ["RRULE:FREQ=WEEKLY;COUNT=4"]);
    expect(resolveBothOrders(m, instance("s-1", "20261117", "20261117", "20261119", ["STATUS:CANCELLED"]))).toEqual(["s-1|2026-11-10..2026-11-12|-"]);
    expect(resolveBothOrders(m, instance("s-1", "20261110", "20261110", "20261112", ["STATUS:CANCELLED"]))).toEqual(["s-1|2026-11-10..2026-11-12|-"]);
  });

  it("🚨 tek seferlik kaydın BAŞKA tarihli (var olmayan) örneğinin iptali kayda dokunmaz", () => {
    expect(
      resolveBothOrders(master("o-1", "20261110", "20261112"), instance("o-1", "20261201", "20261201", "20261203", ["STATUS:CANCELLED"])),
    ).toEqual(["o-1|2026-11-10..2026-11-12|-"]);
  });

  it("tek seferlik kaydın KENDİ başlangıcındaki örnek tek örnektir: iptali rezervasyonun iptalidir, taşınması tarihleri taşır", () => {
    const m = master("o-2", "20261110", "20261112");
    expect(resolveBothOrders(m, instance("o-2", "20261110", "20261110", "20261112", ["STATUS:CANCELLED"]))).toEqual([
      "o-2|2026-11-10..2026-11-12|CANCELLED",
    ]);
    expect(resolveBothOrders(m, instance("o-2", "20261110", "20261111", "20261113"))).toEqual(["o-2|2026-11-11..2026-11-13|-"]);
  });

  it("ana kaydı beslemede olmayan örnek: iptal uygulanmaz; canlı örnek dolu gece olarak alınır", () => {
    const only = resolveIcsUidGroups(parseIcsDetailed(cal(instance("x-1", "20261110", "20261110", "20261112", ["STATUS:CANCELLED"]))).events);
    expect(only).toEqual([]);
    expect(
      resolveBothOrders(
        instance("x-2", "20261110", "20261110", "20261112", ["STATUS:CANCELLED"]),
        instance("x-2", "20261117", "20261117", "20261119"),
      ),
    ).toEqual(["x-2|2026-11-17..2026-11-19|-"]);
  });
});

describe("çözücü — birden fazla ana kayıt", () => {
  it("🚨 sürüm bilgisi yokken iptal kopyası ÖNDE de olsa canlı kayıt kazanır (yıkıcı değişiklik yok)", () => {
    expect(resolveBothOrders(master("m-1", "20261110", "20261112", ["STATUS:CANCELLED"]), master("m-1", "20261110", "20261112"))).toEqual([
      "m-1|2026-11-10..2026-11-12|-",
    ]);
  });

  it("🚨 GERÇEK iptal çalışır: daha yüksek SEQUENCE'lı iptal, eski canlı kopyayı ezer (iki sırada da)", () => {
    expect(
      resolveBothOrders(master("m-2", "20261110", "20261112", ["SEQUENCE:2", "STATUS:CANCELLED"]), master("m-2", "20261110", "20261112", ["SEQUENCE:1"])),
    ).toEqual(["m-2|2026-11-10..2026-11-12|CANCELLED"]);
  });

  it("eşit SEQUENCE'ta daha yeni LAST-MODIFIED kazanır (her iki yön)", () => {
    const live = (lm: string) => master("m-3", "20261110", "20261112", ["SEQUENCE:1", `LAST-MODIFIED:${lm}`]);
    const gone = (lm: string) => master("m-3", "20261110", "20261112", ["SEQUENCE:1", `LAST-MODIFIED:${lm}`, "STATUS:CANCELLED"]);
    expect(resolveBothOrders(live("20261103T000000Z"), gone("20261102T000000Z"))).toEqual(["m-3|2026-11-10..2026-11-12|-"]);
    expect(resolveBothOrders(live("20261102T000000Z"), gone("20261103T000000Z"))).toEqual(["m-3|2026-11-10..2026-11-12|CANCELLED"]);
  });

  it("KONTROL — ayırt edilemeyen iki canlı kopyada besleme sırasındaki ilk kopya (b1: tarihler gidip gelmez); hepsi iptalse iptal", () => {
    const rows = resolveIcsUidGroups(parseIcsDetailed(cal(master("m-4", "20261110", "20261112"), master("m-4", "20261120", "20261122"))).events);
    expect(rows.map((r) => r.arrivalDate.toISOString().slice(0, 10))).toEqual(["2026-11-10"]);
    const a = master("m-5", "20261110", "20261112", ["STATUS:CANCELLED"]);
    const b = master("m-5", "20261110", "20261113", ["STATUS:CANCELLED"]);
    for (const text of [cal(a, b), cal(b, a)]) expect(resolveIcsUidGroups(parseIcsDetailed(text).events).map((r) => r.status)).toEqual(["CANCELLED"]);
  });

  it("KONTROL — UID'siz satırlar ve tek satırlı kayıtlar aynen, sıra korunur", () => {
    const rows = resolveIcsUidGroups(
      parseIcsDetailed(
        cal(
          vevent(["DTSTART;VALUE=DATE:20261101", "DTEND;VALUE=DATE:20261102", "SUMMARY:A"]),
          master("u-1", "20261105", "20261107", ["STATUS:CANCELLED"]),
          vevent(["DTSTART;VALUE=DATE:20261101", "DTEND;VALUE=DATE:20261102", "SUMMARY:B"]),
        ),
      ).events,
    );
    expect(rows.map((r) => `${r.sourceReference ?? r.guestName}|${r.status ?? "-"}`)).toEqual(["A|-", "u-1|CANCELLED", "B|-"]);
  });
});
