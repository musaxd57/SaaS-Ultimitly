import { describe, it, expect } from "vitest";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";
import { costMessage, measureCost } from "../helpers/linear-cost";

// Mecaz / şaka kalıpları misafir metnine uygulanır → karesel iş yok (CLAUDE.md ReDoS kuralı): uzun gülme dizisi / tekrarlanan benzetme / boşluk.
// Sınır "300 ms altında YA DA doğrusal" (11-12, `tests/helpers/linear-cost.ts`): sınır aynı; yavaş makinede aşılırsa (benzetimde "haha
// dizisi" 351 ms ölçtü) ve sınırın 4 katının altındaysa aynı ailenin 1/16 boyutuyla kıyaslanır — süre 40 kattan az büyüdüyse doğrusal iştir.
const LIMIT_MS = 300;

describe("mecaz / şaka kalıpları — süre", () => {
  it.each<[string, number, (n: number) => string]>([
    ["haha dizisi", 25_000, (n) => "ha".repeat(n) + " mutfak yanıyor sanki"],
    ["h harfi", 50_000, (n) => "h".repeat(n) + " yangın gibi"],
    ["sanki tekrarı", 8_000, (n) => "sanki ".repeat(n) + "yangın 😂"],
    ["boşluk dizisi", 50_000, (n) => "yangın" + " ".repeat(n) + "gibi haha"],
  ])(
    "%s 300 ms altında ya da doğrusal",
    (_n, n, family) => {
      // Isınma: modül ve kalıp derlemesi süreç başına bir kez ödenir — pin girdiyle büyüyen işi ölçer.
      hazardEvidenceOf("Mutfak yanıyor sanki haha");
      const v = measureCost(hazardEvidenceOf, family, n, LIMIT_MS);
      expect(v.ok, costMessage(v, LIMIT_MS)).toBe(true);
    },
    30_000,
  );
});
