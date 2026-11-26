import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

describe("timestamp formatting timezone", () => {
  // Türkiye is UTC+3 year-round. A 14:12 UTC instant is 17:12 in Istanbul — the
  // displayed wall-clock time must match what Airbnb/Hospitable show the host,
  // not the server's UTC clock (the "3 saat geri" bug).
  const instant = new Date("2026-06-07T14:12:00Z");

  it("renders message date+time in Istanbul time (UTC+3), not UTC", () => {
    expect(formatDateTime(instant)).toContain("17:12");
  });

  it("renders time-only in Istanbul time", () => {
    expect(formatTime(instant)).toContain("17:12");
  });

  it("keeps date-only reservation days in UTC (no off-by-one shift)", () => {
    // A booking day stored as UTC midnight must display as that exact calendar
    // day — never shifted to the previous/next day by a timezone.
    expect(formatDate(new Date("2026-06-07T00:00:00Z"))).toContain("07 Haz 2026");
  });
});
