import { describe, it, expect } from "vitest";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";

// Mecaz / şaka kalıpları misafir metnine uygulanır → karesel iş yok (CLAUDE.md ReDoS kuralı): uzun gülme dizisi / tekrarlanan benzetme / boşluk.
describe("mecaz / şaka kalıpları — süre", () => {
  it.each([
    ["haha dizisi", "ha".repeat(25_000) + " mutfak yanıyor sanki"],
    ["h harfi", "h".repeat(50_000) + " yangın gibi"],
    ["sanki tekrarı", "sanki ".repeat(8_000) + "yangın 😂"],
    ["boşluk dizisi", "yangın" + " ".repeat(50_000) + "gibi haha"],
  ])("%s 300 ms altında", (_n, m) => {
    const t0 = performance.now();
    hazardEvidenceOf(m);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
