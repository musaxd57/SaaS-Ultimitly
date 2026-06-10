import { describe, it, expect } from "vitest";
import { calendarDaysBetween } from "@/lib/utils";

const IST = "Europe/Istanbul";

describe("calendarDaysBetween", () => {
  it("treats an iCal/CSV checkout stored at local NOON as TODAY (the Görevler bug)", () => {
    // Tasks page used Math.round((dueAt - todayMidnightUTC)/86_400_000); a noon
    // dueAt is +0.5 day → round(0.5) = 1 → wrongly bucketed as "tomorrow" and
    // hidden from "Bugün". Calendar-day comparison must give 0.
    const now = new Date("2026-06-10T09:00:00.000Z"); // 12:00 Istanbul, June 10
    const noonStoredToday = new Date("2026-06-10T12:00:00.000Z"); // iCal/CSV style
    expect(calendarDaysBetween(now, noonStoredToday, IST)).toBe(0);
  });

  it("treats a Hospitable checkout stored at UTC midnight as TODAY", () => {
    const now = new Date("2026-06-10T09:00:00.000Z");
    const midnightStoredToday = new Date("2026-06-10T00:00:00.000Z"); // Hospitable style
    expect(calendarDaysBetween(now, midnightStoredToday, IST)).toBe(0);
  });

  it("counts tomorrow as 1 and yesterday as -1 regardless of time-of-day storage", () => {
    const now = new Date("2026-06-10T09:00:00.000Z");
    expect(calendarDaysBetween(now, new Date("2026-06-11T12:00:00.000Z"), IST)).toBe(1);
    expect(calendarDaysBetween(now, new Date("2026-06-09T12:00:00.000Z"), IST)).toBe(-1);
  });

  it("uses the Istanbul calendar day, not the UTC day, near the 21:00Z boundary", () => {
    // 22:00Z June 10 is already 01:00 June 11 in Istanbul. A checkout that same
    // Istanbul day (noon-stored June 11) must be TODAY (0), even though in raw
    // UTC the two instants straddle a date line.
    const now = new Date("2026-06-10T22:00:00.000Z"); // 01:00 Istanbul, June 11
    const sameIstanbulDay = new Date("2026-06-11T12:00:00.000Z");
    expect(calendarDaysBetween(now, sameIstanbulDay, IST)).toBe(0);
  });

  it("never returns 1 for a stay departing the very same Istanbul day", () => {
    // Guard the specific regression: any time-of-day on today's date is 0, not 1.
    const now = new Date("2026-06-10T05:00:00.000Z");
    for (const hour of ["00:00", "03:00", "09:00", "12:00", "20:59"]) {
      const due = new Date(`2026-06-10T${hour}:00.000Z`);
      expect(calendarDaysBetween(now, due, IST)).toBe(0);
    }
  });
});
