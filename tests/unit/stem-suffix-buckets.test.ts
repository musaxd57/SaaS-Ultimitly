import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __stemSuffixOrder, stem } from "@/lib/ai/retrieval/text";

// ---------------------------------------------------------------------------
// KÖK ALMA — EK KOVALARI (O3 optimizasyon turu, 11-19). `stem` her turda ~110 ekin hepsini `endsWith` ile deniyordu; artık yalnız belirtecin
// SON HARFİYLE biten ekleri, tam listedeki sırayla dener. Eşdeğerliğin iki ayağı:
//   1) yapısal: her kova = tam sıralı listenin o harfle biten alt dizisi (sıra korunur) ve her ek tam bir kovada → "ilk uyan ek" aynı;
//   2) davranışsal: 11-19 öncesi uygulamanın 4.202 belirteçteki çıktısı (altın tablo — her ek × taban / korunan / düzensiz / yumuşayan /
//      İngilizce / kısa kökler, tamlayan freni zincirleri ve açık geliştirme setlerinden belirteçler) birebir.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stem — ek kovaları tam sıralı listeyle eşdeğer", () => {
  it("her kova, tam listenin o harfle biten eklerinin AYNI SIRADAKİ alt dizisi; her ek tam bir kovada", () => {
    const { all, byLastChar } = __stemSuffixOrder();
    expect(all.length).toBeGreaterThan(100);
    const lastChars = new Set(all.map((s) => s[s.length - 1]));
    expect([...byLastChar.keys()].sort()).toEqual([...lastChars].sort());
    for (const c of lastChars) expect(byLastChar.get(c)).toEqual(all.filter((s) => s.endsWith(c)));
    expect([...byLastChar.values()].reduce((n, b) => n + b.length, 0)).toBe(all.length);
  });

  it("11-19 öncesi uygulamanın altın tablosuyla birebir", () => {
    const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/stem-golden-2026-11-19.json"), "utf8")) as {
      tokens: string[];
      stems: string[];
    };
    expect(golden.tokens.length).toBe(golden.stems.length);
    expect(golden.tokens.length).toBeGreaterThan(4000);
    const diff = golden.tokens.filter((t, i) => stem(t) !== golden.stems[i]);
    expect(diff).toEqual([]);
  });
});

describe("stem — iş miktarı ek listesinin uzunluğuna bağlı değil", () => {
  it("hiçbir ekin bitmediği harfle biten belirteçte ek karşılaştırması yapılmaz", () => {
    const spy = vi.spyOn(String.prototype, "endsWith");
    expect(stem("kitap")).toBe("kitap");
    expect(spy).not.toHaveBeenCalled();
  });

  it("çok turlu sökümde karşılaştırma sayısı tur başına kova boyutuyla sınırlı", () => {
    const { byLastChar } = __stemSuffixOrder();
    const maxBucket = Math.max(...[...byLastChar.values()].map((b) => b.length));
    const spy = vi.spyOn(String.prototype, "endsWith");
    const out = stem("otoparklarimizdan");
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(out).toBe("otopark");
    // Üç söküm turu (-dan, -imiz, -lar) + ek bulunmayan son tur = 4 tur × en büyük kova; eski tam tarama tur başına tabanı tutan her eki
    // sınıyordu (ölçüldü: bu belirteçte 152).
    expect(calls).toBeLessThanOrEqual(4 * maxBucket);
    expect(maxBucket).toBeLessThan(40);
  });
});
