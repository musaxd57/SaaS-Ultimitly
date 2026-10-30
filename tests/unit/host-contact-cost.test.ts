import { describe, it, expect } from "vitest";
import { mentionsHostContact, hostContactKindOf, asksHypotheticalSituation } from "@/lib/ai/absence";
import { stripHostContactFiller } from "@/lib/ai/host-contact-filler";
import { settleHostContactRemovals } from "@/lib/conversation-items/host-contact-settle";

// ---------------------------------------------------------------------------
// K-1029-A — EV SAHİBİNE YÖNLENDİRME DEDEKTÖRÜ + SÜZGEÇ + "CEVAPLANDI" KURALI — SÜRE PİNİ (ReDoS kuralı, CLAUDE.md "misafir metnine
// uygulanan kalıpta karesel iş yok"). Dedektör model cevabında (uzunluğu misafir girdisi şekillendirir) ve misafirin olasılık sorusunda
// koşar. Ölçüldü (10-30): 36 / 72 / 144 bin karakterde süre uzunlukla DOĞRUSAL büyüyor (en ağırı 144 binde ~1,5 sn). Uzun tek sözcük,
// boşluk dizisi, tekrarlanan seslenme / iletişim / koşul kökü, virgüllü yan cümle zinciri, çok cümle, Arapça / Rusça.
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

const run = (t: string) => {
  mentionsHostContact(t);
  hostContactKindOf(t);
  asksHypotheticalSituation(t);
  const r = stripHostContactFiller(t);
  settleHostContactRemovals({
    removals: r.removals,
    keptText: r.text,
    needs: [{ ref: "R1", topics: ["wifi"], terms: ["wifi"], contingency: false }],
    declared: { refs: ["R1"] },
  });
  return r;
};

describe("ev sahibine yönlendirme — uzun girdide sınırlı süre", () => {
  it.each([
    ["50.000 harflik tek sözcük", "a".repeat(50_000)],
    ["seslenme + 50.000 boşluk + fiil", "ev sahibinize" + " ".repeat(50_000) + "yazın"],
    ["'ev sahibinize ' × 5.000", "ev sahibinize ".repeat(5_000)],
    ["'write your host ' × 5.000", "write your host ".repeat(5_000)],
    ["'en cas de ' × 5.000", "en cas de ".repeat(5_000)],
    ["'ve ' × 15.000 (yan cümle sınırı)", "ve ".repeat(15_000)],
    ["virgüllü yan cümle × 3.000 + yönlendirme", "Havlular dolapta, ".repeat(3_000) + "sorun olursa ev sahibinize yazın."],
    ["cümle × 600 (her biri yönlendirme)", "Havlular dolapta. Bir sorun olursa ev sahibinize yazın. ".repeat(600)],
    ["Rusça × 3.000", "позвоните хозяину ".repeat(3_000)],
    ["Arapça × 4.000", "راسل المضيف ".repeat(4_000)],
  ])("%s → 1,5 sn altında", (_ad, girdi) => {
    run("ısınma: Bir sorun olursa ev sahibinize yazın.");
    expect(ms(() => run(girdi))).toBeLessThan(1_500);
  });

  // v3 maliyet incelemesi (10-30): başvurma cümlenin BAŞINDA + uzun virgül zinciri (her kuyrukta dedektör yeniden koşuyordu, 20 bin karakterde
  // 21 sn), çapasız `\p{L}{2,}` (ulaç / Türkçe emir, uzun tek sözcük 50 binde 22,9 sn), sondaki ayraç / nokta dizisi (`[\s,;:،]+$`), ve v3
  // kapsam turunun yeni kalıpları (Almanca "sich … an uns", nesne aralıklı İngilizce / Rusça, mastar öbekleri, bilgi isteği ayrımı).
  it.each([
    ["Rusça başvurma + 50.000 virgüllü kuyruk", "Если почувствуете запах газа, напишите хозяину" + ", ж".repeat(16_000) + "."],
    ["İngilizce başvurma + 50.000 virgüllü kuyruk", "If you smell gas, message your host" + ", a".repeat(25_000) + "."],
    ["Türkçe koşul + 50.000 harflik sözcük + başvurma", "Gaz kokusu alırsanız " + "a".repeat(50_000) + " ev sahibinize yazın."],
    ["Rusça koşul + 50.000 harflik sözcük + adım", "Если почувствуете запах газа " + "ж".repeat(50_000) + ", откройте окна и напишите хозяину."],
    ["baş kısımda 50.000 boşluk", "Havlular dolapta" + " ".repeat(50_000) + "x, sorun olursa ev sahibinize yazın."],
    ["baş kısımda 25.000 virgül", "Havlular dolapta" + ", ".repeat(25_000) + "x, sorun olursa ev sahibinize yazın."],
    ["50.000 nokta", "Havlular dolapta" + ".".repeat(50_000) + "x ev sahibinize yazın."],
    ["'sich jederzeit gerne ' × 2.500", "Bei Fragen " + "sich jederzeit gerne ".repeat(2_500) + "an Ihrem."],
    ["'kontakt mit ihrem gastgeber ' × 1.800", "Bitte nehmen Sie " + "kontakt mit ihrem gastgeber ".repeat(1_800) + "x."],
    ["'arrange this with your ' × 2.000", "Please " + "arrange this with your ".repeat(2_000) + "x."],
    ["'just send us a ' × 3.300", "If you need anything, " + "just send us a ".repeat(3_300) + "x."],
    ["'let us know the ' × 3.000", "If anything comes up, " + "let us know the ".repeat(3_000) + "x."],
    ["'об этом ' × 6.000", "Сообщите " + "об этом ".repeat(6_000) + "x."],
    ["'we are happy to ' × 3.000", "we are happy to ".repeat(3_000) + "mention it to your host."],
  ])("v3: %s → 1,5 sn altında", (_ad, girdi) => {
    run("ısınma: Bir sorun olursa ev sahibinize yazın.");
    expect(ms(() => run(girdi))).toBeLessThan(1_500);
  });

  it("hüküm uzun metinde de doğru: sondaki yönlendirme silinir, baştaki bilgi kalır", () => {
    const r = run("Havlular dolapta. ".repeat(2_000) + "Bir sorun olursa ev sahibinize yazın.");
    expect(r.removals).toHaveLength(1);
    expect(r.text).not.toContain("ev sahibinize");
    expect(r.text.startsWith("Havlular dolapta.")).toBe(true);
  });
});
