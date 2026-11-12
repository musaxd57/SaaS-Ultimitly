import { describe, it, expect } from "vitest";
import { mentionsHostContact, hostContactKindOf, asksHypotheticalSituation } from "@/lib/ai/absence";
import { stripHostContactFiller } from "@/lib/ai/host-contact-filler";
import { settleHostContactRemovals } from "@/lib/conversation-items/host-contact-settle";
import { costMessage, measureCost } from "../helpers/linear-cost";

// ---------------------------------------------------------------------------
// K-1029-A — EV SAHİBİNE YÖNLENDİRME DEDEKTÖRÜ + SÜZGEÇ + "CEVAPLANDI" KURALI — SÜRE PİNİ (ReDoS kuralı, CLAUDE.md "misafir metnine
// uygulanan kalıpta karesel iş yok"). Dedektör model cevabında (uzunluğu misafir girdisi şekillendirir) ve misafirin olasılık sorusunda
// koşar. Ölçüldü (10-30): 36 / 72 / 144 bin karakterde süre uzunlukla DOĞRUSAL büyüyor (en ağırı 144 binde ~1,5 sn). Uzun tek sözcük,
// boşluk dizisi, tekrarlanan seslenme / iletişim / koşul kökü, virgüllü yan cümle zinciri, çok cümle, Arapça / Rusça.
//
// 🚨 SINIR "1,5 sn altında YA DA doğrusal" (11-12, `tests/helpers/linear-cost.ts`): sınır aynı ve önce o ölçülür. Yan cümle başına dedektör
// koşan vakalar doğrusal ama pahalı (yerelde vitest altında 0,5–1,1 sn); private depodaki küçük CI makinesinde biri 1.617 ms ölçtü (CI 1793),
// yavaş makine benzetiminde dördü sınırı aştı — iş aynı, makine yavaş. Sınır aşılınca (ve süre sınırın 4 katının altındaysa; üstü her
// makinede kırmızı) aynı ailenin 1/16 boyutu ölçülür: süre 40 kattan az büyüdüyse (doğrusal ≈ 16) yeşil, değilse (karesel ≈ 256) kırmızı.
// Bu yüzden her vaka bir AİLE (boyut → girdi) olarak yazılır.
// ---------------------------------------------------------------------------

const LIMIT_MS = 1_500;
// Sınır aşılırsa küçük girdi 5 kez, tam girdi 4 kez daha koşar (tavanın hemen altında ~32 sn); vitest'in 5 sn'lik varsayılanı yetmezdi.
const TEST_TIMEOUT_MS = 60_000;

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

type Family = (n: number) => string;

const expectBounded = (n: number, family: Family) => {
  run("ısınma: Bir sorun olursa ev sahibinize yazın.");
  const v = measureCost(run, family, n, LIMIT_MS);
  expect(v.ok, costMessage(v, LIMIT_MS)).toBe(true);
};

describe("ev sahibine yönlendirme — uzun girdide sınırlı süre", () => {
  it.each<[string, number, Family]>([
    ["50.000 harflik tek sözcük", 50_000, (n) => "a".repeat(n)],
    ["seslenme + 50.000 boşluk + fiil", 50_000, (n) => "ev sahibinize" + " ".repeat(n) + "yazın"],
    ["'ev sahibinize ' × 5.000", 5_000, (n) => "ev sahibinize ".repeat(n)],
    ["'write your host ' × 5.000", 5_000, (n) => "write your host ".repeat(n)],
    ["'en cas de ' × 5.000", 5_000, (n) => "en cas de ".repeat(n)],
    ["'ve ' × 15.000 (yan cümle sınırı)", 15_000, (n) => "ve ".repeat(n)],
    ["virgüllü yan cümle × 3.000 + yönlendirme", 3_000, (n) => "Havlular dolapta, ".repeat(n) + "sorun olursa ev sahibinize yazın."],
    ["cümle × 600 (her biri yönlendirme)", 600, (n) => "Havlular dolapta. Bir sorun olursa ev sahibinize yazın. ".repeat(n)],
    ["Rusça × 3.000", 3_000, (n) => "позвоните хозяину ".repeat(n)],
    ["Arapça × 4.000", 4_000, (n) => "راسل المضيف ".repeat(n)],
  ])("%s → 1,5 sn altında ya da doğrusal", (_ad, n, family) => expectBounded(n, family), TEST_TIMEOUT_MS);

  // v3 maliyet incelemesi (10-30): başvurma cümlenin BAŞINDA + uzun virgül zinciri (her kuyrukta dedektör yeniden koşuyordu, 20 bin karakterde
  // 21 sn), çapasız `\p{L}{2,}` (ulaç / Türkçe emir, uzun tek sözcük 50 binde 22,9 sn), sondaki ayraç / nokta dizisi (`[\s,;:،]+$`), ve v3
  // kapsam turunun yeni kalıpları (Almanca "sich … an uns", nesne aralıklı İngilizce / Rusça, mastar öbekleri, bilgi isteği ayrımı).
  it.each<[string, number, Family]>([
    ["Rusça başvurma + 50.000 virgüllü kuyruk", 16_000, (n) => "Если почувствуете запах газа, напишите хозяину" + ", ж".repeat(n) + "."],
    ["İngilizce başvurma + 50.000 virgüllü kuyruk", 25_000, (n) => "If you smell gas, message your host" + ", a".repeat(n) + "."],
    ["Türkçe koşul + 50.000 harflik sözcük + başvurma", 50_000, (n) => "Gaz kokusu alırsanız " + "a".repeat(n) + " ev sahibinize yazın."],
    [
      "Rusça koşul + 50.000 harflik sözcük + adım",
      50_000,
      (n) => "Если почувствуете запах газа " + "ж".repeat(n) + ", откройте окна и напишите хозяину.",
    ],
    ["baş kısımda 50.000 boşluk", 50_000, (n) => "Havlular dolapta" + " ".repeat(n) + "x, sorun olursa ev sahibinize yazın."],
    ["baş kısımda 25.000 virgül", 25_000, (n) => "Havlular dolapta" + ", ".repeat(n) + "x, sorun olursa ev sahibinize yazın."],
    ["50.000 nokta", 50_000, (n) => "Havlular dolapta" + ".".repeat(n) + "x ev sahibinize yazın."],
    ["'sich jederzeit gerne ' × 2.500", 2_500, (n) => "Bei Fragen " + "sich jederzeit gerne ".repeat(n) + "an Ihrem."],
    ["'kontakt mit ihrem gastgeber ' × 1.800", 1_800, (n) => "Bitte nehmen Sie " + "kontakt mit ihrem gastgeber ".repeat(n) + "x."],
    ["'arrange this with your ' × 2.000", 2_000, (n) => "Please " + "arrange this with your ".repeat(n) + "x."],
    ["'just send us a ' × 3.300", 3_300, (n) => "If you need anything, " + "just send us a ".repeat(n) + "x."],
    ["'let us know the ' × 3.000", 3_000, (n) => "If anything comes up, " + "let us know the ".repeat(n) + "x."],
    ["'об этом ' × 6.000", 6_000, (n) => "Сообщите " + "об этом ".repeat(n) + "x."],
    ["'we are happy to ' × 3.000", 3_000, (n) => "we are happy to ".repeat(n) + "mention it to your host."],
  ])("v3: %s → 1,5 sn altında ya da doğrusal", (_ad, n, family) => expectBounded(n, family), TEST_TIMEOUT_MS);

  // v4 (10-30): yeni kalıplar (veya / أو sınırı, Arapça bitişik و, Rusça virgüllü aralık, Fransızca mastar öbeği, işletme bağlamı, teşekkür
  // ayıklama, ön koşul) + silmeden SONRA kalan uzun boşluk / sekme / NBSP dizisi + daire numarasından sonra boşluk dizisi (süzgeç cümle
  // başına çıktı vetosunu çağırır; vetonun gövde-önce düzeltmesinden önce 50.000 karakterde 89 sn) + uzun bir cümleden sonra binlerce kısa
  // başvurma cümlesi (önceki cümle her seferinde yeniden taranıyordu; 100.000 karakterde 4,3 sn, karesel).
  const longSentence = "The sauna towels and the spare blankets are in the wardrobe next to the heater in the hallway ";
  const wifiEn = "The Wi-Fi password is Lale1234. If anything breaks, message your host";
  it.each<[string, number, Family]>([
    ["silmeden sonra 50.000 boşluk", 50_000, (n) => wifiEn + "." + " ".repeat(n) + "Enjoy your stay!"],
    [
      "silmeden sonra 50.000 sekme",
      50_000,
      (n) => "Wi-Fi şifresi Lale1234. Bir sorun olursa ev sahibinize yazın." + "\t".repeat(n) + "İyi konaklamalar!",
    ],
    ["silmeden sonra 50.000 NBSP", 50_000, (n) => wifiEn + "." + " ".repeat(n) + "Enjoy your stay!"],
    ["daire numarası + 50.000 boşluk", 50_000, (n) => wifiEn + ", apartment 112" + " ".repeat(n) + "B."],
    // Uzun cümle kısa cümle sayısıyla aynı oranda büyür (1.666 kısa cümleye 270 tekrar).
    [
      "uzun cümle + 1.666 kısa başvurma",
      1_666,
      (n) => longSentence.repeat(Math.round((n * 270) / 1_666)).trim() + "." + " Ask your host.".repeat(n),
    ],
    ["'or message your host' × 2.380", 2_380, (n) => "If you smell gas, call 112" + " or message your host".repeat(n) + "."],
    // Bitişik "و" her adımı ayrı yan cümle yapar (binlerce yan cümle, her biri dedektörden geçer). Doğrusal, ölçüldü (10-30, tsx): 12,6 bin
    // karakter 0,2 sn · 25 bin 0,33 · 50 bin 0,68 · 100 bin 1,2 sn; vitest'te yaklaşık iki katı → 35 bin karakterde ölçülür (karesel olsaydı
    // 100 bin 10 sn'yi aşardı).
    ["Arapça bitişik و × 2.500", 2_500, (n) => "إذا شممت رائحة غاز، " + "وافتح النوافذ ".repeat(n) + "وراسل المضيف."],
    ["Rusça virgüllü aralık × 5.550", 5_550, (n) => "Сообщите" + ", об этом".repeat(n) + " хозяину."],
    ["Fransızca mastar öbeği × 3.120", 3_120, (n) => "Il est préférable de " + "vous renseigner ".repeat(n) + "auprès de votre hôte."],
    ["İngilizce nesne aralığı × 5.000", 5_000, (n) => "Please confirm " + "the exact ".repeat(n) + "time with your host."],
    ["işletme + 'Ask the owner' × 3.570", 3_570, (n) => "There's a bakery. " + "Ask the owner ".repeat(n) + "for simit."],
    ["teşekkür + koşul × 2.080", 2_080, (n) => "Thanks for contacting us" + ", and if you need towels".repeat(n) + "."],
    [
      "ön koşul + 'beforehand' × 4.540",
      4_540,
      (n) => "Early check-in is possible. Please arrange it with your host " + "beforehand ".repeat(n) + ".",
    ],
  ])("v4: %s → 1,5 sn altında ya da doğrusal", (_ad, n, family) => expectBounded(n, family), TEST_TIMEOUT_MS);

  // Ölçülen şey bir ÖNCEKİ girdinin bıraktığı durumdur (aile değil): mutlak sınırla kalır (yerelde 60–85 ms).
  it("v4: uzun iki baytlık metinden sonra tek baytlık uzun metin (vetonun derlenmiş kod durumu) → 1,5 sn altında", () => {
    run("Wi-Fi şifresi Lale1234. Bir sorun olursa ev sahibinize yazın." + "\t".repeat(16_000) + "İyi konaklamalar!");
    const after = "The Wi-Fi password is Lale1234. If anything breaks, message your host, apartment 112" + " ".repeat(16_000) + "B.";
    expect(ms(() => run(after))).toBeLessThan(LIMIT_MS);
  });

  it("hüküm uzun metinde de doğru: sondaki yönlendirme silinir, baştaki bilgi kalır", () => {
    const r = run("Havlular dolapta. ".repeat(2_000) + "Bir sorun olursa ev sahibinize yazın.");
    expect(r.removals).toHaveLength(1);
    expect(r.text).not.toContain("ev sahibinize");
    expect(r.text.startsWith("Havlular dolapta.")).toBe(true);
  });
});
