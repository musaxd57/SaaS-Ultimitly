import { describe, it, expect } from "vitest";
import { parseIcs } from "@/lib/import/ics";

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
