import { describe, it, expect } from "vitest";
import { Bm25Index, FUZZY_MIN_LEN, __fuzzyScanCount, fuzzyAllowance, osaDistance, osaDistanceWithin } from "@/lib/ai/retrieval/bm25";

// ---------------------------------------------------------------------------
// YAZIM HATASI EŞLEŞMESİ (BM25 fuzzy) — sınırlı uzaklık + önbellek, SONUÇ BİREBİR (10-01, 15 ajan incelemesi A14 — ÖLÇÜLDÜ).
// Eski tarama her (bilinmeyen kök, sözlük kökü) çifti için tam 2B tablo kuruyordu: 731 bilinmeyen kök × ~1.400 sözlük kökü 2,4 sn
// (misafirin 8.000 karakterlik anlamsız mesajı; bekleyen mesajlarla 7,7 sn — paylaşılan süreçte herkes bekler).
// ---------------------------------------------------------------------------

/** Tohumlu (deterministik) sözde rastgele üretici. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function word(r: () => number, alphabet: string, min: number, max: number): string {
  const len = min + Math.floor(r() * (max - min + 1));
  let w = "";
  for (let i = 0; i < len; i++) w += alphabet[Math.floor(r() * alphabet.length)];
  return w;
}

/** Eski algoritma (tam uzaklık, aynı eşitlik bozucu) — eşdeğerlik kâhini. */
function referenceFuzzy(vocab: readonly string[], term: string): string | null {
  const allow = fuzzyAllowance(term.length);
  if (allow === 0 || /\d/.test(term)) return null;
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const v of vocab) {
    if (Math.abs(v.length - term.length) > allow || v.length < FUZZY_MIN_LEN) continue;
    const dist = osaDistance(term, v);
    if (dist < bestDist || (dist === bestDist && best !== null && v < best)) {
      bestDist = dist;
      best = v;
    }
  }
  return bestDist <= allow ? best : null;
}

describe("osaDistanceWithin = min(osaDistance, max + 1)", () => {
  it("küçük alfabeli rastgele dizilerde (yer değiştirme bol) 30.000 çift BİREBİR", () => {
    const r = rng(20261001);
    let checked = 0;
    for (const alphabet of ["ab", "abc", "abcd", "aışçğ"]) {
      for (let k = 0; k < 7_500; k++) {
        const a = word(r, alphabet, 0, 12);
        const b = word(r, alphabet, 0, 12);
        const max = Math.floor(r() * 4);
        expect(osaDistanceWithin(a, b, max)).toBe(Math.min(osaDistance(a, b), max + 1));
        checked++;
      }
    }
    expect(checked).toBe(30_000);
  });

  it("yer değiştirme örnekleri: otopakr ↔ otopark = 1, ab ↔ ba = 1, ca ↔ abc = 3 (OSA) → sınırla", () => {
    expect(osaDistanceWithin("otopakr", "otopark", 1)).toBe(1);
    expect(osaDistanceWithin("ab", "ba", 2)).toBe(1);
    expect(osaDistance("ca", "abc")).toBe(3);
    expect(osaDistanceWithin("ca", "abc", 2)).toBe(3);
    expect(osaDistanceWithin("ca", "abc", 3)).toBe(3);
  });
});

describe("Bm25Index.fuzzy — sınırlı hesap + önbellek, seçim eski algoritmayla BİREBİR", () => {
  it("yakın kökleri bol rastgele sözlükte 3.000 sorgu kökünde aynı seçim (eşitlik bozucu dahil)", () => {
    const r = rng(7);
    const base = Array.from({ length: 120 }, () => word(r, "abcdeoiu", 4, 11));
    // Yakın komşular (tek / iki düzenleme) eşitlik durumlarını bol üretsin.
    const near = base.flatMap((w) => [w.slice(1), `${w}a`, w.replace(/a/, "e"), w.split("").reverse().join("")]);
    const docs = [...base, ...near].map((w, i) => ({ key: `d${i}`, title: "", text: w }));
    const idx = new Bm25Index(docs);
    const vocab = [...idx.df.keys()];
    expect(vocab.length).toBeGreaterThan(300);
    for (let k = 0; k < 3_000; k++) {
      const pick = vocab[Math.floor(r() * vocab.length)];
      const term = r() < 0.5 ? word(r, "abcdeoiu", 4, 12) : pick.slice(0, -1) + "x" + pick.slice(-1);
      expect(idx.fuzzy(term)).toBe(referenceFuzzy(vocab, term));
      // Önbellekten ikinci okuma aynı.
      expect(idx.fuzzy(term)).toBe(referenceFuzzy(vocab, term));
    }
  });

  it("önbellek: aynı bilinmeyen kök ikinci kez (başka alt sorguda) sözlüğü YENİDEN TARAMAZ, sonuç aynı", () => {
    const idx = new Bm25Index([{ key: "a", title: "Otopark", text: "otopark arka sokakta, havlular dolapta" }]);
    const before = __fuzzyScanCount();
    const first = idx.fuzzy("otopakr");
    expect(__fuzzyScanCount()).toBe(before + 1);
    expect(idx.fuzzy("otopakr")).toBe(first);
    idx.scores(new Map([["otopakr", 1]]));
    expect(__fuzzyScanCount()).toBe(before + 1);
    expect(first).toBe("otopark");
  });

  it("731 bilinmeyen kök × ~1.400 sözlük kökü → 300 ms altında (eski 2,4 sn)", () => {
    const r = rng(42);
    // Gerçek bir mülk bilgi tabanı boyutu: ~1.400 farklı kök, 60 kalem.
    const pool = Array.from({ length: 1_400 }, () => word(r, "abcdefghijklmnoprstuvyz", 5, 10));
    const docs = Array.from({ length: 60 }, (_, i) => ({
      key: `k${i}`,
      title: pool[Math.floor(r() * pool.length)],
      text: Array.from({ length: 300 }, () => pool[Math.floor(r() * pool.length)]).join(" "),
    }));
    const idx = new Bm25Index(docs);
    expect(idx.df.size).toBeGreaterThan(1_000);
    expect(idx.df.size).toBeLessThan(2_000);
    const query = new Map<string, number>();
    while (query.size < 731) {
      const w = word(r, "abcdefghijklmnoprstuvyz", 5, 12);
      if (!idx.df.has(w)) query.set(w, 1);
    }
    idx.scores(new Map([["isinma", 1]]));
    const t0 = performance.now();
    idx.scores(query);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
