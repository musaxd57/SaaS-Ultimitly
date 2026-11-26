// ---------------------------------------------------------------------------
// SÜRE PİNİ: "SINIRIN ALTINDA — YA DA DOĞRUSAL VE TAVANIN ALTINDA" (11-12, CI 1793).
//
// Sorun: `*-cost.test.ts` pinleri "50.000 karakter 1,5 sn altında" gibi MUTLAK süre ölçer; amaç karesel işi yakalamaktır. Sınır hızlı
// makinede seçildi. İş doğrusal ama sabiti büyükse (yan cümle başına dedektör) süre sınıra yaklaşır ve yavaş makinede DOĞRUSAL iş de sınırı
// aşar: private depodaki küçük çalıştırıcıda bir vaka 1.617 ms ölçtü (yerelde 945–1.113 ms; iki commit arasında fark yok, 4.000 → 32.000
// yan cümlede süre uzunlukla orantılı). Yavaş makine benzetiminde (6–8 işlemci yiyici, ~2–2,5 kat) sekiz dosyada on iki pin kırmızıydı.
// Sınırı büyütmek ya da testi yeniden denemek pini gevşetir (`ci.yml`: "yeniden deneme, gevşetilmiş sınır YOK"); girdiyi küçültmek hafif
// karesel artışı gizler.
//
// Kural — üç bölge (ilk, SOĞUK ölçüm karar verir; sınır değişmedi):
//   1) süre < sınır                → YEŞİL (bugünkü pinle birebir; başka hiçbir şey ölçülmez)
//   2) süre ≥ sınırın 4 katı       → KIRMIZI (hangi makinede olursa olsun; ilk çalıştırmaya özgü patlama da buraya düşer)
//   3) arada                       → hakem: makine mi yavaş, iş mi doğrusal değil? Aynı girdi AİLESİNİN 1/16 boyutu aynı süreçte ölçülür:
//        doğrusal iş → süre girdiyle birlikte ~16 kat büyür        karesel iş → ~256 kat
//        40 kattan az büyüdüyse (doğrusalın 2,5 katı; karesele 6 kattan fazla pay) YEŞİL, değilse KIRMIZI.
//      Makine iki kat yavaşsa iki süre de iki kat uzar, oran değişmez.
//
// 🚨 3. bölge bir ÖLÇÜM TEKRARIDIR, bunu saklamıyoruz: tam girdi iki kez daha koşar. Ama hüküm "sonraki koşu sınırın altında mı"
// sorusuyla DEĞİL, yalnız büyüme oranıyla verilir — ısınınca hızlanan ama karesel kalan iş kırmızıdır (testi var). 1. ve 2. bölgenin
// kararı yeniden verilmez.
//
// Hakemin ölçüm kuralları (her biri ölçülmüş bir gürültü / körlük kaynağını kapatır):
//   · koşular DÖNÜŞÜMLÜDÜR: küçük → tam → küçük → tam → … (küçük 5, tam 4 kez). Aynı girdi art arda koşmaz. Ürün kodunda içeriğe göre son sonucu saklayan
//     tek girişli önbellekler var (`fallback.ts` `foldedCacheKey`, `relation.ts` `lastTopicsInput`); aynı girdinin art arda koşusu
//     önbellekten döner (ölçüldü: aynı tam girdi 905 → 363 → 347 ms; araya başka girdi girince yine 834 ms). Art arda ölçüm önbellekli
//     işi görmez — orada karesel bir gerileme olsa hakem kör kalırdı (Opus incelemesi 11-12). Dönüşümlü koşuda her ölçüm gerçek iştir;
//   · iki tarafta da ORTANCA alınır (tam: soğuk + 4, küçük: 5). En hızlısı alınsaydı işlemci paylaşımında kısa koşu kesintiye uğramadan
//     biter, uzun koşu uğrar ve oran yapay büyürdü; tek bir duraklama ya da soğuk koşunun bir kerelik derleme payı ortancayı kaydırmaz
//     (ölçüldü: oran soğuk ölçümle doğrusal işte 15–54 arasında oynuyordu; dönüşümlü + ortanca ile 12–24).
//   · sınır neden 40: doğrusal işlerin ölçülen bandı 12–24; ürün koduna eklenen hafif karesel bir mutant (karesel pay doğrusalın ~3 katı)
//     56 kat büyüme verir — 48 sınırıyla gürültüde kaçıyordu (mutasyon koşusunda yaşadı), 40 ile kalır.
//   · çok girişli bir içerik önbelleği eklenirse dönüşüm onu atlatmaz — o gün aileye koşu başına değişen içerik eklenmelidir.
//
// Görmediği (bilerek): sınırın altında kalan hafif karesel artış (bugünkü pin de görmez); sınır ile tavan arasında kalıp karesel payı
// doğrusal payının ~1,8 katını geçmeyen artış (pahalı ailede bu pay büyür — pin en çok orada gevşedi; bedeli budur); YALNIZ bir girdinin
// ilk koşusunda görülen ve tavanın altında kalan yavaşlık (kalıbın yorumlayıcıda koşması: `regex-worst-mode-cost.test.ts` o sınıfın bir
// kısmını iki kötü kalıp kipinde ayrı süreçte ölçer).
// ---------------------------------------------------------------------------

/** Tam girdi küçük girdinin kaç katı. */
export const LINEAR_SHRINK = 16;
/** Hakem bölgesinde sürenin en çok kaç kat büyümüş olabileceği (doğrusal ≈ 16, karesel ≈ 256). */
export const LINEAR_GROWTH_LIMIT = 40;
/** Soğuk ölçüm sınırın bu katına ulaşırsa hakeme gidilmez — kırmızı. */
export const LINEAR_HARD_CAP_FACTOR = 4;
/** Hakemde küçük girdinin koşu sayısı; tam girdi aralarda (bir eksik) koşar: küçük → tam → küçük → tam → … → küçük. */
const REFEREE_SMALL_RUNS = 5;

export type CostVerdict =
  | { ok: true; reason: "under_limit"; full: number }
  | { ok: false; reason: "over_cap"; full: number }
  | { ok: true; reason: "linear"; full: number; typical: number; small: number; growth: number }
  | { ok: false; reason: "superlinear"; full: number; typical: number; small: number; growth: number };

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median: boş dizi");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Hakem bölgesinin hükmü — saf (saat okumaz). `fullRuns[0]` soğuk tam ölçümdür; oran = ortanca(tam) / ortanca(küçük). Küçük girdi
 * ölçülemeyecek kadar hızlıysa oran sonsuzdur (kırmızı).
 */
export function growthVerdict(fullRuns: readonly number[], smallRuns: readonly number[]): CostVerdict {
  const full = fullRuns[0];
  const typical = median(fullRuns);
  const small = median(smallRuns);
  const growth = small > 0 ? typical / small : Number.POSITIVE_INFINITY;
  return growth < LINEAR_GROWTH_LIMIT
    ? { ok: true, reason: "linear", full, typical, small, growth }
    : { ok: false, reason: "superlinear", full, typical, small, growth };
}

/** 3. bölgenin ölçümü: `cold` daha önce alınmış soğuk tam ölçümdür; küçük ve tam girdi dönüşümlü koşar. */
export function referee<T>(
  run: (input: T) => unknown,
  fullInput: T,
  smallInput: T,
  cold: number,
  now: () => number = () => performance.now(),
): CostVerdict {
  const time = (input: T) => {
    const t0 = now();
    run(input);
    return now() - t0;
  };
  const fullRuns = [cold];
  const smallRuns: number[] = [];
  for (let i = 0; i < REFEREE_SMALL_RUNS; i++) {
    smallRuns.push(time(smallInput));
    if (i < REFEREE_SMALL_RUNS - 1) fullRuns.push(time(fullInput));
  }
  return growthVerdict(fullRuns, smallRuns);
}

/**
 * `run(family(n))` süresi `limitMs` altındaysa geçer; `limitMs`in 4 katına ulaştıysa kalır. Arada `family(n / 16)` ile kıyaslanır: süre
 * 40 kattan az büyüdüyse (doğrusal iş, yavaş makine) geçer, değilse kalır. `n` ailenin boyutudur (tekrar / karakter sayısı).
 */
export function measureCost<T>(
  run: (input: T) => unknown,
  family: (n: number) => T,
  n: number,
  limitMs: number,
  now: () => number = () => performance.now(),
): CostVerdict {
  const fullInput = family(n);
  const t0 = now();
  run(fullInput);
  const cold = now() - t0;
  if (cold < limitMs) return { ok: true, reason: "under_limit", full: cold };
  if (cold >= limitMs * LINEAR_HARD_CAP_FACTOR) return { ok: false, reason: "over_cap", full: cold };
  return referee(run, fullInput, family(Math.max(1, Math.round(n / LINEAR_SHRINK))), cold, now);
}

/** `birim.repeat(sayı)` yerine geçen ölçekli tekrar. */
export type Repeat = (unit: string, count: number) => string;

/**
 * Birden çok tekrarı olan / hazır tablolardaki girdiler için aile kurucu: `build` girdiyi `r(birim, sayı)` çağrılarıyla kurar; dönen aile
 * `k` = 16'da `birim.repeat(sayı)` ile BİREBİR aynı girdiyi, `k` = 1'de her tekrarın 1/16'sını (en az 1) verir.
 * Kullanım: `measureCost(run, scaled((r) => "klima " + r("çok ", 1_000) + "bozuldu"), SCALED_FULL, sınır)`.
 */
export function scaled<T>(build: (r: Repeat) => T): (k: number) => T {
  return (k) => build((unit, count) => unit.repeat(Math.max(1, Math.floor((count * k) / LINEAR_SHRINK))));
}
/** `scaled` ailesinin tam boyutu. */
export const SCALED_FULL = LINEAR_SHRINK;

/** Kırmızı testin okunur açıklaması (`expect(v.ok, costMessage(v, limit)).toBe(true)`). */
export function costMessage(v: CostVerdict, limitMs: number): string {
  if (v.reason === "under_limit") return `${v.full.toFixed(0)} ms (sınır ${limitMs} ms)`;
  if (v.reason === "over_cap") {
    return `${v.full.toFixed(0)} ms — sınırın (${limitMs} ms) ${LINEAR_HARD_CAP_FACTOR} katına ulaştı; hakeme gidilmez`;
  }
  return (
    `${v.full.toFixed(0)} ms — sınır ${limitMs} ms aşıldı; tam girdinin ortancası ${v.typical.toFixed(0)} ms, 1/${LINEAR_SHRINK} boyutlu ` +
    `girdinin ortancası ${v.small.toFixed(1)} ms → ${v.growth.toFixed(1)} kat büyüme (doğrusal ≈ ${LINEAR_SHRINK}, sınır ` +
    `${LINEAR_GROWTH_LIMIT}): ${v.ok ? "doğrusal iş, yavaş makine" : "iş doğrusal DEĞİL"}`
  );
}
