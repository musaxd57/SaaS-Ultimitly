import { describe, it, expect } from "vitest";
import { Bm25Index } from "@/lib/ai/retrieval/bm25";
import { measureCost, costMessage } from "../helpers/linear-cost";

// J-1 (sızma testi 11-14): rastgele sözcüklerle doldurulmuş bilgi tabanı (≈ 30 kalem × 3.000 karakter) + uzun anlamsız sorgu. Bütçeden
// önce 800 bilinmeyen kök 1,6 sn sürüyordu (13,5 bin kök); bütçe tek `scores` çağrısını sözlük boyundan bağımsız sınırlar.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const ALPHA = "abcçdefgğhıijklmnoöprsştuüvyz";
function words(seed: number, n: number): string[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const len = 5 + Math.floor(r() * 8);
    let w = "";
    for (let i = 0; i < len; i++) w += ALPHA[Math.floor(r() * ALPHA.length)];
    return w;
  });
}
const INDEX = new Bm25Index(Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, title: `t${i}`, text: words(100 + i, 400).join(" ") })));
const QUERY_POOL = words(7, 4_000);
let offset = 0;
/** Her koşu YENİ kökler (yazım toleransı önbelleği ikinci koşuyu ucuzlatmasın — CLAUDE.md süre pini kuralı). */
const family = (n: number) => {
  const slice = QUERY_POOL.slice(offset % 3_000, (offset % 3_000) + n);
  offset += n;
  return new Map(slice.map((t) => [t, 1] as [string, number]));
};

describe("BM25 yazım toleransı — süre (rastgele sözlük + uzun anlamsız sorgu)", () => {
  it("800 bilinmeyen kök: sınırın altında — ya da doğrusal ve 4 katının altında", () => {
    const v = measureCost((q: Map<string, number>) => INDEX.scores(q), family, 800, 250);
    expect(v.ok, costMessage(v, 250)).toBe(true);
  });
});
