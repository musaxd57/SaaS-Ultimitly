import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, initials, truncate, safeJsonParse, fromNow } from "@/lib/utils";

describe("formatCurrency", () => {
  it("renders an em dash for null/undefined", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });

  it("formats numbers with the given currency", () => {
    expect(formatCurrency(420, "EUR")).toContain("420");
  });
});

describe("formatDate", () => {
  it("renders an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("shows the UTC calendar day of a date-only reservation value (no tz drift)", () => {
    // Stored as UTC midnight of June 4 — must read as June 4 everywhere.
    expect(formatDate("2026-06-04T00:00:00.000Z")).toBe("04 Haz 2026");
    // Late-UTC instant on June 4 still belongs to June 4 (not rolled to the 5th).
    expect(formatDate("2026-06-04T23:30:00.000Z")).toBe("04 Haz 2026");
  });
});

describe("initials", () => {
  it("takes up to two uppercase initials", () => {
    expect(initials("John Smith")).toBe("JS");
    expect(initials("ayşe")).toBe("A");
    expect(initials("Maria Garcia Lopez")).toBe("MG");
  });
});

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("kısa", 80)).toBe("kısa");
  });
  it("appends an ellipsis to long strings", () => {
    const out = truncate("a".repeat(100), 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(11);
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });
  it("returns the fallback on invalid JSON", () => {
    expect(safeJsonParse("{not json", { ok: true })).toEqual({ ok: true });
    expect(safeJsonParse(null, [])).toEqual([]);
  });
});

describe("fromNow", () => {
  it("describes very recent times as 'az önce'", () => {
    expect(fromNow(new Date())).toBe("az önce");
  });
  it("renders an em dash for empty input", () => {
    expect(fromNow(null)).toBe("—");
  });
});
