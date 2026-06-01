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
