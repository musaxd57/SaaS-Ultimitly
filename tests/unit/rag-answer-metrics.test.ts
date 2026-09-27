import { describe, it, expect } from "vitest";
import { foreignNumbers, numericAnchors, replyHasAnchor } from "../eval/rag-lab/answer-metrics";
import { parseConfig } from "../eval/rag-lab/config";
import { KB_RETRIEVAL_WIDE_CHAR_BUDGET, KB_RETRIEVAL_WIDE_MAX_CHUNKS } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// #189 RAG CEVAP DÜZEYİ ÖLÇÜLERİ (ücretli koşunun okunduğu sayılar; koşu pahalı, ölçü hatası ancak burada ucuza yakalanır).
// ---------------------------------------------------------------------------

describe("sayısal çapalar", () => {
  it("saat iki yazımda aynı çapa; tek hane çapa değil; ondalık virgül noktaya", () => {
    expect(numericAnchors("Giriş 15:00, çıkış 11.00; 2 havlu; ücret 12,5 €")).toEqual(["15.00", "11.00", "12.5"]);
  });

  it("cevap çapayı sayı sınırıyla söyler: 115.00 ≠ 15.00, 15:00 = 15.00", () => {
    expect(replyHasAnchor("Giriş saati 15:00'tir.", ["15.00"])).toBe(true);
    expect(replyHasAnchor("Ücret 115.00 TL.", ["15.00"])).toBe(false);
    expect(replyHasAnchor("Kod 4821.", ["48"])).toBe(false);
  });
});

describe("yabancı sayı — blokta başka kalemin olgusu", () => {
  it("🚨 dayanağı bilinen kaynaklarda olmayan sayı yakalanır (yanıtsız soruda başka kalemin saati)", () => {
    expect(foreignNumbers("Havuz 10:00'da açılır.", ["15:00", "11:00", "Havuz saat kaçta açılıyor?"])).toEqual(["10.00"]);
  });

  it("cevap cümlesi, mülk saati ve misafirin yazdığı sayı yabancı DEĞİL", () => {
    const allowed = ["Spa 10.00-20.00 arası açıktır.", "15:00", "11:00", "Saat 9:30'da gelsek olur mu?"];
    expect(foreignNumbers("Spa 10:00–20:00 arası açık; giriş 15.00, 9.30 uygun.", allowed)).toEqual([]);
  });

  it("sayısız cevap yabancı sayı taşımaz", () => {
    expect(foreignNumbers("Ev sahibinize iletildi.", [])).toEqual([]);
  });
});

describe("yapılandırma belirteci `wide` ve taban + belirteç", () => {
  it("🚨 `prod+wide` = canlının kendisi + üretimin geniş blok sabitleri (tek kaynak); taban alanları korunur", () => {
    const prod = parseConfig("prod");
    const cfg = parseConfig("prod+wide");
    expect(cfg.select).toEqual({ budgetChars: KB_RETRIEVAL_WIDE_CHAR_BUDGET, maxChunks: KB_RETRIEVAL_WIDE_MAX_CHUNKS });
    expect({ ...cfg, name: "prod", select: undefined }).toEqual({ ...prod, select: undefined });
    expect(prod.select).toBeUndefined();
  });

  it("`base0926` tabanı da belirteç alır; taban dışı zincir eskisi gibi; bilinmeyen belirteç fırlatır", () => {
    expect(parseConfig("base0926+wide").semantic).toEqual({ t: 0.4, model: "text-embedding-3-small" });
    expect(parseConfig("s0.4+und+wide")).toMatchObject({ semantic: { t: 0.4 }, understanding: true, rerank: null });
    expect(() => parseConfig("s0.4+genis")).toThrow(/bilinmeyen/);
    expect(() => parseConfig("lex+prod")).toThrow(/bilinmeyen/);
  });
});
