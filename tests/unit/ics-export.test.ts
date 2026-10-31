import { describe, it, expect } from "vitest";
import { buildIcsCalendar, generateCalendarToken, type IcsEvent } from "@/lib/export/ics";

const sample: IcsEvent[] = [
  {
    uid: "res-1@guestops-ai",
    summary: "Rezervasyon — Ayşe Yılmaz",
    start: new Date("2026-07-01T12:00:00Z"),
    end: new Date("2026-07-05T12:00:00Z"),
    description: "Misafir: Ayşe Yılmaz\nKanal: airbnb",
    allDay: true,
  },
];

describe("buildIcsCalendar", () => {
  it("produces a valid VCALENDAR envelope", () => {
    const ics = buildIcsCalendar("Galata Loft", sample);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:Galata Loft");
  });

  it("emits one VEVENT per reservation with all-day dates", () => {
    const ics = buildIcsCalendar("Test", sample);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("UID:res-1@guestops-ai");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("DTEND;VALUE=DATE:20260705");
    expect(ics).toContain("SUMMARY:Rezervasyon — Ayşe Yılmaz");
  });

  it("escapes commas, semicolons and newlines in text", () => {
    const ics = buildIcsCalendar("Name, with; chars", [
      { ...sample[0], summary: "A, B; C", description: "line1\nline2" },
    ]);
    expect(ics).toContain("X-WR-CALNAME:Name\\, with\\; chars");
    expect(ics).toContain("SUMMARY:A\\, B\\; C");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });

  it("uses CRLF line endings", () => {
    const ics = buildIcsCalendar("Test", sample);
    expect(ics).toContain("\r\n");
  });

  it("handles an empty reservation list", () => {
    const ics = buildIcsCalendar("Empty", []);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("generateCalendarToken", () => {
  it("returns a long, dash-free, unique token", () => {
    const a = generateCalendarToken();
    const b = generateCalendarToken();
    expect(a).not.toContain("-");
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });
});

// U36 (Codex 10-07): satır katlama UTF-8 OKTET sayar ve kod noktasını bölmez (eskiden UTF-16 birimi sayıyordu: sınırdaki emoji
// yalnız vekil çiftine bölünüp "��" oluyordu, 70 Çince karakter 209 bayttı). ASCII çıktı birebir aynı.
describe("U36 — ICS satır katlama UTF-8 güvenli", () => {
  const unfold = (ics: string) => ics.replace(/\r\n /g, "");
  const ev = (summary: string): IcsEvent[] => [
    { uid: "u1@x", summary, start: new Date("2026-07-01T12:00:00Z"), end: new Date("2026-07-02T12:00:00Z"), allDay: true },
  ];
  it.each([
    ["emoji sınırda", `${"A".repeat(66)}🏖️ Tatil ${"🙂".repeat(20)}`],
    ["Çince", "预订".repeat(35)],
    ["Türkçe", "Rezervasyon — Şükrü Çağlayan, İğdır'dan gelen misafir; ğüşıöç ĞÜŞİÖÇ ".repeat(3)],
  ])("%s: her satır ≤75 bayt, açılınca metin birebir", (_n, summary) => {
    const ics = buildIcsCalendar("Lale", ev(summary));
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    // Hiçbir satır yalnız vekil (yarım emoji) taşımaz: UTF-8'e kodlayıp geri okumak satırı değiştirmez.
    for (const line of ics.split("\r\n")) expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
    const folded = unfold(ics);
    expect(folded).toContain(`SUMMARY:${summary.replace(/,/g, "\\,").replace(/;/g, "\\;")}`);
  });
  it("KONTROL: ASCII satır 75 / 74 karakterde katlanır (eski davranışla aynı)", () => {
    const ics = buildIcsCalendar("Lale", ev("x".repeat(200)));
    const lines = ics.split("\r\n").filter((l) => l.startsWith("SUMMARY:") || l.startsWith(" x"));
    expect(lines[0].length).toBe(75);
    expect(lines[1].length).toBe(75); // " " + 74
  });
});
