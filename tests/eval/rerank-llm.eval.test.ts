import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { selectKbForPrompt, retrievalQueries } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkItems, chunkKey, type KbChunk } from "@/lib/ai/retrieval/chunker";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { cosineOfUnit, embeddingModel, embedTexts, EMBEDDING_BATCH_MAX } from "@/lib/ai/embeddings/provider";
import {
  llmRerank,
  buildRerankRequest,
  unionTopCandidates,
  RERANK_MAX_CANDIDATES,
  RERANK_SYSTEM_PROMPT,
  type RerankCandidate,
} from "@/lib/ai/semantic/rerank";
import { semanticModel } from "@/lib/ai/semantic/config";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { e4Queries, semanticBySubquery, type E4Query } from "./e4-shared";

// ---------------------------------------------------------------------------
// #186 OPENAI YENİDEN SIRALAYICI — GERÇEK ÖLÇÜM (ücretli; kurucu kararı 09-26 "Önce ücretli ölçüm, sonra siz", < 1 $).
// Hat: üretim seçicisi + embedding (sem@0.3, E4 kazananı) → aday listesi (bütçe kesiminden önce; ölçüm kancası) →
// `llmRerank` (üretim modülü, anlam katmanının ağ kapısı) → seçici puanlarla YENİDEN koşar → cevap cümlesi istemde mi.
// Tavan teşhisi (`rerank-tavan-*.md`): kurtarılabilir kaçaklar ilk 20 adayda. Veri SENTETİK (E4 kümesi); gerçek misafir
// metni YOK. İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. `EVAL_RERANK_LIMIT=n` = boyut başına ilk n soru (DENEME, maliyet ölçümü).
// `EVAL_RERANK_SIZES` = "300" / "100,300". `EVAL_RERANK_MODEL` = model ezme (kıyas). Eksik koşu GEÇTİ diye okunamaz:
// yeniden sıralama çağrılarının %5'inden fazlası düşerse rapor GEÇERSİZ.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const NOW = Date.UTC(2026, 8, 23, 12);
const T = 0.3;
const LIMIT = Number(process.env.EVAL_RERANK_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_RERANK_LIMIT)) : null;
const SIZES = (process.env.EVAL_RERANK_SIZES?.trim() || "300")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n === 100 || n === 300 || n === 30);
const MODEL = process.env.EVAL_RERANK_MODEL?.trim() || semanticModel();
const SCALE_SAMPLE = 30;
const CONCURRENCY = 4;

interface RrRow {
  size: number;
  qid: string;
  group: E4Query["group"];
  base: boolean;
  rr: boolean;
  status: "ok" | "skipped" | "failed";
  ms: number;
  estTokens: number;
  cands: number;
}

const rows: RrRow[] = [];

function inPromptOf(q: E4Query, r: ReturnType<typeof selectKbForPrompt>): boolean {
  const text = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
  return (q.needleGroups ?? [q.needles]).every((g) => g.some((n) => text.includes(n)));
}

async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const pct = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)}%` : "—");
const quantile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

describe.skipIf(!enabled)("#186 OpenAI yeniden sıralayıcı — gerçek ölçüm (ücretli)", () => {
  afterAll(() => {
    if (rows.length === 0) return;
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      /* uydurma yazılmaz */
    }
    const calls = rows.filter((r) => r.status !== "skipped");
    const failed = calls.filter((r) => r.status === "failed").length;
    const valid = calls.length === 0 || failed / calls.length <= 0.05;
    const tokens = rows.reduce((n, r) => n + r.estTokens, 0);
    const lines = [
      `# #186 OpenAI yeniden sıralayıcı — ölçüm (${stamp})`,
      "",
      `Durum: **${valid ? "GEÇERLİ" : "GEÇERSİZ"}**${LIMIT ? ` · DENEME (boyut başına ilk ${LIMIT} soru)` : ""} · yeniden sıralama modeli \`${MODEL}\` · gömme \`${embeddingModel()}\` · commit \`${commit}\``,
      `Aday: ilk ${RERANK_MAX_CANDIDATES} (alt sorgular arası sırayla) · eşik ${T} · veri SENTETİK (E4 kümesi). Çağrı ${calls.length}, düşen ${failed}.`,
      `Tahmini girdi token (karakter/4): ${tokens.toLocaleString("tr-TR")} · gecikme p50 ${quantile(calls.map((r) => r.ms), 0.5)} ms · p95 ${quantile(calls.map((r) => r.ms), 0.95)} ms.`,
      "",
      "| boyut | grup | n | embedding (bugün) | + yeniden sıralama | kazanç | kayıp |",
      "|---|---|---|---|---|---|---|",
    ];
    for (const size of SIZES)
      for (const group of ["scale", "para", "multi"] as const) {
        const rs = rows.filter((r) => r.size === size && r.group === group);
        if (rs.length === 0) continue;
        const b = rs.filter((r) => r.base).length;
        const a = rs.filter((r) => r.rr).length;
        const win = rs.filter((r) => r.rr && !r.base).length;
        const loss = rs.filter((r) => r.base && !r.rr).length;
        lines.push(`| ${size} | ${group} | ${rs.length} | ${pct(b, rs.length)} | ${pct(a, rs.length)} | ${win} | ${loss} |`);
      }
    lines.push("", "Ölçü: cevap cümlesi istem bloğunda (çok sorulu mesajda İKİ cevap da). Kayıp = yeniden sıralama sonrası düşen.");
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `rerank-olcum-${stamp}${LIMIT ? "-deneme" : ""}.md`), lines.join("\n") + "\n", "utf8");
  });

  it("embedding + yeniden sıralama vs yalnız embedding", async () => {
    const perSize = SIZES.map((size) => {
      const kb = makeSyntheticKb(size);
      const poolItems = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const all = e4Queries(kb);
      let qs = [...all.filter((q) => q.group === "para"), ...all.filter((q) => q.group === "multi"), ...all.filter((q) => q.group === "scale").slice(0, SCALE_SAMPLE)];
      if (LIMIT) qs = qs.slice(0, LIMIT);
      return { size, pool: poolItems, chunks: chunkItems(poolItems), queries: qs };
    });
    const unique = new Set<string>();
    for (const s of perSize) {
      for (const c of s.chunks) unique.add(embeddingTextFor(c));
      for (const q of s.queries) for (const rq of retrievalQueries(q.text, undefined, { embedTexts: true }).queries) for (const t of rq.embedTexts) unique.add(t);
    }
    const allTexts = [...unique];
    const vec = new Map<string, number[]>();
    for (let i = 0; i < allTexts.length; i += EMBEDDING_BATCH_MAX) {
      const batch = allTexts.slice(i, i + EMBEDDING_BATCH_MAX);
      const out = await embedTexts(batch);
      if (!out) throw new Error("gömme başarısız — koşu GEÇERSİZ");
      batch.forEach((t, j) => vec.set(t, out[j]));
    }
    for (const s of perSize) {
      __resetKbIndexCache();
      const chunkVec = new Map(s.chunks.map((c) => [chunkKey(c), vec.get(embeddingTextFor(c))!]));
      const byKey = new Map(s.chunks.map((c) => [chunkKey(c), c] as const));
      const cos = (text: string, c: KbChunk) => cosineOfUnit(vec.get(text)!, chunkVec.get(chunkKey(c))!);
      const got = await pool(s.queries, CONCURRENCY, async (q) => {
        const bySubquery = semanticBySubquery(q.text, s.chunks, cos, T);
        const semInput = { semanticBySubquery: bySubquery, sources: { semanticFusion: "rrf" as const } };
        let lists: readonly (readonly { id: string; key: string }[])[] = [];
        const base = selectKbForPrompt({ items: s.pool, guestMessage: q.text, mode: "hybrid", now: NOW, ...semInput, onCandidates: (l) => (lists = l) });
        const keys = unionTopCandidates(lists, RERANK_MAX_CANDIDATES);
        const cands: RerankCandidate[] = keys.map((k) => ({ key: k, title: byKey.get(k)?.title ?? "", text: byKey.get(k)?.text ?? "" }));
        const est = Math.ceil((RERANK_SYSTEM_PROMPT.length + buildRerankRequest(q.text, cands).user.length) / 4);
        const out = await llmRerank(q.text, cands, [], { model: MODEL });
        const rr =
          out.status === "ok"
            ? selectKbForPrompt({ items: s.pool, guestMessage: q.text, mode: "hybrid", now: NOW, ...semInput, rerankScores: out.scores })
            : base;
        return {
          size: s.size,
          qid: q.id,
          group: q.group,
          base: inPromptOf(q, base),
          rr: inPromptOf(q, rr),
          status: out.status,
          ms: out.ms,
          estTokens: out.status === "skipped" ? 0 : est,
          cands: cands.length,
        } satisfies RrRow;
      });
      rows.push(...got);
    }
    expect(rows.length).toBe(perSize.reduce((n, s) => n + s.queries.length, 0));
  }, 1_200_000);
});
