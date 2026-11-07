import { describe, it, expect } from "vitest";
import { daysUntilDate } from "@/lib/utils";

const IST = "Europe/Istanbul";

// daysUntilDate buckets a task by its Istanbul calendar day so the Görevler
// "Bugün" filter matches the dashboard's "Bugünkü Çıkışlar" (zonedDayRange), which
// the host trusts. Both use the Istanbul midnight boundary.
describe("daysUntilDate (Istanbul calendar day)", () => {
  it("reads a checkout anywhere in the Istanbul day as today (0)", () => {
    const now = new Date("2026-06-10T17:10:00.000Z"); // 20:10 Istanbul, June 10
    // Hospitable UTC-midnight (03:00 Istanbul), iCal local-noon, an 11:00 checkout:
    for (const z of ["00:00", "08:00", "12:00", "18:00"]) {
      expect(daysUntilDate(new Date(`2026-06-10T${z}:00.000Z`), now, IST)).toBe(0);
    }
  });

  it("treats a dueAt past the 21:00Z boundary as tomorrow, like the dashboard", () => {
    // 2026-06-10T21:00Z is already 00:00 June 11 in Istanbul → the dashboard's
    // zonedDayRange excludes it from June 10, so the task filter must too (1).
    const now = new Date("2026-06-10T17:10:00.000Z");
    expect(daysUntilDate(new Date("2026-06-10T21:00:00.000Z"), now, IST)).toBe(1);
  });

  it("counts tomorrow as 1 and yesterday as -1", () => {
    const now = new Date("2026-06-10T17:10:00.000Z");
    expect(daysUntilDate(new Date("2026-06-11T08:00:00.000Z"), now, IST)).toBe(1);
    expect(daysUntilDate(new Date("2026-06-09T08:00:00.000Z"), now, IST)).toBe(-1);
  });

  it("uses the host's Istanbul day for 'today' once UTC crosses 21:00Z", () => {
    const now = new Date("2026-06-10T22:00:00.000Z"); // 01:00 June 11 Istanbul
    expect(daysUntilDate(new Date("2026-06-11T08:00:00.000Z"), now, IST)).toBe(0);
    expect(daysUntilDate(new Date("2026-06-10T08:00:00.000Z"), now, IST)).toBe(-1);
  });
});
