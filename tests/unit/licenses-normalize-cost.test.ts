import { describe, it, expect } from "vitest";
import { normalizeLegalName, normalizeLicenseNumber } from "@/lib/licenses/normalize";
import { parseTaxId } from "@/lib/licenses/tax-id";
import { parseAttributes } from "@/lib/licenses/catalog";

// ---------------------------------------------------------------------------
// KARESEL İŞ YOK (CLAUDE.md ReDoS kuralı): kullanıcının yazdığı unvan / numara / vergi no / nitelik metni normalleştirilirken uzun tek
// sözcük, boşluk dizisi ve noktalama dizisi doğrusal sürede biter. Rotalar uzunluğu ayrıca sınırlar; bu pin sınırın ARKASINDAKİ fonksiyonu
// tek başına korur.
// ---------------------------------------------------------------------------

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("belge normalleştirme — süre pini", () => {
  const inputs = [
    "a".repeat(100_000),
    " ".repeat(100_000),
    ". ".repeat(50_000),
    "a.".repeat(50_000),
    "ş".repeat(100_000),
    "limited şirketi ".repeat(6_000),
  ];

  it("unvan 100.000 karakterde bile hızlı", () => {
    for (const s of inputs) expect(timed(() => normalizeLegalName(s)), s.slice(0, 12)).toBeLessThan(1500);
  });

  it("numara, vergi no ve nitelik metni uzun girişte erken reddeder", () => {
    for (const s of inputs) {
      expect(timed(() => normalizeLicenseNumber(s))).toBeLessThan(200);
      expect(timed(() => parseTaxId("company", s))).toBeLessThan(200);
      expect(timed(() => parseAttributes("tourism_operation", { facilityType: s }))).toBeLessThan(1500);
    }
  });
});
