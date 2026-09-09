import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { buildReplyUserPrompt, packKnowledgeBase } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

// ---------------------------------------------------------------------------
// RAG dilim 1 — kanıt biçimi, istem notu ve mimari pinler.
// ---------------------------------------------------------------------------

describe("kanıt (buildKbEvidence) — parça + retrieval özeti", () => {
  const at = new Date("2026-09-01T10:00:00Z");

  it("legacy biçimi KARAKTERİ KARAKTERİNE korunur (chunk/retrieval yokken ek alan yok)", () => {
    const json = String(buildKbEvidence({ retrieved: [{ id: "kb_1", updatedAt: at }], usedLabels: ["kb:parking"] }));
    expect(JSON.parse(json)).toEqual({
      retrieved: [{ type: "kb_item", id: "kb_1", v: "2026-09-01T10:00:00.000Z" }],
      used: ["kb:parking"],
    });
    expect(json).not.toContain("retrieval");
    expect(json).not.toContain('"c"');
  });

  it("hibritte parça indeksi `c` ve PII'siz retrieval özeti yazılır", () => {
    const json = String(
      buildKbEvidence({
        retrieved: [{ id: "kb_1", updatedAt: at, chunk: 5 }],
        usedLabels: [],
        retrieval: { mode: "hybrid", q: 2, fb: "none", sel: 3, cand: 40, ms: 1.2 },
      }),
    );
    const parsed = JSON.parse(json);
    expect(parsed.retrieved).toEqual([{ type: "kb_item", id: "kb_1", v: "2026-09-01T10:00:00.000Z", c: 5 }]);
    expect(parsed.retrieval).toEqual({ mode: "hybrid", q: 2, fb: "none", sel: 3, cand: 40, ms: 1.2 });
    // Serbest metin/misafir metni/başlık YOK.
    expect(json).not.toMatch(/title|content|Otopark|guest/i);
  });

  it("dilim 2 alanları taşınır: srcs (kapalı küme, ≤4), sup ve conf sayıları; geçersiz değerler yazılmaz", () => {
    const json = String(
      buildKbEvidence({
        retrieved: [],
        usedLabels: [],
        retrieval: { mode: "hybrid", q: 1, fb: "none", sel: 2, cand: 30, ms: 1, srcs: ["bm25", "ngram", "x".repeat(40), "a", "b"], sup: 1, conf: 2 },
      }),
    );
    const parsed = JSON.parse(json).retrieval as { srcs: string[]; sup: number; conf: number };
    expect(parsed.srcs).toEqual(["bm25", "ngram", "x".repeat(16), "a"]);
    expect(parsed.sup).toBe(1);
    expect(parsed.conf).toBe(2);
    const bad = String(
      buildKbEvidence({
        retrieved: [],
        usedLabels: [],
        retrieval: { mode: "hybrid", q: 1, fb: "none", sel: 2, cand: 30, ms: 1, sup: 1.5, conf: -1 as number },
      }),
    );
    const badParsed = JSON.parse(bad).retrieval as { sup?: number; conf?: number };
    expect(badParsed.sup).toBeUndefined();
    expect(badParsed.conf).toBe(-1);
  });

  it("geçersiz chunk (negatif/kesirli) yazılmaz; geri çekilme kodu 24 karakterde kesilir", () => {
    const json = String(
      buildKbEvidence({
        retrieved: [
          { id: "a", updatedAt: at, chunk: -1 },
          { id: "b", updatedAt: at, chunk: 1.5 },
        ],
        usedLabels: [],
        retrieval: { mode: "hybrid", q: 1, fb: "x".repeat(100), sel: 0, cand: 0, ms: 0 },
      }),
    );
    const parsed = JSON.parse(json);
    expect(parsed.retrieved.every((r: { c?: number }) => r.c === undefined)).toBe(true);
    expect(parsed.retrieval.fb).toHaveLength(24);
  });

  it("retrieval özeti tek başına da kanıt yazdırır ('ölçtük, seçim yoktu' null değildir)", () => {
    const json = buildKbEvidence({
      retrieved: [],
      usedLabels: [],
      retrieval: { mode: "hybrid", q: 0, fb: "empty_query", sel: 0, cand: 12, ms: 0.3 },
    });
    expect(json).not.toBeNull();
    expect(JSON.parse(String(json)).retrieval.fb).toBe("empty_query");
  });

  it("tavan aşımında kırpılsa bile retrieval özeti korunur ve `omitted` yazılır", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `kb_${"x".repeat(30)}_${i}`, updatedAt: at, chunk: 0 }));
    const json = String(
      buildKbEvidence({ retrieved: many, usedLabels: [], retrieval: { mode: "hybrid", q: 1, fb: "none", sel: 400, cand: 400, ms: 2 } }),
    );
    expect(json.length).toBeLessThanOrEqual(4000);
    const parsed = JSON.parse(json);
    expect(parsed.omitted).toBeGreaterThan(0);
    expect(parsed.retrieval.mode).toBe("hybrid");
  });
});

describe("istem notu — seçilmiş kalemlerde DÜRÜST wording, davranış kuralı AYNI", () => {
  const item = { category: "parking", title: "Otopark", content: "Bina altı." };

  it("retrieved: 'SORUYA GÖRE SEÇİLDİ' der, 'yer sınırı' DEMEZ, 'insana devret' korunur", () => {
    const { text, omitted } = packKnowledgeBase([item], 7, "retrieved");
    expect(omitted).toBe(7);
    expect(text).toContain("SORUYA GÖRE SEÇİLDİ");
    expect(text).toContain("7 kalem bu yanıta alınmadı");
    expect(text).not.toContain("yer sınırı");
    expect(text).toContain("'bilgi yok' DEME");
    expect(text).toContain("insana devret");
  });

  it("all (varsayılan): eski wording birebir", () => {
    const { text } = packKnowledgeBase([item], 7);
    expect(text).toContain("7 kalemi yer sınırı nedeniyle");
    expect(text).not.toContain("SORUYA GÖRE");
  });

  it("retrieved ve 0 düşen: not YOK (gürültü yok)", () => {
    const { text } = packKnowledgeBase([item], 0, "retrieved");
    expect(text).not.toContain("[NOT]");
  });

  it("buildReplyUserPrompt `knowledgeBaseSelection`'ı paketleyiciye taşır", () => {
    const base: SuggestReplyInput = {
      guestMessage: "Otopark var mı?",
      property: { name: "Test", checkInTime: "15:00", checkOutTime: "11:00" },
      reservation: null,
      knowledgeBase: [item],
      knowledgeBaseDropped: 3,
      history: [],
      tone: "warm",
      language: "tr",
    };
    expect(buildReplyUserPrompt({ ...base, knowledgeBaseSelection: "retrieved" })).toContain("SORUYA GÖRE SEÇİLDİ");
    expect(buildReplyUserPrompt(base)).toContain("yer sınırı nedeniyle");
    expect(buildReplyUserPrompt({ ...base, knowledgeBaseSelection: "retrieved" })).not.toContain("kb_item");
  });
});

describe("mimari pinler", () => {
  it("retrieval modülü DB'ye ERİŞMEZ (yetki/onay/sır filtreleri retrieval'ın ÖNÜNDEDİR)", () => {
    for (const rel of ["select.ts", "bm25.ts", "chunker.ts", "index-cache.ts", "lexicon.ts", "text.ts", "semantic.ts", "flag.ts", "sources.ts", "fusion.ts", "rerank.ts"]) {
      const src = read(`src/lib/ai/retrieval/${rel}`);
      expect(src, rel).not.toMatch(/from "@\/lib\/db"/);
      expect(src, rel).not.toMatch(/prisma/);
      expect(src, rel).not.toMatch(/knowledgeBaseItem/);
      expect(src, rel).not.toMatch(/from "@\/lib\/hospitable/);
    }
  });

  it("bayrak TEK yerde okunur (retrieval/flag.ts); başka hiçbir dosya env'i kendi okumaz", () => {
    const flagReaders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.resolve(__dirname, "../../", dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && read(rel).includes("process.env.KB_RETRIEVAL_MODE")) flagReaders.push(rel);
      }
    };
    walk("src");
    expect(flagReaders).toEqual(["src/lib/ai/retrieval/flag.ts"]);
  });

  it("DÖRT AI yüzeyi seçiciden geçer ve seçilen kümeyi + düşen sayısını modele verir", () => {
    for (const rel of [
      "src/lib/automation.ts",
      "src/app/api/chat/[token]/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/app/api/ai/test/route.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("selectKbForPrompt(");
      expect(src, rel).toContain("knowledgeBaseSelection: kbSel.selection");
      expect(src, rel).toMatch(/knowledgeBase: kb(Sel\.items|ForModel)/);
    }
  });

  it("HOST'A ÖZEL graf katmanı misafir yoluna TAŞINMAZ: retrieval modülü ve QR rotası onu import etmez", () => {
    const guestPath = [
      "src/app/api/chat/[token]/route.ts",
      "src/lib/guest-chat.ts",
      ...["select.ts", "bm25.ts", "chunker.ts", "index-cache.ts", "lexicon.ts", "text.ts", "semantic.ts", "flag.ts", "sources.ts", "fusion.ts", "rerank.ts"].map(
        (f) => `src/lib/ai/retrieval/${f}`,
      ),
    ];
    for (const rel of guestPath) expect(read(rel), rel).not.toMatch(/modules\/intelligence\/graph/);
  });

  it("karar kaydı yazan iki yüzey retrieval kanıtını RiskEvent'e taşır", () => {
    for (const rel of ["src/lib/automation.ts", "src/app/api/chat/[token]/route.ts"]) {
      expect(read(rel), rel).toContain("retrieval: kbSel.evidence");
    }
  });

  it("seçici önce SÜZGEÇ sonra SEÇİM: QR yolunda seçici `ctx.knowledgeBase` (sır elemesinden geçmiş) üzerinde çalışır", () => {
    const src = read("src/app/api/chat/[token]/route.ts");
    expect(src).toMatch(/selectKbForPrompt\(\{\s*items: ctx\.knowledgeBase/);
    const auto = read("src/lib/automation.ts");
    // automation: `kbVisible` = sır süzgeçlerinden geçmiş küme.
    expect(auto).toMatch(/selectKbForPrompt\(\{\s*items: kbVisible/);
  });
});
