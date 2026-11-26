import { describe, it, expect } from "vitest";
import { Bm25Index, FUZZY_BUDGET_PER_QUERY, __fuzzyBudgetSkipCount } from "@/lib/ai/retrieval/bm25";

// ---------------------------------------------------------------------------
// SORGU BAŞINA YAZIM TOLERANSI BÜTÇESİ (sızma testi 11-14, J-1). Karşılaştırma SAYISI sınırsızdı: rastgele sözcüklerle doldurulmuş bilgi
// tabanı + uzun anlamsız mesaj tek istekte olay döngüsünü saniyelerce kilitliyordu (ölçüm `bm25.ts` FUZZY_BUDGET_PER_QUERY yorumunda).
// Dürüst kullanımda seçim DEĞİŞMEZ (ölçülen en kötü dürüst çağrı tavanın ~25'te biri); bütçe önbellekten bağımsız düşülür.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const ALPHA = "abcdefghijklmnoprstuvyz";
function words(seed: number, n: number, min = 6, max = 7): string[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const len = min + Math.floor(r() * (max - min + 1));
    let w = "";
    for (let i = 0; i < len; i++) w += ALPHA[Math.floor(r() * ALPHA.length)];
    return w;
  });
}
const KB = [
  { key: "a", title: "Otopark", text: "Otopark binanın arkasında, ücretsiz. Kablosuz internet şifresi yatak odasındaki kartta." },
  { key: "b", title: "Çıkış", text: "Çıkış saati 11:00. Anahtarı kutuya bırakın. Klimanın kumandası çekmecede." },
];

describe("yazım toleransı bütçesi", () => {
  it("dürüst sorgu: varsayılan bütçeyle sonuç bütçesizle BİREBİR (otopakr → otopark)", () => {
    const idx = new Bm25Index(KB);
    const q = new Map([
      ["otopakr", 1],
      ["kumnada", 1],
    ]);
    const withBudget = idx.scores(q);
    const unlimited = new Bm25Index(KB).scores(q, Number.POSITIVE_INFINITY);
    expect([...withBudget.resolved]).toEqual([...unlimited.resolved]);
    expect([...withBudget.scores]).toEqual([...unlimited.scores]);
    expect(withBudget.resolved.get("otopakr")).toBe("otopark");
    expect(FUZZY_BUDGET_PER_QUERY).toBe(250_000);
  });

  it("🚨 bütçe bitince kalan bilinmeyen kökler toleranssız geçer (sayaç artar); maliyet uzunluk bandındaki sözlük kökü sayısı", () => {
    const vocab = words(11, 400);
    const idx = new Bm25Index([{ key: "v", title: "x", text: vocab.join(" ") }]);
    // Sözlükteki iki kökün tek harfi değişmiş hâli → ikisi de bütçesiz çözülür.
    const t1 = `${vocab[0]!.slice(0, -1)}q`;
    const t2 = `${vocab[1]!.slice(0, -1)}q`;
    const q = new Map([
      [t1, 1],
      [t2, 1],
    ]);
    const cost = idx.fuzzyCost(t1);
    expect(cost).toBeGreaterThan(0);
    expect(new Bm25Index([{ key: "v", title: "x", text: vocab.join(" ") }]).scores(q, Number.POSITIVE_INFINITY).resolved.size).toBe(2);
    const before = __fuzzyBudgetSkipCount();
    const r = idx.scores(q, cost); // yalnız ilk kökün maliyeti kadar
    expect(r.resolved.get(t1)).toBe(vocab[0]);
    expect(r.resolved.has(t2)).toBe(false);
    expect(__fuzzyBudgetSkipCount()).toBe(before + 1);
  });

  it("🚨 önbellekten bağımsız: önceden çözülmüş (önbellekteki) kök de bütçeden düşer → sıcak / soğuk aynı sonuç", () => {
    const vocab = words(12, 400);
    const items = [{ key: "v", title: "x", text: vocab.join(" ") }];
    const t1 = `${vocab[0]!.slice(0, -1)}q`;
    const t2 = `${vocab[1]!.slice(0, -1)}q`;
    const q = new Map([
      [t1, 1],
      [t2, 1],
    ]);
    const cold = new Bm25Index(items);
    const budget = cold.fuzzyCost(t1);
    const coldRes = cold.scores(q, budget).resolved;
    const warm = new Bm25Index(items);
    warm.scores(new Map([[t2, 1]])); // t2 önbelleğe girer
    const warmRes = warm.scores(q, budget).resolved;
    expect([...warmRes]).toEqual([...coldRes]);
    expect(warmRes.has(t2)).toBe(false);
  });

  it("sözlükte geçen, kısa ya da rakamlı kök bütçeye dokunmaz", () => {
    const idx = new Bm25Index(KB);
    expect(idx.fuzzyCost("otopark")).toBeGreaterThan(0);
    expect(idx.fuzzyCost("ab12cd")).toBe(0);
    expect(idx.fuzzyCost("kutu")).toBe(0);
    const r = idx.scores(new Map([["otopark", 1], ["ab12cd", 1]]), 0);
    expect(r.scores.some((s) => s > 0)).toBe(true);
  });
});
