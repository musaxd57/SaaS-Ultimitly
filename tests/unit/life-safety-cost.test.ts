import { describe, it, expect } from "vitest";
import { lifeSafetyOf } from "@/lib/ai/life-safety";

// Misafir metnine uygulanan kalıp: uzun tek sözcük / boşluk dizisi / tekrarlanan kökte doğrusal (CLAUDE.md ReDoS kuralı). Sınıflayıcı 8.000
// karakterde keser; ölçüm kesmeden önceki uzunlukla.
describe("can güvenliği sınıfı — süre", () => {
  it.each([
    ["uzun tek sözcük", "a".repeat(50_000)],
    ["boşluk dizisi", `acil${" ".repeat(50_000)}x`],
    ["tekrarlanan kök", "hirsizhirsiz".repeat(4_000)],
    ["tekrarlanan öbek", "kalp krizi ".repeat(4_000)],
  ])("%s 1 sn altında", (_name, text) => {
    const t0 = performance.now();
    lifeSafetyOf({ texts: [text] });
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
