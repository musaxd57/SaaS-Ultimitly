// `tests/unit/regex-worst-mode-cost.test.ts`in alt süreç yardımcısı: V8'in EN KÖTÜ düzenli ifade kipinde (çağıran bayrağı verir:
// `--no-regexp-optimization` ya da `--regexp-interpret-all`) çıktı vetosu, ev sahibine yönlendirme dedektörü ve süzgeci uzun boşluk
// dizilerinde süreler; sonucu tek satır JSON olarak yazar. Vitest dosyası değildir (adı `.test.ts` ile bitmez).
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";

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

const out: Record<string, number> = {};
for (const [name, text] of SHAPES) {
  out[`veto · ${name}`] = ms(() => vetoOutgoingReply(text));
  out[`dedektör · ${name}`] = ms(() => hostContactKindOf(text));
  out[`süzgeç · ${name}`] = ms(() => analyzeHostContact(text));
}
process.stdout.write(`${JSON.stringify(out)}\n`);
