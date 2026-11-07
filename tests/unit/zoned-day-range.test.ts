import { describe, it, expect } from "vitest";
import { zonedDayRange } from "@/lib/automation";

describe("zonedDayRange", () => {
  it("spans the Istanbul (UTC+3) calendar day for an instant late in the UTC day", () => {
    // 2026-06-04 09:49 UTC == 2026-06-04 12:49 Istanbul → today is June 4 there.
    const now = new Date("2026-06-04T09:49:00.000Z");
    const { start, end } = zonedDayRange(now, "Europe/Istanbul");
    // Istanbul midnight June 4 == 21:00 UTC June 3.
    expect(start.toISOString()).toBe("2026-06-03T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-04T20:59:59.999Z");
  });

  it("rolls to the next local day once UTC crosses the 21:00 boundary", () => {
    // 2026-06-04 21:30 UTC == 2026-06-05 00:30 Istanbul → already June 5 there.
    const now = new Date("2026-06-04T21:30:00.000Z");
    const { start, end } = zonedDayRange(now, "Europe/Istanbul");
    expect(start.toISOString()).toBe("2026-06-04T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-05T20:59:59.999Z");
  });

  it("includes a reservation date stored as UTC midnight of that calendar day", () => {
    const now = new Date("2026-06-04T09:49:00.000Z");
    const { start, end } = zonedDayRange(now, "Europe/Istanbul");
    const storedJun4 = new Date("2026-06-04T00:00:00.000Z");
    expect(storedJun4 >= start && storedJun4 <= end).toBe(true);
    // A checkout the next day must NOT fall inside today's window.
    const storedJun5 = new Date("2026-06-05T00:00:00.000Z");
    expect(storedJun5 >= start && storedJun5 <= end).toBe(false);
  });
});
