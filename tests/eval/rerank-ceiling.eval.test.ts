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
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { e4Queries, semanticBySubquery, type E4Query } from "./e4-shared";

// ---------------------------------------------------------------------------
// #186 YENİDEN SIRALAYICI — TAVAN TEŞHİSİ (09-26, ücretsiz: yalnız gömme, < 0,1 sent). Soru: E4'ün "kaçan" soruları
// neden kaçıyor? (a) cevap parçası ADAY listesinde hiç yok → yeniden sıralayıcı YARDIM EDEMEZ (aday üretimi sorunu);
// (b) listede ama bütçe kesiminin altında → yeniden sıralayıcının kurtarabileceği pay. Bu sayı kurucuya ücretli LLM
// yeniden sıralama ölçümünden ÖNCE sunulur (tavan düşükse ücretli ölçüm gereksiz). Seçim ÜRETİM seçicisinden; aday
// listesi seçicinin ölçüm kancasından (`onCandidates`, seçimi değiştirmez). Veri SENTETİK.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const NOW = Date.UTC(2026, 8, 23, 12);
const SIZES = [100, 300] as const;
const T = 0.3; // E4 kazananı (üretim varsayılanı)
const RERANK_TOP = 20; // yeniden sıralayıcıya gidecek aday sayısı (tasarım belgesi)

interface CeilRow {
  size: number;
  config: "lex" | "sem";
  qid: string;
  group: E4Query["group"];
  inPrompt: boolean;
  /** Kaçan sorularda: her iğne grubu için altın kalemin alt sorgu listelerindeki EN İYİ sırası (yoksa -1). */
  missRanks: number[];
}

function run(size: number, pool: ReturnType<typeof makeSyntheticKb>["items"], q: E4Query, config: CeilRow["config"], bySubquery?: Map<string, Map<string, number>>): CeilRow {
  let lists: readonly (readonly string[])[] = [];
  const r = selectKbForPrompt({
    items: pool,
    guestMessage: q.text,
    mode: "hybrid",
    now: NOW,
    ...(bySubquery ? { semanticBySubquery: bySubquery, sources: { semanticFusion: "rrf" as const } } : {}),
    onCandidates: (l) => {
      lists = l.map((list) => list.map((c) => c.id));
    },
  });
  const text = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
  const groups = q.needleGroups ?? [q.needles];
  const inPrompt = groups.every((g) => g.some((n) => text.includes(n)));
  const missRanks: number[] = [];
  if (!inPrompt) {
    // Kaçan HER cevap kendi altın kalemleriyle: çok sorulu mesajda bulunmuş cevabın sırası kaçanı temsil etmez.
    const goldGroups = q.goldGroups ?? [q.goldIds];
    groups.forEach((g, gi) => {
      if (g.some((n) => text.includes(n))) return;
      const gold = new Set(goldGroups[gi] ?? q.goldIds);
      let best = -1;
      for (const list of lists) {
        const i = list.findIndex((id) => gold.has(id));
        if (i >= 0 && (best < 0 || i < best)) best = i;
      }
      missRanks.push(best);
    });
  }
  return { size, config, qid: q.id, group: q.group, inPrompt, missRanks };
}

const rows: CeilRow[] = [];

describe.skipIf(!enabled)("#186 tavan teşhisi — kaçan cevap aday listesinde mi? (gerçek gömme, ücretsize yakın)", () => {
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
    const lines = [
      `# #186 yeniden sıralayıcı — tavan teşhisi (${stamp})`,
      "",
      `Gömme \`${embeddingModel()}\` · commit \`${commit}\` · eşik ${T} · veri SENTETİK (E4 kümesi). Ücretli LLM çağrısı YOK.`,
      "Soru: kaçan soruda cevap parçası aday listesinde mi? Listede ve ilk " +
        `${RERANK_TOP} içinde = yeniden sıralayıcının kurtarabileceği pay (TAVAN); listede yok = aday üretimi sorunu.`,
      "",
      "| boyut | kol | grup | n | isteme girdi | kaçan | kaçan: ilk " + RERANK_TOP + " adayda | kaçan: daha aşağıda | kaçan: listede YOK | tavan (girdi + ilk " + RERANK_TOP + ") |",
      "|---|---|---|---|---|---|---|---|---|---|",
    ];
    for (const size of SIZES)
      for (const config of ["lex", "sem"] as const)
        for (const group of ["scale", "para", "multi"] as const) {
          const rs = rows.filter((r) => r.size === size && r.config === config && r.group === group);
          if (rs.length === 0) continue;
          const inP = rs.filter((r) => r.inPrompt).length;
          const miss = rs.filter((r) => !r.inPrompt);
          // Kurtarılabilir = kaçan cevapların HEPSİ ilk N adayda; listede yok = en az biri hiç aday değil.
          const none = miss.filter((r) => r.missRanks.some((k) => k < 0)).length;
          const top = miss.filter((r) => r.missRanks.length > 0 && r.missRanks.every((k) => k >= 0 && k < RERANK_TOP)).length;
          const deep = miss.length - none - top;
          const pct = (x: number) => `${Math.round((100 * x) / rs.length)}%`;
          lines.push(`| ${size} | ${config} | ${group} | ${rs.length} | ${pct(inP)} | ${miss.length} | ${top} | ${deep} | ${none} | ${pct(inP + top)} |`);
        }
    lines.push("", "Not: çok sorulu satırda \"kaçan\" = iki cevaptan en az biri blokta değil; her kaçan cevap KENDİ altın kalemiyle ölçülür.");
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `rerank-tavan-${stamp}.md`), lines.join("\n") + "\n", "utf8");
  });

  it("E4 kümesinde lex ve sem@0.3 için kaçanların aday listesindeki yeri", async () => {
    const perSize = SIZES.map((size) => {
      const kb = makeSyntheticKb(size);
      const pool = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return { size, pool, chunks: chunkItems(pool), queries: e4Queries(kb).filter((q) => q.group !== "neg") };
    });
    const unique = new Set<string>();
    for (const s of perSize) {
      for (const c of s.chunks) unique.add(embeddingTextFor(c));
      for (const q of s.queries) for (const rq of retrievalQueries(q.text, undefined, { embedTexts: true }).queries) for (const t of rq.embedTexts) unique.add(t);
    }
    const all = [...unique];
    const vec = new Map<string, number[]>();
    for (let i = 0; i < all.length; i += EMBEDDING_BATCH_MAX) {
      const batch = all.slice(i, i + EMBEDDING_BATCH_MAX);
      const out = await embedTexts(batch);
      if (!out) throw new Error("gömme başarısız — koşu GEÇERSİZ");
      batch.forEach((t, j) => vec.set(t, out[j]));
    }
    for (const s of perSize) {
      __resetKbIndexCache();
      const chunkVec = new Map(s.chunks.map((c) => [chunkKey(c), vec.get(embeddingTextFor(c))!]));
      const cos = (text: string, c: KbChunk) => cosineOfUnit(vec.get(text)!, chunkVec.get(chunkKey(c))!);
      for (const q of s.queries) {
        rows.push(run(s.size, s.pool, q, "lex"));
        rows.push(run(s.size, s.pool, q, "sem", semanticBySubquery(q.text, s.chunks, cos, T)));
      }
    }
    expect(rows.length).toBe(perSize.reduce((n, s) => n + s.queries.length * 2, 0));
  }, 300_000);
});
