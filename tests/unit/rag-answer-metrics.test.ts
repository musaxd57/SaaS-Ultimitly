import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { answerAnchorHits, foreignNumbers, numericAnchors, replyHasAnchor } from "../eval/rag-lab/answer-metrics";
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

describe("iki sorulu mesaj — her sorunun cevabı AYRI eşleşir (Codex 09-27)", () => {
  const answers = [{ needles: ["Giriş saati 15:00'tir."] }, { needles: ["Otopark günlük 250 TL'dir."] }];

  it("🚨 yalnız bir sorunun sayısını söyleyen yanıt BAŞARI DEĞİL (eskiden herhangi bir çapa yetiyordu)", () => {
    const reply = "Giriş 15:00'te yapılır.";
    expect(replyHasAnchor(reply, answers.flatMap((a) => numericAnchors(a.needles[0])))).toBe(true); // eski ölçü: başarı
    expect(answerAnchorHits(reply, answers)).toEqual({ anchored: 2, hit: 1, all: false });
  });

  it("iki cevabın sayısı da yanıtta → başarı; sayı sınırı korunur (115.00 ≠ 15.00)", () => {
    expect(answerAnchorHits("Giriş 15:00, otopark günlük 250 TL.", answers)).toEqual({ anchored: 2, hit: 2, all: true });
    expect(answerAnchorHits("Ücret 115.00; otopark 250 TL.", answers)).toEqual({ anchored: 2, hit: 1, all: false });
  });

  it("sayı taşımayan cevap sayılmaz; hiç sayılı cevap yoksa hüküm yok (null)", () => {
    const mixed = [{ needles: ["Havlular dolapta."] }, { needles: ["Çıkış 11:00."] }];
    expect(answerAnchorHits("Çıkış 11:00.", mixed)).toEqual({ anchored: 1, hit: 1, all: true });
    expect(answerAnchorHits("Havlular dolapta.", [{ needles: ["Havlular dolapta."] }])).toEqual({ anchored: 0, hit: 0, all: null });
  });

  it("bağlantı: cevap ölçeri mesaj başarısını `answerAnchorHits(...).all` ile verir (kaynak pini — ücretli koşu burada sınanamaz)", () => {
    const src = readFileSync(path.resolve(__dirname, "../eval/rag-answer.eval.test.ts"), "utf8");
    expect(src).toMatch(/const hits = answerAnchorHits\(out\.reply, q\.answers\);/);
    expect(src).toMatch(/anchorHit: hits\.all,/);
    expect(src).not.toMatch(/replyHasAnchor\(out\.reply, anchors\)/);
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

  it("`rrm:` / `rre:` yalnız yeniden sıralayıcının modelini / çabasını değiştirir; geçersiz çaba fırlatır", () => {
    const cfg = parseConfig("prod+rrm:gpt-6-luna+rre:low");
    expect(cfg.rerank).toMatchObject({ model: "gpt-6-luna", effort: "low" });
    expect({ ...cfg, name: "prod", rerank: { ...cfg.rerank, model: undefined, effort: undefined } }).toEqual({
      ...parseConfig("prod"),
      rerank: { ...parseConfig("prod").rerank, model: undefined, effort: undefined },
    });
    expect(() => parseConfig("prod+rre:turbo")).toThrow(/bilinmeyen/);
  });

  it("`base0926` tabanı da belirteç alır; taban dışı zincir eskisi gibi; bilinmeyen belirteç fırlatır", () => {
    expect(parseConfig("base0926+wide").semantic).toEqual({ t: 0.4, model: "text-embedding-3-small" });
    expect(parseConfig("s0.4+und+wide")).toMatchObject({ semantic: { t: 0.4 }, understanding: true, rerank: null });
    expect(() => parseConfig("s0.4+genis")).toThrow(/bilinmeyen/);
    expect(() => parseConfig("lex+prod")).toThrow(/bilinmeyen/);
  });
});
