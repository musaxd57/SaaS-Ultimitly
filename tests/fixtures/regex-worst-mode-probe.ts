// `tests/unit/regex-worst-mode-cost.test.ts`in alt süreç yardımcısı: V8'in EN KÖTÜ düzenli ifade kipinde (çağıran bayrağı verir:
// `--no-regexp-optimization` ya da `--regexp-interpret-all`) çıktı vetosu, ev sahibine yönlendirme dedektörü, süzgeci ve can güvenliği sınıfını uzun boşluk
// dizilerinde süreler; sonucu tek satır JSON olarak yazar. Vitest dosyası değildir (adı `.test.ts` ile bitmez).
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";
import { lifeSafetyOf } from "@/lib/ai/life-safety";
import { personDangerOf } from "@/lib/ai/person-danger";
import { hazardEvidenceOf, kbSupportsReassurance } from "@/lib/ai/hazard-evidence";

const N = 4_000;
const SHAPES: [string, string][] = [
  ["boşluk + daire no", " If anything breaks, message your host, apartment 112" + " ".repeat(N) + "B."],
  ["sekme dizisi (Türkçe)", "Bir sorun olursa ev sahibinize yazın." + "\t".repeat(N) + "İyi konaklamalar!"],
  ["özne + boşluk dizisi", "Ev sahibiniz " + " ".repeat(N) + "x"],
];

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return Math.round(performance.now() - t0);
};

// Isınma: modül ve kalıp derlemesi süreç başına bir kez ödenir — pin karesel işi ölçer.
vetoOutgoingReply("Kontrol edip dönerim.");
analyzeHostContact("Bir sorun olursa ev sahibinize yazın.");
lifeSafetyOf({ texts: ["ACİL klima çalışmıyor"] });

const out: Record<string, number> = {};
for (const [name, text] of SHAPES) {
  out[`veto · ${name}`] = ms(() => vetoOutgoingReply(text));
  out[`dedektör · ${name}`] = ms(() => hostContactKindOf(text));
  out[`süzgeç · ${name}`] = ms(() => analyzeHostContact(text));
  // Hibrit acil akışın can güvenliği sınıfı (10-31): misafir metnine uygulanır.
  out[`can güvenliği · ${name}`] = ms(() => lifeSafetyOf({ texts: [text] }));
}
// Devam eden kişisel tehlike okuyucusu (10-31): yakınlık ipuçlarının iki sınıfı yüzlerce kez + Kiril / Arap yazısı (alt dize eşlemesi).
personDangerOf("Biri kapıyı zorluyor!");
out["kişisel tehlike · ipucu tekrarı"] = ms(() => personDangerOf("kapı zorluyor bıçak çekti ".repeat(N / 25)));
out["kişisel tehlike · Kiril + Arap tekrarı"] = ms(() => personDangerOf("кто-то ломится يكسر الباب ".repeat(N / 25)));
// Fiziksel tehlike okuyucusu (Codex 10-31): "ve şimdi" cümlecik sınırı, alıntılı güncel aktarım, ışık / ekran çevresi, olumsuz güvence.
hazardEvidenceOf("Mutfakta yangın var");
out["tehlike · ve şimdi tekrarı"] = ms(() => hazardEvidenceOf("dün geldik ve şimdi mutfakta yangın var ".repeat(N / 40)));
out["tehlike · alıntı + diyor tekrarı"] = ms(() => hazardEvidenceOf('çocuğum "yangın var" diyor '.repeat(N / 28)));
out["tehlike · lamba + perde tekrarı"] = ms(() => hazardEvidenceOf("die lampe ist aus und der vorhang brennt ".repeat(N / 40)));
out["tehlike · tek uzun sözcük"] = ms(() => hazardEvidenceOf("hier" + "a".repeat(N) + " brennt"));
out["güvence · olumsuz tekrar"] = ms(() => kbSupportsReassurance(["duman normal degildir ".repeat(N / 22)]));
process.stdout.write(`${JSON.stringify(out)}\n`);
