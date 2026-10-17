import { describe, it, expect } from "vitest";
import { parseSizeList, ragSetCountProblem, RAG_SET_MIN_ITEMS } from "../eval/eval-args";

// U18 (Codex 10-07): `EVAL_RERANK_SIZES=999` boş listeye süzülüp sıfır çağrıyla YEŞİL geçiyordu. Artık koşu başlamadan düşer.
describe("U18 — parseSizeList", () => {
  const rerank = { name: "EVAL_RERANK_SIZES", fallback: [300], allowed: [30, 100, 300] } as const;

  it("🚨 bilinmeyen boyut koşuyu düşürür (eskiden sessizce süzülüyordu)", () => {
    expect(() => parseSizeList("999", rerank)).toThrow(/geçersiz değer "999"/);
    expect(() => parseSizeList("100,abc", rerank)).toThrow(/"abc"/);
    expect(() => parseSizeList("1.5", { name: "X", fallback: [1], min: 1 })).toThrow();
    expect(() => parseSizeList("0", { name: "X", fallback: [1], min: 1 })).toThrow(/en az 1/);
  });

  it("🚨 yalnız virgüllerden oluşan liste boş sayılır → düşer", () => {
    expect(() => parseSizeList(",,", rerank)).toThrow(/boş liste/);
  });

  it("KONTROL: geçerli liste, sondaki virgül, ayarsız / boş ortam → varsayılan", () => {
    expect(parseSizeList("100,300", rerank)).toEqual([100, 300]);
    expect(parseSizeList("100, 300,", rerank)).toEqual([100, 300]);
    expect(parseSizeList(undefined, rerank)).toEqual([300]);
    expect(parseSizeList("  ", rerank)).toEqual([300]);
    expect(parseSizeList("60,0", { name: "S", fallback: [60, 0], min: 0 })).toEqual([60, 0]);
  });
});

// U19 (Codex 10-07): veri üretici yetersiz seti yazıp sonraki koşuda "var" diye geçiyordu → sayı denetimi yazmadan önce ve var olan dosyada.
describe("U19 — ragSetCountProblem", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
  it("🚨 boş toplu iş ([]) / eksik alan / az kalem / sıfır olgu geçersiz", () => {
    expect(ragSetCountProblem({ items: [], facts: [] })).toMatch(/items=0/);
    expect(ragSetCountProblem({})).toMatch(/items=0/);
    expect(ragSetCountProblem(null)).toMatch(/items=0/);
    expect(ragSetCountProblem({ items: items(RAG_SET_MIN_ITEMS - 1), facts: [1] })).toMatch(/en az/);
    expect(ragSetCountProblem({ items: items(300), facts: [] })).toBe("facts=0");
  });
  it("KONTROL: yeterli set geçerli", () => {
    expect(ragSetCountProblem({ items: items(300), facts: [1, 2] })).toBeNull();
  });
});
