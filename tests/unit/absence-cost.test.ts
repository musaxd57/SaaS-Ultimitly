import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// "BİLGİM YOK" YÜKLEMİ MALİYETİ (10-01, yedi dil genişletmesi): yeni kalıplar kapalı tekrar (`{0,n}`) kullanır — CLAUDE.md karesel iş
// kuralı. Yüklem model cevabına uygulanır (cevap 4.000 karakterle sınırlı); pin bunun 12 katı uzunlukta, tekrar eden kök / tek uzun
// sözcük / boşluk dizisiyle sınırlı süreyi pinler (ölçüm: en kötü ~19 ms, "информации" tekrarı).
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("'bilgim yok' yüklemi — düşmanca girdide sınırlı süre", () => {
  it.each([
    ["tek uzun sözcük", "a".repeat(50_000)],
    ["Rusça kök tekrarı", "информацииии".repeat(4_000)],
    ["Türkçe kök tekrarı", "bilgiiiii ".repeat(5_000)],
    ["Almanca keine tekrarı", "keine ".repeat(8_000) + "x"],
    ["Rusça нет tekrarı", "нет ".repeat(12_000) + "x"],
    ["Fransızca n'ai pas tekrarı", "n'ai pas ".repeat(5_000) + "x"],
    ["İspanyolca no tengo tekrarı", "no tengo ".repeat(5_000) + "x"],
    ["Almanca kann ich tekrarı", "kann ich ".repeat(5_000) + "x"],
    ["boşluk dizisi", " ".repeat(50_000)],
  ])("%s (≈50.000 karakter) → 300 ms altında, hüküm yok", (_ad, girdi) => {
    // Isınma: düzenli ifadelerin derlenmesi süreç başına bir kez ödenir — pin karesel işi ölçer.
    admitsMissingKnowledge("Isınma metni: otopark P2.");
    let r = true;
    expect(ms(() => (r = admitsMissingKnowledge(girdi)))).toBeLessThan(300);
    expect(r).toBe(false);
  });
});
