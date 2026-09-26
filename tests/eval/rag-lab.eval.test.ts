import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { SEMANTIC_COSINE_THRESHOLD } from "@/lib/ai/retrieval/semantic";
import { RERANK_MAX_CANDIDATES, RERANK_TEXT_CHARS } from "@/lib/ai/semantic/rerank";
import { KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { embeddingModel } from "@/lib/ai/embeddings/provider";
import { semanticModel } from "@/lib/ai/semantic/config";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { e4Queries } from "./e4-shared";
import { writeSidecar } from "./sidecar";
import { cacheStats, RAG_LAB_CACHE } from "./rag-lab/cache";
import { labRow, reportLines, type LabConfig, type LabItem, type LabQuery, type LabRow } from "./rag-lab/core";
import { buildScaleLab, loadScaleFile } from "./rag-lab/scale-set";

// ---------------------------------------------------------------------------
// RAG LAB — AŞAMA BAZLI KAYIP ÖLÇÜMÜ (#189, kurucu 09-26 gece modu: "300 kalemde bile ≥%95; önce ölçüyü düzeltin").
// Üretimin boru hattını (okuma tavanı · onay süzgeci · anlama katmanı · anlamsal eşik · yeniden sıralayıcı · bütçe) AYNEN
// koşar ve her kaçan cevabın hangi aşamada kaybolduğunu yazar (`rag-lab/core.ts`). Model çıktıları + gömmeler disk önbellekli.
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. Yapılandırmalar `EVAL_RAG_CONFIGS` (virgüllü ad listesi), boyutlar `EVAL_RAG_SIZES`,
// ücretli katmanın (anlama + yeniden sıralayıcı) grupları `EVAL_RAG_PAID_GROUPS`.
// Veri: E4 SENTETİK kümesi (konu başına tekrarlanan varyantlar — bilinen yapay zorluk; ayrı gerçekçi set ↓ dosyalar).
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const NOW = Date.UTC(2026, 8, 23, 12);

const T_PROD = SEMANTIC_COSINE_THRESHOLD;
const RR = { k: RERANK_MAX_CANDIDATES, crop: RERANK_TEXT_CHARS };
const CAP = KB_RETRIEVAL_FETCH_CAP;

export const LAB_CONFIGS: Record<string, LabConfig> = {
  lex: { name: "lex", semantic: null, understanding: false, rerank: null, fetchCap: CAP },
  "lex+und": { name: "lex+und", semantic: null, understanding: true, rerank: null, fetchCap: CAP },
  [`sem${T_PROD}`]: { name: `sem${T_PROD}`, semantic: { t: T_PROD }, understanding: false, rerank: null, fetchCap: CAP },
  "sem0.3": { name: "sem0.3", semantic: { t: 0.3 }, understanding: false, rerank: null, fetchCap: CAP },
  [`sem${T_PROD}+und`]: { name: `sem${T_PROD}+und`, semantic: { t: T_PROD }, understanding: true, rerank: null, fetchCap: CAP },
  "sem0.3+und": { name: "sem0.3+und", semantic: { t: 0.3 }, understanding: true, rerank: null, fetchCap: CAP },
  prod: { name: "prod", semantic: { t: T_PROD }, understanding: true, rerank: RR, fetchCap: CAP },
  "prod@0.3": { name: "prod@0.3", semantic: { t: 0.3 }, understanding: true, rerank: RR, fetchCap: CAP },
  "sem0.4+rr": { name: "sem0.4+rr", semantic: { t: 0.4 }, understanding: false, rerank: RR, fetchCap: CAP },
  "sem0.3+rr": { name: "sem0.3+rr", semantic: { t: 0.3 }, understanding: false, rerank: RR, fetchCap: CAP },
  "prod+fb": { name: "prod+fb", semantic: { t: T_PROD }, understanding: true, rerank: { ...RR, onFallback: true }, fetchCap: CAP },
  "prod@0.3+fb": { name: "prod@0.3+fb", semantic: { t: 0.3 }, understanding: true, rerank: { ...RR, onFallback: true }, fetchCap: CAP },
  "prod@0.3+fb+fused": { name: "prod@0.3+fb+fused", semantic: { t: 0.3 }, understanding: true, rerank: { ...RR, onFallback: true, window: "fused" }, fetchCap: CAP },
  "prod@0.3+fb+k30c400": { name: "prod@0.3+fb+k30c400", semantic: { t: 0.3 }, understanding: true, rerank: { k: 30, crop: 400, onFallback: true }, fetchCap: CAP },
  "prod@0.3+fb+fused30c400": {
    name: "prod@0.3+fb+fused30c400",
    semantic: { t: 0.3 },
    understanding: true,
    rerank: { k: 30, crop: 400, onFallback: true, window: "fused" },
    fetchCap: CAP,
  },
  "prod@0.3+fb+cap400": { name: "prod@0.3+fb+cap400", semantic: { t: 0.3 }, understanding: true, rerank: { ...RR, onFallback: true }, fetchCap: 400 },
  "lex+und+cap400": { name: "lex+und+cap400", semantic: null, understanding: true, rerank: null, fetchCap: 400 },
};

const CONFIGS = (process.env.EVAL_RAG_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["lex", `sem${T_PROD}`, "sem0.3", `sem${T_PROD}+und`, "prod", "prod@0.3"]).map(
  (n) => {
    const c = LAB_CONFIGS[n];
    if (!c) throw new Error(`bilinmeyen yapılandırma ${n}`);
    return c;
  },
);
const SIZES = (process.env.EVAL_RAG_SIZES?.split(",").map((s) => Number(s.trim())).filter((n) => n > 0) ?? [100, 300]) as number[];
const PAID_GROUPS = new Set(process.env.EVAL_RAG_PAID_GROUPS?.split(",").map((s) => s.trim()) ?? ["para", "multi", "neg"]);
const GROUPS = new Set(
  process.env.EVAL_RAG_GROUPS?.split(",").map((s) => s.trim()) ?? ["scale", "para", "multi", "neg", "single_tr", "single_xx", "draft", "version", "conflict"],
);
/** Hangi küme: e4 (sentetik tekrar) · scale (gerçekçi ayrı olgu, dev) · holdout (yalnız son doğrulama) — virgüllü. */
const KBS = new Set(process.env.EVAL_RAG_KB?.split(",").map((s) => s.trim()) ?? ["e4"]);
/** Gerçekçi set boyutları (0 = tamamı, ~300). */
const SCALE_SIZES = (process.env.EVAL_RAG_SCALE_SIZES?.split(",").map((s) => Number(s.trim())) ?? [60, 0]).filter((n) => Number.isFinite(n) && n >= 0);

export function e4LabSet(size: number): { items: LabItem[]; queries: LabQuery[] } {
  const kb = makeSyntheticKb(size);
  const items: LabItem[] = kb.items.map((i) => ({ ...i, reviewState: "legacy" }));
  const queries: LabQuery[] = e4Queries(kb).map((q) => ({
    id: q.id,
    group: q.group,
    cls: q.cls,
    lang: q.cls.endsWith("_en") || q.cls === "en" ? "en" : "tr",
    text: q.text,
    answers:
      q.group === "neg"
        ? []
        : q.needleGroups
          ? q.needleGroups.map((g, gi) => ({ needles: g, goldIds: q.goldGroups?.[gi] ?? q.goldIds }))
          : [{ needles: q.needles, goldIds: q.goldIds }],
  }));
  return { items, queries };
}

const isPaid = (c: LabConfig) => c.understanding || c.rerank !== null;

describe.skipIf(!enabled)("RAG LAB — aşama bazlı kayıp (gerçek gömme + önbellekli model)", () => {
  const rows: LabRow[] = [];
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetKbIndexCache();
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
    if (rows.length === 0) return;
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      /* uydurma yazılmaz */
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const meta = {
      commit,
      gömme: embeddingModel(),
      model: semanticModel(),
      "canlı eşik": T_PROD,
      "okuma tavanı": CAP,
      "yeniden sıralayıcı": `ilk ${RR.k} · kırpma ${RR.crop}`,
      "ücretli gruplar": [...PAID_GROUPS].join(","),
      önbellek: RAG_LAB_CACHE,
      çağrılar: cacheStats(),
    };
    const lines = reportLines(rows, `RAG lab — aşama bazlı kayıp (${stamp})`, meta);
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-lab-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-lab-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-lab", version: 1, meta, rows });
  });

  async function runSet(kbName: string, size: number, items: LabItem[], queries: LabQuery[]) {
    for (const cfg of CONFIGS) {
      const qs = queries.filter((q) => GROUPS.has(q.group) && (!isPaid(cfg) || PAID_GROUPS.has(q.group)));
      let i = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (i < qs.length) {
            const q = qs[i++];
            rows.push(await labRow(kbName, size, items, q, cfg, NOW));
          }
        }),
      );
    }
  }

  it.skipIf(!KBS.has("scale") && !KBS.has("holdout"))("gerçekçi ayrı olgu seti (dev / holdout)", async () => {
    for (const split of ["dev", "holdout"] as const) {
      if (!KBS.has(split === "dev" ? "scale" : "holdout")) continue;
      const file = loadScaleFile(split);
      if (!file) throw new Error(`evals/rag-scale/${split}.json yok — önce üretici (RAG_GEN=1)`);
      for (const size of SCALE_SIZES) {
        const { items, queries } = buildScaleLab(file, size || undefined);
        await runSet(split === "dev" ? "scale-dev" : "scale-holdout", size || items.length, items, queries);
      }
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 120 * 60_000);

  it.skipIf(!KBS.has("e4"))("E4 kümesi: boyut × yapılandırma × grup", async () => {
    for (const size of SIZES) {
      const { items, queries } = e4LabSet(size);
      for (const cfg of CONFIGS) {
        const qs = queries.filter((q) => GROUPS.has(q.group) && (!isPaid(cfg) || PAID_GROUPS.has(q.group)));
        let i = 0;
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (i < qs.length) {
              const q = qs[i++];
              rows.push(await labRow("e4", size, items, q, cfg, NOW));
            }
          }),
        );
      }
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 60 * 60_000);
});
