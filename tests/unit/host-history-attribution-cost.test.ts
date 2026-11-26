import { describe, it, expect } from "vitest";
import { attributeEdit } from "@/lib/host-history/attribution";

// L4 fark ölçüsü KARESEL İŞ YAPMAZ (CLAUDE.md ReDoS kuralı): tavansız ev sahibi / taslak metni — 50.000 karakterlik tek sözcük, boşluk dizisi,
// tekrarlanan kök ve tavan sınırındaki (400 × 400) fark tablosu süre pinli.

const time = (fn: () => void) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("attributeEdit süre", () => {
  it.each([
    ["tek sözcük 50k", "a".repeat(50_000)],
    ["boşluk dizisi 50k", " ".repeat(50_000)],
    ["tekrarlanan kök 50k", "saat ".repeat(10_000)],
    ["nokta dizisi 50k", ".".repeat(50_000)],
  ])("%s < 300 ms", (_name, text) => {
    expect(time(() => attributeEdit(text, `${text} ek`))).toBeLessThan(300);
  });

  it("tavan sınırı: 400 × 400 belirteçlik tam farklı iki metin < 150 ms", () => {
    const a = Array.from({ length: 400 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 400 }, (_, i) => `b${i}`).join(" ");
    expect(time(() => attributeEdit(a, b))).toBeLessThan(150);
  });
});
