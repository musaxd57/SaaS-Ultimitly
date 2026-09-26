import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { SEMANTIC_COSINE_THRESHOLD } from "@/lib/ai/retrieval/semantic";
import { RERANK_HOT_PATH_DEADLINE_MS, RERANK_MAX_CANDIDATES, RERANK_TEXT_CHARS } from "@/lib/ai/semantic/rerank";
import { KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { embeddingModel } from "@/lib/ai/embeddings/provider";
import { semanticModel } from "@/lib/ai/semantic/config";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { e4Queries } from "./e4-shared";
import { writeSidecar } from "./sidecar";
import { cacheStats, RAG_LAB_CACHE } from "./rag-lab/cache";
import { labRow, latencyLines, reportLines, type LabConfig, type LabItem, type LabQuery, type LabRow } from "./rag-lab/core";
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

/**
 * Yapılandırma adı = "+" ile ayrılmış belirteçler (tek kaynak, deney eklemek kod değişikliği istemez):
 * `lex` (anlamsal yok) · `s0.3` (anlamsal, ham kosinüs eşiği) · `und` (anlama katmanı sorguları) · `rr20/600` (yeniden sıralayıcı: ilk
 * K aday / kırpma) · `fb` (geri çekilmede de sırala) · `fused` (pencere listeler arası RRF) · `mixed6` (önce özgün soru başına 6,
 * sonra RRF) · `pq` (soru başına etiket) · `dry` (modelsiz pencere tavanı) · `dl2500` (üretimin zaman aşımı tavanı) · `cap400`
 * (okuma tavanı) · `b9000` / `mc16` (seçim bütçesi karakter / parça) · `skip` (sığmayan parçayı atla) · `pi5` (kalem başına parça).
 * `prod` = canlının kendisi (s{canlı eşik}+und+rr20/600, 2,5 sn tavan, okuma 200).
 */
export function parseConfig(name: string): LabConfig {
  if (name === "prod") return { name, semantic: { t: T_PROD }, understanding: true, rerank: { ...RR, deadlineMs: RERANK_HOT_PATH_DEADLINE_MS }, fetchCap: CAP };
  const cfg: LabConfig = { name, semantic: null, understanding: false, rerank: null, fetchCap: CAP };
  for (const tok of name.split("+")) {
    let m: RegExpMatchArray | null;
    if (tok === "lex") cfg.semantic = null;
    else if ((m = tok.match(/^s(0\.\d+)$/))) cfg.semantic = { t: Number(m[1]) };
    else if (tok === "und") cfg.understanding = true;
    else if ((m = tok.match(/^rr(\d+)\/(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? {}), k: Number(m[1]), crop: Number(m[2]) };
    else if (tok === "fb") cfg.rerank = { ...(cfg.rerank ?? RR), onFallback: true };
    else if (tok === "fused") cfg.rerank = { ...(cfg.rerank ?? RR), window: "fused" };
    else if ((m = tok.match(/^mixed(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), window: "mixed", ownQuota: Number(m[1]) };
    else if (tok === "dry") cfg.rerank = { ...(cfg.rerank ?? RR), dry: true };
    else if (tok === "pq") cfg.rerank = { ...(cfg.rerank ?? RR), perQuestion: true };
    else if ((m = tok.match(/^cap(\d+)$/))) cfg.fetchCap = Number(m[1]);
    else if (tok === "e3l") cfg.semantic = { ...(cfg.semantic ?? { t: T_PROD }), model: "text-embedding-3-large" };
    else if ((m = tok.match(/^b(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), budgetChars: Number(m[1]) };
    else if ((m = tok.match(/^mc(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), maxChunks: Number(m[1]) };
    else if (tok === "skip") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), packing: "skip" } };
    else if ((m = tok.match(/^pi(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), maxChunksPerItem: Number(m[1]) } };
    else if ((m = tok.match(/^dl(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), deadlineMs: Number(m[1]) };
    else throw new Error(`bilinmeyen yapılandırma belirteci ${tok} (${name})`);
  }
  return cfg;
}

const CONFIGS = (process.env.EVAL_RAG_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["lex", `s${T_PROD}`, "s0.3", `s${T_PROD}+und`, "prod", "s0.3+und+rr20/600"]).map(parseConfig);
/** Tek soru gruplarından her N'inci soru (ücretli koşu bütçesi; 1 = hepsi). */
const SAMPLE = Math.max(1, Math.trunc(Number(process.env.EVAL_RAG_SAMPLE) || 1));
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

const isPaid = (c: LabConfig) => c.understanding || (c.rerank !== null && c.rerank.dry !== true);

describe.skipIf(!enabled)("RAG LAB — aşama bazlı kayıp (gerçek gömme + önbellekli model)", () => {
  const rows: LabRow[] = [];
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  /** Koşan her `it` sonunda artar; afterAll beklenenle kıyaslar. */
  let finished = 0;
  let started = 0;
  let complete = true;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetKbIndexCache();
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
    if (rows.length === 0) return;
    complete = finished === started;
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
    // EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ: bir `it` yarıda kaldıysa rapor başlığı GEÇERSİZ der (satırlar teşhis için yine yazılır).
    const title = complete ? `RAG lab — aşama bazlı kayıp (${stamp})` : `GEÇERSİZ — koşu yarıda kaldı — RAG lab (${stamp})`;
    const lines = reportLines(rows, title, { ...meta, durum: complete ? "tamam" : "YARIDA KALDI (sonuç sayılmaz)" });
    lines.push("", ...latencyLines(rows));
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-lab-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-lab-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-lab", version: 1, meta, rows });
  });

  async function runSet(kbName: string, size: number, items: LabItem[], queries: LabQuery[]) {
    for (const cfg of CONFIGS) {
      // Örnekleme GRUP İÇİ sırayla (09-26 hatası: genel sıra tr/xx dönüşümlü olduğu için "her 4." yalnız Türkçe soruları alıyordu).
      const seen = new Map<string, number>();
      const qs = queries.filter((q) => {
        if (!GROUPS.has(q.group) || (isPaid(cfg) && !PAID_GROUPS.has(q.group))) return false;
        if (!q.group.startsWith("single")) return true;
        const n = seen.get(q.group) ?? 0;
        seen.set(q.group, n + 1);
        return n % SAMPLE === 0;
      });
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
    started += 1;
    for (const split of ["dev", "holdout"] as const) {
      if (!KBS.has(split === "dev" ? "scale" : "holdout")) continue;
      const file = loadScaleFile(split);
      if (!file) throw new Error(`evals/rag-scale/${split}.json yok — önce üretici (RAG_GEN=1)`);
      for (const size of SCALE_SIZES) {
        const { items, queries } = buildScaleLab(file, size || undefined);
        await runSet(split === "dev" ? "scale-dev" : "scale-holdout", size || items.length, items, queries);
      }
    }
    finished += 1;
    expect(rows.length).toBeGreaterThan(0);
  }, 120 * 60_000);

  it.skipIf(!KBS.has("e4"))("E4 kümesi: boyut × yapılandırma × grup", async () => {
    started += 1;
    for (const size of SIZES) {
      const { items, queries } = e4LabSet(size);
      await runSet("e4", size, items, queries);
    }
    finished += 1;
    expect(rows.length).toBeGreaterThan(0);
  }, 60 * 60_000);
});
