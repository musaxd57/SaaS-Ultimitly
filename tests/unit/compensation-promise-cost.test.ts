import { describe, it, expect } from "vitest";
import { promisesCompensation } from "@/lib/ai/compensation-promise";
import { measureCost, costMessage } from "../helpers/linear-cost";

// Tazminat sözü kemeri (sızma testi 11-14, E-3) misafire giden cevabı tarar → karesel iş yok (CLAUDE.md ReDoS kuralı). Doğrusal ve
// sınırın altında — ya da doğrusal ve 4 katının altında (`linear-cost`). Girdi 8.000 karakterde kesilir; aile o tavanın altında ölçülür.
const FULL = 7_800;
const FAMILIES: [string, (n: number) => string][] = [
  ["uzun tek sözcük", (n) => "a".repeat(n)],
  ["boşluk dizisi", (n) => " ".repeat(n)],
  ["tekrar eden telafi kökü", (n) => "iade ".repeat(Math.max(1, Math.floor(n / 5)))],
  ["tekrar eden İngilizce özne", (n) => "we ".repeat(Math.max(1, Math.floor(n / 3)))],
  ["tekrar eden söz eki", (n) => "edeceğiz ".repeat(Math.max(1, Math.floor(n / 9)))],
];

describe("promisesCompensation — süre", () => {
  for (const [name, family] of FAMILIES) {
    it(name, () => {
      const v = measureCost((s: string) => promisesCompensation(s), family, FULL, 60);
      expect(v.ok, costMessage(v, 60)).toBe(true);
    });
  }
});
