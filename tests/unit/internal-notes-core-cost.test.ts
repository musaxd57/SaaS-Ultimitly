import { describe, it, expect } from "vitest";
import { normalizeInternalNoteBody } from "@/lib/internal-notes/core";
import { costMessage, measureCost } from "../helpers/linear-cost";

// ---------------------------------------------------------------------------
// İÇ NOT temizliği — süre pini (CLAUDE.md "ReDoS"): ekibin yazdığı metne uygulanan kalıplar doğrusal. Rota gövdeyi 64 KB ile sınırlar;
// ölçüm onun çok üstünde (200.000 karakter) yapılır. Aileler: boşluk dizisi · denetim karakteri dizisi · CRLF dizisi · sekme dizisi.
// ---------------------------------------------------------------------------

const BEL = String.fromCharCode(7);
const FULL = 200_000;
const LIMIT_MS = 250;
const FAMILIES: Array<[string, (n: number) => string]> = [
  ["boşluk dizisi", (n) => `${" ".repeat(n)}x${" ".repeat(n)}`],
  ["denetim karakteri dizisi", (n) => `a${BEL.repeat(n)}b`],
  ["CRLF / CR dizisi", (n) => `a${"\r\n\r".repeat(n)}b`],
  ["sekme dizisi", (n) => `a${"\t".repeat(n)}b`],
];

describe("iç not metni temizliği — süre", () => {
  for (const [name, family] of FAMILIES) {
    it(name, () => {
      const v = measureCost((s: string) => normalizeInternalNoteBody(s), family, FULL, LIMIT_MS);
      expect(v.ok, costMessage(v, LIMIT_MS)).toBe(true);
    });
  }
});
