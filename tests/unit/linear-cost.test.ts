import { describe, it, expect } from "vitest";
import {
  LINEAR_GROWTH_LIMIT,
  LINEAR_HARD_CAP_FACTOR,
  LINEAR_SHRINK,
  SCALED_FULL,
  costMessage,
  growthVerdict,
  measureCost,
  median,
  referee,
  scaled,
} from "../helpers/linear-cost";

// ---------------------------------------------------------------------------
// SÜRE PİNİ YARDIMCISI — "sınırın altında — ya da doğrusal ve tavanın altında" (`tests/helpers/linear-cost.ts`, 11-12, CI 1793).
// Karar SAHTE SAATLE sınanır (makineden bağımsız, kesin); en sonda gerçek saatle bir doğrusal ve bir karesel iş.
// ---------------------------------------------------------------------------

/** Sahte saat: `run` her çağrıda saati `cost(girdi uzunluğu, kaçıncı çağrı, önceki girdinin uzunluğu)` kadar ilerletir. */
function fakeWork(cost: (n: number, call: number, prev: number | null) => number) {
  let t = 0;
  const calls: number[] = [];
  return {
    now: () => t,
    run: (input: string) => {
      t += cost(input.length, calls.length, calls.length > 0 ? calls[calls.length - 1] : null);
      calls.push(input.length);
    },
    calls,
  };
}
const family = (n: number) => "a".repeat(n);
const LIMIT = 1_500;

describe("median", () => {
  it("tek / çift uzunluk, sırasız girdi; girdiyi değiştirmez", () => {
    const xs = [9, 1, 5];
    expect(median(xs)).toBe(5);
    expect(xs).toEqual([9, 1, 5]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(() => median([])).toThrow();
  });
});

describe("measureCost — 1. bölge: sınırın altında (bugünkü pinle birebir)", () => {
  it("tam girdi sınırın altındaysa geçer; başka hiçbir şey ölçülmez", () => {
    const w = fakeWork((n) => n / 100); // 16.000 → 160 ms
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: true, reason: "under_limit", full: 160 });
    expect(w.calls).toEqual([16_000]);
  });

  it("sınıra EŞİT süre sınırın altında değildir (eski `toBeLessThan` ile aynı kenar) → hakeme gider", () => {
    const w = fakeWork((n) => (n === 16_000 ? LIMIT : LIMIT / 16));
    expect(measureCost(w.run, family, 16_000, LIMIT, w.now).reason).toBe("linear");
  });
});

describe("measureCost — 2. bölge: sınırın 4 katı ve üstü kırmızıdır", () => {
  it("doğrusal iş bile olsa tavana ulaşan süre kalır; hakeme gidilmez (küçük girdi ölçülmez)", () => {
    const w = fakeWork((n) => (n * LIMIT * LINEAR_HARD_CAP_FACTOR) / 16_000); // tam boyut tam olarak tavan
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: false, reason: "over_cap", full: LIMIT * LINEAR_HARD_CAP_FACTOR });
    expect(w.calls).toEqual([16_000]);
  });

  it("tavanın hemen altı hakeme gider", () => {
    const w = fakeWork((n) => (n * (LIMIT * LINEAR_HARD_CAP_FACTOR - 1)) / 16_000);
    expect(measureCost(w.run, family, 16_000, LIMIT, w.now).reason).toBe("linear");
  });

  it("YALNIZ ilk çalıştırmada görülen patlama (sonrası hızlı ve doğrusal) tavanı aşıyorsa kalır", () => {
    // İlk çağrı 7 sn (yorumlayıcıda karesel kalıp gibi), sonraki çağrılar doğrusal ve hızlı.
    const w = fakeWork((n, call) => (call === 0 ? 7_000 : n / 100));
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("over_cap");
  });
});

describe("measureCost — 3. bölge: hakem (makine mi yavaş, iş mi doğrusal değil)", () => {
  it("doğrusal iş + yavaş makine → geçer (büyüme 16 kat)", () => {
    const w = fakeWork((n) => n / 8); // 16.000 → 2.000 ms (sınır 1.500), 1.000 → 125 ms
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: true, reason: "linear", full: 2_000, typical: 2_000, small: 125, growth: 16 });
  });

  it("karesel iş → kalır (büyüme 256 kat)", () => {
    const w = fakeWork((n) => (n * n) / 100_000); // 16.000 → 2.560 ms, 1.000 → 10 ms
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: false, reason: "superlinear", full: 2_560, typical: 2_560, small: 10, growth: 256 });
  });

  it("n log n iş doğrusal sayılır (büyüme ~22 kat) — pin karesel işi arar", () => {
    const w = fakeWork((n) => (n * Math.log2(n)) / 100);
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v.ok).toBe(true);
    expect(v.reason).toBe("linear");
  });

  it("doğrusal + karesel karışım: karesel pay baskınsa kalır, doğrusal pay baskınsa geçer", () => {
    // Tam boyutta doğrusal 1.000 ms + karesel 4.000 ms → büyüme 5.000 / (62,5 + 15,6) = 64.
    const heavy = fakeWork((n) => n / 16 + (4_000 * n * n) / (16_000 * 16_000));
    expect(measureCost(heavy.run, family, 16_000, LIMIT, heavy.now)).toMatchObject({ ok: false, reason: "superlinear" });
    // Tam boyutta doğrusal 1.600 ms + karesel 400 ms → büyüme 2.000 / (100 + 1,6) ≈ 19,7.
    const light = fakeWork((n) => n / 10 + (400 * n * n) / (16_000 * 16_000));
    expect(measureCost(light.run, family, 16_000, LIMIT, light.now)).toMatchObject({ ok: true, reason: "linear" });
  });

  it("🚨 soğuk koşunun bir kerelik payı doğrusal işi karesel göstermez (ölçüldü: soğuk ölçümle oran 15–54 oynuyordu)", () => {
    // İlk çağrı 3.100 ms bir kerelik pay + 1.000 ms iş = 4.100 ms; sonrası doğrusal (16.000 → 1.000 ms, 1.000 → 62,5 ms).
    // Yalnız soğuk ölçümle oran 4.100 / 62,5 = 65,6 (kırmızı olurdu); tam girdinin ortancasıyla 16.
    const w = fakeWork((n, call) => n / 16 + (call === 0 ? 3_100 : 0));
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: true, reason: "linear", full: 4_100, typical: 1_000, small: 62.5, growth: 16 });
  });

  it("🚨 ÖNBELLEK KÖRLÜĞÜ YOK: aynı girdinin art arda koşusunda önbellekten dönen iş, dönüşümlü koşuda gerçek maliyetiyle ölçülür", () => {
    // Ürün kodundaki tek girişli içerik önbelleğinin modeli: önceki çağrı AYNI girdiyse iş ucuz (doğrusal), değilse gerçek iş (karesel).
    // Aynı girdiyi art arda koşan bir hakem yalnız ucuz yolu görür ve "doğrusal" derdi; dönüşümlü hakemde her koşu gerçek iştir.
    const w = fakeWork((n, _call, prev) => (prev === n ? n / 100 : (n * n) / 100_000));
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: false, reason: "superlinear", full: 2_560, typical: 2_560, small: 10, growth: 256 });
  });

  it("🚨 önbellek isabeti doğrusal işi karesel de göstermez: küçük girdi art arda koşsaydı ortancası önbellekli (ucuz) koşu olurdu", () => {
    // Gerçek iş doğrusal (16.000 → 2.000 ms, 1.000 → 125 ms); önceki çağrı AYNI girdiyse önbellekten döner (n / 100).
    // Art arda (küçük ×3, tam ×2) ölçülseydi: küçükler [125, 10, 10] → 10; tamlar [2.000, 2.000, 160] → 2.000 → 200 kat (sahte kırmızı;
    // canlıda ölçülen 35–45 katın sebebi buydu). Dönüşümlü koşuda iki taraf da gerçek iş: 16 kat.
    const w = fakeWork((n, _call, prev) => (prev === n ? n / 100 : n / 8));
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toEqual({ ok: true, reason: "linear", full: 2_000, typical: 2_000, small: 125, growth: 16 });
  });

  it("🚨 sonraki ölçüm sınırın altında diye test GEÇMEZ: ısındıktan sonra hızlı ama karesel iş kalır", () => {
    // Soğuk 2.000 ms (sınır aşıldı). Sonraki tam koşular 1.280 ms (sınırın ALTINDA) ama karesel: 1.000 → 5 ms → büyüme 256.
    const w = fakeWork((n, call) => (call === 0 ? 2_000 : (n * n) / 200_000));
    const v = measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(v).toMatchObject({ ok: false, reason: "superlinear", typical: 1_280, growth: 256 });
  });

  it("tek bir duraklama (tam ya da küçük koşuda) hükmü değiştirmez — iki tarafta da ortanca", () => {
    // Çağrılar: [tam 2.000] [küçük 125] [tam 9.000 — duraklama] [küçük 125] [tam 2.000] [küçük 125] … (tam 5, küçük 5).
    const stalledFull = fakeWork((n, call) => (call === 2 ? 9_000 : n / 8));
    expect(measureCost(stalledFull.run, family, 16_000, LIMIT, stalledFull.now)).toMatchObject({ ok: true, typical: 2_000, growth: 16 });
    // Karesel işte küçük koşulardan biri duraklarsa (10 → 900 ms) oran küçülmez.
    const stalledSmall = fakeWork((n, call) => (call === 3 ? 900 : (n * n) / 100_000));
    expect(measureCost(stalledSmall.run, family, 16_000, LIMIT, stalledSmall.now)).toMatchObject({ ok: false, small: 10, growth: 256 });
  });

  it("çağrı sırası DÖNÜŞÜMLÜ: tam (soğuk) → küçük → tam → … → küçük (tam 5, küçük 5); aynı girdi art arda koşmaz", () => {
    const w = fakeWork((n) => (n * n) / 100_000);
    measureCost(w.run, family, 16_000, LIMIT, w.now);
    expect(w.calls).toEqual([16_000, 1_000, 16_000, 1_000, 16_000, 1_000, 16_000, 1_000, 16_000, 1_000]);
  });

  it("🚨 hafif karesel artış (karesel pay doğrusalın ~3 katı) kalır; ~1,5 katı geçer — hakemin ayırma gücü ölçülü ve belgeli", () => {
    // Ürün koduna eklenen mutantın ölçülen hâli: doğrusal 520 ms + karesel 1.670 ms = 2.190 ms → büyüme 256 × 4,21 / 19,2 ≈ 56 (kalır).
    const caught = fakeWork((n) => (520 * n) / 16_000 + (1_670 * n * n) / (16_000 * 16_000));
    const v = measureCost(caught.run, family, 16_000, LIMIT, caught.now);
    expect(v).toMatchObject({ ok: false, reason: "superlinear" });
    expect(v.reason === "superlinear" && Math.round(v.growth)).toBe(56);
    // Doğrusal 1.000 ms + karesel 1.500 ms → büyüme ≈ 36,6: GEÇER. Bu aralık (karesel pay ≤ ~1,8 × doğrusal) bilerek görülmez —
    // doğrusal işin ölçüm gürültüsünden (12–24) ayırt edilemez; eski mutlak pin bunu yalnız hızlı makinede yakalıyordu.
    const missed = fakeWork((n) => n / 16 + (1_500 * n * n) / (16_000 * 16_000));
    expect(measureCost(missed.run, family, 16_000, LIMIT, missed.now)).toMatchObject({ ok: true, reason: "linear" });
  });

  it("küçük boyut n / 16'ya yuvarlanır (16'nın katı olmayan boyut) ve en az 1'dir", () => {
    const w = fakeWork(() => 2_000);
    measureCost(w.run, family, 25_000, LIMIT, w.now);
    expect(w.calls[1]).toBe(Math.round(25_000 / LINEAR_SHRINK));
    const tiny = fakeWork(() => 2_000);
    measureCost(tiny.run, family, 3, LIMIT, tiny.now);
    expect(tiny.calls[1]).toBe(1);
  });

  it("aile her boyut için bir kez kurulur (tam + küçük)", () => {
    const sizes: number[] = [];
    const w = fakeWork(() => 2_000);
    const counted = (n: number) => {
      sizes.push(n);
      return family(n);
    };
    measureCost(w.run, counted, 16_000, LIMIT, w.now);
    expect(sizes).toEqual([16_000, 1_000]);
  });
});

describe("growthVerdict — saf karar", () => {
  it("sınır 40 kat: 39,9 geçer, 40 kalır", () => {
    expect(LINEAR_GROWTH_LIMIT).toBe(40);
    expect(growthVerdict([39.9, 39.9, 39.9], [1, 1, 1]).ok).toBe(true);
    expect(growthVerdict([LINEAR_GROWTH_LIMIT, LINEAR_GROWTH_LIMIT, LINEAR_GROWTH_LIMIT], [1, 1, 1]).ok).toBe(false);
  });

  it("iki tarafta da ORTANCA: en hızlı / en yavaş tek koşu oranı belirlemez; `full` ilk (soğuk) ölçümdür", () => {
    // Küçükte en hızlısı alınsaydı 2.000 / 10 = 200 kat (sahte kırmızı) olurdu.
    expect(growthVerdict([2_000, 2_000, 2_000], [10, 100, 100])).toMatchObject({ ok: true, small: 100, growth: 20 });
    // Küçükte en yavaşı alınsaydı karesel iş doğrusal görünürdü.
    expect(growthVerdict([2_560, 2_560, 2_560], [10, 10, 900])).toMatchObject({ ok: false, small: 10, growth: 256 });
    // Tamda en küçüğü alınsaydı (400) oran 4 çıkardı; en büyüğüyle 90. Ortanca 2.000 → 20.
    expect(growthVerdict([9_000, 400, 2_000], [100, 100, 100])).toMatchObject({ full: 9_000, typical: 2_000, growth: 20 });
  });

  it("küçük girdi ölçülemeyecek kadar hızlıysa (0 ms) oran sonsuzdur → kalır", () => {
    expect(growthVerdict([2_000, 2_000, 2_000], [0, 0, 0])).toMatchObject({ ok: false, growth: Number.POSITIVE_INFINITY });
  });
});

describe("scaled — hazır tablolardaki girdiler için ölçekli aile", () => {
  it("tam boyutta `birim.repeat(sayı)` ile BİREBİR; 1/16'da her tekrarın on altıda biri", () => {
    const fam = scaled((r) => "klima " + r("çok ", 1_000) + "bozuldu");
    expect(fam(SCALED_FULL)).toBe("klima " + "çok ".repeat(1_000) + "bozuldu");
    expect(fam(1)).toBe("klima " + "çok ".repeat(62) + "bozuldu");
  });

  it("kesirli sayı `repeat` gibi aşağı yuvarlanır; ölçek en az 1 tekrar bırakır; birden çok tekrar birlikte ölçeklenir", () => {
    expect(scaled((r) => r("ab", 4_000 / 17))(SCALED_FULL)).toBe("ab".repeat(4_000 / 17));
    expect(scaled((r) => r("x", 8))(1)).toBe("x");
    const two = scaled((r) => r("a", 160) + "|" + r("b", 320));
    expect(two(SCALED_FULL)).toBe("a".repeat(160) + "|" + "b".repeat(320));
    expect(two(1)).toBe("a".repeat(10) + "|" + "b".repeat(20));
  });

  it("measureCost ile: tam = SCALED_FULL, küçük = 1", () => {
    const seen: number[] = [];
    const w = fakeWork(() => 2_000);
    const run = (s: string) => {
      seen.push(s.length);
      w.run(s);
    };
    measureCost(run, scaled((r) => r("ab", 1_600)), SCALED_FULL, LIMIT, w.now);
    expect(seen).toEqual([3_200, 200, 3_200, 200, 3_200, 200, 3_200, 200, 3_200, 200]);
  });
});

describe("costMessage — kırmızı testte ne olduğu okunur", () => {
  it("dört hâl", () => {
    expect(costMessage({ ok: true, reason: "under_limit", full: 160 }, LIMIT)).toBe("160 ms (sınır 1500 ms)");
    expect(costMessage({ ok: false, reason: "over_cap", full: 7_000 }, LIMIT)).toContain("4 katına ulaştı");
    const green = costMessage({ ok: true, reason: "linear", full: 2_000, typical: 1_900, small: 125, growth: 15.2 }, LIMIT);
    expect(green).toContain("doğrusal iş, yavaş makine");
    const red = costMessage({ ok: false, reason: "superlinear", full: 2_560, typical: 2_560, small: 10, growth: 256 }, LIMIT);
    expect(red).toContain("iş doğrusal DEĞİL");
    expect(red).toContain("256.0 kat");
  });
});

// Gerçek saat: hakem DOĞRUDAN çağrılır (sınır / tavan devrede değil — süre birkaç kat oynasa da test aynı dalı sınar).
// İş saf işlemci döngüsüdür (bellek / kalıp yok).
describe("referee — gerçek saatle doğrusal ve karesel iş", () => {
  const linear = (s: string) => {
    let x = 0;
    for (let r = 0; r < 4_000; r++) for (let i = 0; i < s.length; i++) x = (x + s.charCodeAt(i) * (r + 1)) % 1_000_003;
    return x;
  };
  const quadratic = (s: string) => {
    let x = 0;
    for (let i = 0; i < s.length; i++) for (let j = 0; j < s.length; j += 4) x = (x + s.charCodeAt(j) + i) % 1_000_003;
    return x;
  };
  const cold = (work: (s: string) => unknown, input: string) => {
    const t0 = performance.now();
    work(input);
    return performance.now() - t0;
  };
  const full = family(16_000);
  const small = family(1_000);

  it("doğrusal döngü → geçer (büyüme ~16 kat)", () => {
    linear(small);
    const v = referee(linear, full, small, cold(linear, full));
    expect(v.ok, costMessage(v, 0)).toBe(true);
  });

  it("karesel döngü → kalır (büyüme ~256 kat)", () => {
    quadratic(small);
    const v = referee(quadratic, full, small, cold(quadratic, full));
    expect(v.ok, costMessage(v, 0)).toBe(false);
    if (v.reason === "superlinear") expect(v.growth).toBeGreaterThan(100);
  });
});
