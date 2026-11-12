// `tests/unit/regex-worst-mode-cost.test.ts`in alt süreç yardımcısı: V8'in EN KÖTÜ düzenli ifade kipinde (çağıran bayrağı verir:
// `--no-regexp-optimization` ya da `--regexp-interpret-all`) çıktı vetosu, ev sahibine yönlendirme dedektörü, süzgeci ve can güvenliği sınıfını uzun boşluk
// dizilerinde süreler; her ölçümü BİTER BİTMEZ ayrı bir JSON satırı olarak yazar (zaman aşımında nerede kalındığı görülsün), en sonda
// `{"done":true}` satırı. Vitest dosyası değildir (adı `.test.ts` ile bitmez).
// Her ölçüm "sınırın altında YA DA doğrusal" kuralıyla hükme bağlanır (11-12, `tests/helpers/linear-cost.ts`): sınır aynı (1,5 sn); yavaş
// makinede aşılırsa (benzetimde can güvenliği sınıfı sekme dizisinde 1.664 ms ölçtü — ölçekleme doğrusal: 2.000 / 4.000 / 8.000 sekmede
// 397 / 856 / 1.549 ms) ve sınırın 4 katının altındaysa aynı ailenin 1/16 boyutuyla kıyaslanır. Bu yüzden her girdi bir AİLE (boyut →
// girdi) olarak yazılır.
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";
import { lifeSafetyOf } from "@/lib/ai/life-safety";
import { personDangerOf } from "@/lib/ai/person-danger";
import { hazardEvidenceOf, kbSupportsReassurance } from "@/lib/ai/hazard-evidence";
import { mentionsAnotherDay } from "@/lib/early-checkin/text-checks";
import { heldPetLeak } from "@/lib/conversation-items/pet-policy";
import { costMessage, measureCost } from "../helpers/linear-cost";

const N = 4_000;
const LIMIT_MS = 1_500;
type Family = (n: number) => string;
const SHAPES: [string, Family][] = [
  ["boşluk + daire no", (n) => " If anything breaks, message your host, apartment 112" + " ".repeat(n) + "B."],
  ["sekme dizisi (Türkçe)", (n) => "Bir sorun olursa ev sahibinize yazın." + "\t".repeat(n) + "İyi konaklamalar!"],
  ["özne + boşluk dizisi", (n) => "Ev sahibiniz " + " ".repeat(n) + "x"],
];

/** `n` ailenin tam boyutu (boşluk / tekrar sayısı). Sonuç satırı ölçüm biter bitmez yazılır. */
const measure = (name: string, n: number, family: Family, fn: (text: string) => unknown) => {
  const v = measureCost(fn, family, n, LIMIT_MS);
  process.stdout.write(`${JSON.stringify({ name, ms: Math.round(v.full), ok: v.ok, note: costMessage(v, LIMIT_MS) })}\n`);
};

// Isınma: modül ve kalıp derlemesi süreç başına bir kez ödenir — pin karesel işi ölçer.
vetoOutgoingReply("Kontrol edip dönerim.");
analyzeHostContact("Bir sorun olursa ev sahibinize yazın.");
lifeSafetyOf({ texts: ["ACİL klima çalışmıyor"] });

for (const [name, family] of SHAPES) {
  measure(`veto · ${name}`, N, family, (t) => vetoOutgoingReply(t));
  measure(`dedektör · ${name}`, N, family, (t) => hostContactKindOf(t));
  measure(`süzgeç · ${name}`, N, family, (t) => analyzeHostContact(t));
  // Hibrit acil akışın can güvenliği sınıfı (10-31): misafir metnine uygulanır.
  measure(`can güvenliği · ${name}`, N, family, (t) => lifeSafetyOf({ texts: [t] }));
}
// Devam eden kişisel tehlike okuyucusu (10-31): yakınlık ipuçlarının iki sınıfı yüzlerce kez + Kiril / Arap yazısı (alt dize eşlemesi).
personDangerOf("Biri kapıyı zorluyor!");
measure("kişisel tehlike · ipucu tekrarı", N / 25, (n) => "kapı zorluyor bıçak çekti ".repeat(n), (t) => personDangerOf(t));
measure("kişisel tehlike · Kiril + Arap tekrarı", N / 25, (n) => "кто-то ломится يكسر الباب ".repeat(n), (t) => personDangerOf(t));
// Fiziksel tehlike okuyucusu (Codex 10-31): "ve şimdi" cümlecik sınırı, alıntılı güncel aktarım, ışık / ekran çevresi, olumsuz güvence.
hazardEvidenceOf("Mutfakta yangın var");
measure("tehlike · ve şimdi tekrarı", N / 40, (n) => "dün geldik ve şimdi mutfakta yangın var ".repeat(n), (t) => hazardEvidenceOf(t));
measure("tehlike · alıntı + diyor tekrarı", N / 28, (n) => 'çocuğum "yangın var" diyor '.repeat(n), (t) => hazardEvidenceOf(t));
measure("tehlike · lamba + perde tekrarı", N / 40, (n) => "die lampe ist aus und der vorhang brennt ".repeat(n), (t) => hazardEvidenceOf(t));
measure("tehlike · tek uzun sözcük", N, (n) => "hier" + "a".repeat(n) + " brennt", (t) => hazardEvidenceOf(t));
measure("güvence · olumsuz tekrar", N / 22, (n) => "duman normal degildir ".repeat(n), (t) => kbSupportsReassurance([t]));
// Erken giriş başka gün okuyucusu (Tur 5 D6): kesmeli ay tamlaması + sıra-gün eki + "sabahın" saat dilimi önek bakışı.
const NOW_EC = new Date("2026-11-14T09:00:00Z");
const anotherDay = (t: string) => mentionsAnotherDay([t], NOW_EC, "Europe/Istanbul");
mentionsAnotherDay(["Kasım'ın 15'inde"], NOW_EC, "Europe/Istanbul");
measure("başka gün · ay tamlaması tekrarı", N / 17, (n) => "kasım'ın 14'ünde ".repeat(n), anotherDay);
measure("başka gün · sıra-gün + sabahın tekrarı", N / 16, (n) => "sabahın 14'ünde ".repeat(n), anotherDay);
measure("başka gün · ay adı + boşluk dizisi", N, (n) => "kasım'ın" + " ".repeat(n) + "x", anotherDay);
// Tutulan evcil hayvan isteği sızıntı denetimi (S3, 11-12): cevap modelinin metnine uygulanır. Ek gelmeyen kök tekrarı, rakam + para
// birimi gelmeyen sayı tekrarı, virgüllü yan cümle tekrarı, Arap harfi dizisi (alt dize eşlemesi) ve tek uzun sözcük.
heldPetLeak("Wi-Fi şifresi Lale2024.");
measure("evcil hayvan sızıntısı · tek uzun sözcük", N, (n) => "a".repeat(n), (t) => heldPetLeak(t));
measure("evcil hayvan sızıntısı · boşluk dizisi", N, (n) => "Wi-Fi" + " ".repeat(n) + "şifresi Lale2024.", (t) => heldPetLeak(t));
measure("evcil hayvan sızıntısı · kök tekrarı (ek gelmiyor)", N / 23, (n) => "kabul minik is very no ".repeat(n), (t) => heldPetLeak(t));
measure("evcil hayvan sızıntısı · sayı tekrarı (para birimi gelmiyor)", N / 8, (n) => "100 200 ".repeat(n), (t) => heldPetLeak(t));
measure("evcil hayvan sızıntısı · virgüllü yan cümle tekrarı", N / 7, (n) => "bilgi, ".repeat(n), (t) => heldPetLeak(t));
measure("evcil hayvan sızıntısı · Arap harfi dizisi", N / 2, (n) => "\u0627\u0644".repeat(n), (t) => heldPetLeak(t));
process.stdout.write(`${JSON.stringify({ done: true })}\n`);
