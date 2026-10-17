import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { stripNoInstructionFiller } from "@/lib/ai/no-instruction-filler";

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
    // Kurucu 10-17 niteleyicili "talimat yok" kalıpları (`QUALIFIED_NO_INSTRUCTION_PATTERNS`).
    ["Türkçe özel tekrarı", "özel ".repeat(10_000) + "x"],
    ["İngilizce no special tekrarı", "no special ".repeat(5_000) + "x"],
    ["Almanca keine besonderen tekrarı", "keine besonderen ".repeat(3_000) + "x"],
  ])("%s (≈50.000 karakter) → 300 ms altında, hüküm yok", (_ad, girdi) => {
    // Isınma: düzenli ifadelerin derlenmesi süreç başına bir kez ödenir — pin karesel işi ölçer.
    admitsMissingKnowledge("Isınma metni: otopark P2.");
    let r = true;
    expect(ms(() => (r = admitsMissingKnowledge(girdi)))).toBeLessThan(300);
    expect(r).toBe(false);
  });
});

// "Talimat yok" yan cümlesi silici (kurucu 10-17, `no-instruction-filler.ts`): cümle / yan cümle bölme doğrusal; her yan cümlede yüklem
// bir kez. Düşmanca girdi: binlerce "talimat yok" yan cümlesi, tek uzun sözcük, boşluk dizisi.
describe("'talimat yok' yan cümlesi silici — düşmanca girdide sınırlı süre", () => {
  it.each([
    ["binlerce yan cümle", "Çıkış için özel talimatımız yok, anahtarı bırakın, ".repeat(800) + "x."],
    ["binlerce cümle", "Özel talimatımız yok, kapı açık. ".repeat(1_500)],
    ["tek uzun sözcük + yan cümle", "Özel talimatımız yok, " + "a".repeat(50_000)],
    ["boşluk dizisi + yan cümle", "Özel talimatımız yok," + " ".repeat(50_000) + "kapı açık."],
  ])("%s → 1.500 ms altında", (_ad, girdi) => {
    stripNoInstructionFiller("Isınma: Özel talimatımız yok, kapı açık.");
    expect(ms(() => stripNoInstructionFiller(girdi))).toBeLessThan(1_500);
  });
});
