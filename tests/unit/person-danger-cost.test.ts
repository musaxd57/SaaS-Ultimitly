import { describe, it, expect } from "vitest";
import { personDangerOf } from "@/lib/ai/person-danger";

// Kişisel tehlike okuyucusu misafir metnine uygulanır: uzun tek sözcük / tekrar / boşluk dizisinde karesel iş yok (ReDoS kuralı, CLAUDE.md).
describe("süre (misafir metni — karesel iş yok)", () => {
  it("50.000 karakterlik tekrarlar ve boşluk dizileri hızlı", () => {
    const inputs = [
      "kapıyı ".repeat(8000) + "zorluyor",
      "a ".repeat(25000),
      "asansorde ".repeat(5000),
      "x".repeat(50000),
      "biri ".repeat(10000),
    ];
    const t = performance.now();
    for (const s of inputs) personDangerOf(s);
    expect(performance.now() - t).toBeLessThan(250);
  });
});
