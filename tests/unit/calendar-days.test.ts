import { describe, it, expect } from "vitest";
import { daysUntilDate } from "@/lib/utils";

const IST = "Europe/Istanbul";

describe("daysUntilDate", () => {
  // The Görevler "Bugün" filter must agree with the date shown on the card
  // (formatDate, UTC-pinned). A reservation dated today can be stored at any time
  // of day depending on the import path — these all have to read as "today" (0).
  it("reads a today-dated task as 0 regardless of the stored hour", () => {
    const now = new Date("2026-06-10T17:10:00.000Z"); // 20:10 Istanbul, June 10
    for (const hour of ["00:00", "09:00", "12:00", "20:59", "21:00", "23:59"]) {
      const due = new Date(`2026-06-10T${hour}:00.000Z`);
      expect(daysUntilDate(due, now, IST)).toBe(0);
    }
  });

  it("REGRESSION: an evening-UTC today date (Istanbul already tomorrow) is still 0", () => {
    // This is the exact bug: dueAt 21:00Z is June 11 in Istanbul, so the old
    // Istanbul-based diff returned 1 and hid it from "Bugün" — even though the
    // card shows "10 Haz". UTC-day bucketing keeps label and filter in sync.
    const now = new Date("2026-06-10T17:10:00.000Z");
    expect(daysUntilDate(new Date("2026-06-10T21:00:00.000Z"), now, IST)).toBe(0);
  });

  it("counts tomorrow as 1 and yesterday as -1", () => {
    const now = new Date("2026-06-10T17:10:00.000Z");
    expect(daysUntilDate(new Date("2026-06-11T12:00:00.000Z"), now, IST)).toBe(1);
    expect(daysUntilDate(new Date("2026-06-09T12:00:00.000Z"), now, IST)).toBe(-1);
  });

  it("uses the host's Istanbul day for 'today' past the 21:00Z boundary", () => {
    // 22:00Z June 10 is 01:00 June 11 in Istanbul → the host's today is June 11.
    const now = new Date("2026-06-10T22:00:00.000Z");
    expect(daysUntilDate(new Date("2026-06-11T12:00:00.000Z"), now, IST)).toBe(0);
    expect(daysUntilDate(new Date("2026-06-10T12:00:00.000Z"), now, IST)).toBe(-1);
  });
});
