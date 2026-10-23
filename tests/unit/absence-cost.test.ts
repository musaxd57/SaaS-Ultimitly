import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { stripNoInstructionFiller, stripNoInstructionFillerGrounded } from "@/lib/ai/no-instruction-filler";

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
    // Opus 10-17 B7: `/[.!?]+$/` uzun ünlem dizisinde karesel idi (40.000'de 5 sn) → sondan doğrusal tarama.
    ["ünlem dizisi + yan cümle", "Özel talimatımız yok, " + "!".repeat(40_000) + "a"],
    ["ünlem dizisi sonda", "Çıkış için özel talimatımız yok, anahtarı bırakın" + "!".repeat(40_000)],
  ])("%s → 1.500 ms altında", (_ad, girdi) => {
    stripNoInstructionFiller("Isınma: Özel talimatımız yok, kapı açık.");
    expect(ms(() => stripNoInstructionFiller(girdi))).toBeLessThan(1_500);
  });
});

// KURUCU T1 dayanak yolu (10-21): kutup okuması sözcük sözcük (çapalı, sözcük ≤ 48), nezaket kalıpları sınırlı tekrar, "sistem" kalıbı gap().
describe("dayanaklı silici + 'sistem' kalıbı — düşmanca girdide sınırlı süre", () => {
  const kb = ["Çıkış\n" + "Anahtarı masaya bırakmanız yeterli. ".repeat(400), "Uzun\n" + "a".repeat(40_000)];
  it.each([
    ["tek uzun sözcük (olumsuz ek sonda)", "Özel talimatımız yok. " + "a".repeat(40_000) + "mez."],
    ["tekrarlanan olumsuz fiil", "Özel talimatımız yok. " + "gelmez ".repeat(8_000)],
    ["selam + büyük harfli sözcük dizisi", "Özel talimatımız yok. Merhaba " + "Ayşe ".repeat(10_000)],
    ["nezaket kapanışı tekrarı", "Özel talimatımız yok. " + "başka bir sorunuz olursa ".repeat(3_000)],
    ["boşluk dizisi", "Özel talimatımız yok. Anahtarı" + " ".repeat(40_000) + "bırakın."],
  ])("%s → 1.500 ms altında", (_ad, girdi) => {
    stripNoInstructionFillerGrounded("Isınma: Özel talimatımız yok, anahtarı masaya bırakmanız yeterli.", "tr", kb);
    expect(ms(() => stripNoInstructionFillerGrounded(girdi, "tr", kb))).toBeLessThan(1_500);
  });
  it.each([
    ["'sistemimizde' tekrarı", "sistemimizde ".repeat(5_000) + "yok"],
    ["'sistemde kayıt' tekrarı", "sistemde kayıt ".repeat(5_000)],
    // Claude T1 iç kaynak işareti (10-21): işaret ve olumsuzluk tekrarları, uzun tek sözcük, boşluk dizisi — tek cümle.
    ["'elimdeki' tekrarı", "elimdeki ".repeat(5_000) + "bilgilerde yok"],
    ["'bana verilen' + uzun sözcük", "bana verilen " + "a".repeat(40_000) + "da yok"],
    ["'sorun yok' tekrarı", "kayıtlarımızda " + "bir sorun yok ".repeat(5_000)],
    ["'the notes the host gave me' tekrarı", "the host gave me ".repeat(5_000) + "nothing"],
    ["Arapça olumsuzluk tekrarı", "سجلاتنا " + "ولم ".repeat(10_000)],
    ["boşluk dizisi", "knowledge base" + " ".repeat(40_000) + "nothing"],
  ])("%s → 1.500 ms altında", (_ad, girdi) => {
    expect(ms(() => admitsMissingKnowledge(girdi))).toBeLessThan(1_500);
  });
});
