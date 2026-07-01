import { describe, it, expect } from "vitest";
import { RESERVATION_STATUS, PRIORITY, TASK_TYPE, KB_CATEGORY } from "@/lib/constants";

describe("optionMap helpers", () => {
  it("resolves Turkish labels by value", () => {
    expect(RESERVATION_STATUS.label("confirmed")).toBe("Onaylı");
    expect(PRIORITY.label("urgent")).toBe("Acil");
    expect(TASK_TYPE.label("maintenance")).toBe("Bakım");
  });

  it("maps values to badge tones", () => {
    expect(PRIORITY.tone("urgent")).toBe("destructive");
    expect(RESERVATION_STATUS.tone("confirmed")).toBe("success");
  });

  it("falls back to the raw value and a default tone for unknown input", () => {
    // Values arrive from the DB as plain strings — unknowns must not crash.
    expect(KB_CATEGORY.label("nonexistent")).toBe("nonexistent");
    expect(KB_CATEGORY.tone("nonexistent")).toBe("default");
  });

  it("exposes the full value list for zod enums", () => {
    expect(PRIORITY.values).toEqual(["urgent", "standard", "low"]);
    expect(RESERVATION_STATUS.values).toContain("cancelled");
  });
});
