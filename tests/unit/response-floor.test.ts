import { describe, it, expect } from "vitest";
import { padResponseTime } from "@/lib/response-floor";

describe("padResponseTime", () => {
  it("taban dolmadıysa kalanı bekler; dolduysa beklemez", async () => {
    const t0 = performance.now();
    await padResponseTime(t0, 60);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(55);
    const t1 = performance.now() - 100;
    const s = performance.now();
    await padResponseTime(t1, 60);
    expect(performance.now() - s).toBeLessThan(20);
  });
});
