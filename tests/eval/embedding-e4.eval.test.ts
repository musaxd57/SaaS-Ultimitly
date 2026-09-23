import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkItems, chunkKey, type KbChunk } from "@/lib/ai/retrieval/chunker";
import { SEMANTIC_QUALIFY_MIN } from "@/lib/ai/retrieval/semantic";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { cosineOfUnit, embeddingModel, embedTexts, EMBEDDING_BATCH_MAX } from "@/lib/ai/embeddings/provider";
import { makeSyntheticKb, type SyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { PARAPHRASES, NEGATIVES } from "../helpers/kb-paraphrase-set";
import { writeSidecar } from "./sidecar";

// ---------------------------------------------------------------------------
// E4 — ANLAMSAL ADAY KAYNAĞI ÖLÇÜMÜ (09-23). Soru: embedding kosinüsü ÜRETİMDEKİ seçiciye üçüncü
// kaynak olarak girerse (E0: eşik + RRF zaten hazır) sözcüksel yöntemin YAPISAL olarak kaçırdığı
// parafraz sorularda cevap bloğa girer mi, ve bunun bedeli (ölçek sorularında gerileme, negatif
// sorularda blok şişmesi) ne?
//
// · Veri SENTETİK (`kb-retrieval-synthetic` + `kb-paraphrase-set`): gerçek misafir/host metni YOK.
// · Gömme ÜRETİM istemcisinden (`embedTexts`) ve ÜRETİMDE kullanılacak metinle (`embeddingTextFor`).
// · Seçim ÜRETİM seçicisinden (`selectKbForPrompt({ semantic })`); eşik taraması seçiciyi DEĞİŞTİRMEDEN,
//   kesin artan bir dönüşümle yapılır (s' ≥ SEMANTIC_QUALIFY_MIN ⇔ s ≥ t; RRF yalnız sıraya bakar).
// · Aynı iki kapı: RUN_REAL_EVAL=1 + gerçek anahtar, `npm run eval`. Maliyet: ~1.000 metin, ~30k token,
//   text-embedding-3-small ile < 0,1 sent. Bu ortamda (09-23) hesap KREDİSİZ → koşu kurucunun.
// · Karar ölçütü (E5 = üretime bağlama): parafraz inPrompt belirgin artmalı · ölçek sınıfı %99'un altına
//   inmemeli · negatif sorgularda blok şişmemeli. Ölçüm belgesi: docs/olcum/kb-retrieval-parafraz-2026-09-23.md
// ---------------------------------------------------------------------------

export const E4_SIZES = [30, 100, 300] as const;
export const E4_THRESHOLDS = [0.3, 0.35, 0.4, 0.45, 0.5] as const;
const NOW = Date.UTC(2026, 8, 23, 12);

export type E4Group = "scale" | "para" | "neg";
export interface E4Query {
  id: string;
  group: E4Group;
  cls: string;
  text: string;
  goldIds: string[];
  needles: string[];
}

export function e4Queries(kb: SyntheticKb): E4Query[] {
  const out: E4Query[] = kb.questions.map((q) => ({ id: q.id, group: "scale", cls: q.kind, text: q.text, goldIds: q.goldIds, needles: q.needles }));
  for (const p of PARAPHRASES) {
    const ref = p.gold.startsWith("guide:")
      ? kb.questions.find((q) => q.id === `q_guide_${p.gold.slice(6)}`)
      : kb.questions.find((q) => q.topic === p.gold && q.kind === "tr");
    if (ref) out.push({ id: p.id, group: "para", cls: `para_${p.lang}`, text: p.text, goldIds: ref.goldIds, needles: ref.needles });
  }
  for (const n of NEGATIVES) out.push({ id: n.id, group: "neg", cls: `neg_${n.lang}`, text: n.text, goldIds: [], needles: [] });
  return out;
}

export interface E4Row {
  size: number;
  config: string;
  qid: string;
  group: E4Group;
  cls: string;
  inPrompt: boolean;
  hit1: boolean;
  fb: string;
  chars: number;
  noise: number;
}

export function runE4(size: number, pool: SyntheticKb["items"], q: E4Query, config: string, semantic?: ReadonlyMap<string, number>): E4Row {
  const r = selectKbForPrompt({ items: pool, guestMessage: q.text, mode: "hybrid", now: NOW, ...(semantic ? { semantic } : {}) });
  const ids: string[] = [];
  for (const it of r.items) if (!ids.includes(it.id)) ids.push(it.id);
  const text = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
  const gold = new Set(q.goldIds);
  return {
    size,
    config,
    qid: q.id,
    group: q.group,
    cls: q.cls,
    inPrompt: q.needles.some((n) => text.includes(n)),
    hit1: r.selection === "retrieved" && !!ids[0] && gold.has(ids[0]),
    fb: r.evidence?.fb ?? "none",
    chars: text.length,
    noise: ids.filter((id) => !gold.has(id)).length,
  };
}

/** Kesin artan dönüşüm: s' ≥ SEMANTIC_QUALIFY_MIN ⇔ s ≥ t (t = eşik ise birim). */
export function thresholdTransform(s: number, t: number): number {
  const m = SEMANTIC_QUALIFY_MIN;
  if (Math.abs(t - m) < 1e-12) return s;
  if (s <= 0) return 0;
  return s < t ? (m * s) / t : m + ((1 - m) * (s - t)) / (1 - t);
}

export function semanticMap(chunks: readonly KbChunk[], cosOf: (c: KbChunk) => number | null, t: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of chunks) {
    const cos = cosOf(c);
    if (cos === null) continue;
    const v = thresholdTransform(cos, t);
    if (v > 0) m.set(chunkKey(c), v);
  }
  return m;
}

export interface E4Agg {
  n: number;
  inPrompt: number;
  hit1: number;
  fb: number;
  chars: number;
  noise: number;
}

export function aggregateE4(rows: readonly E4Row[]): Map<string, E4Agg> {
  const out = new Map<string, E4Agg>();
  for (const r of rows) {
    const k = `${r.size}|${r.config}|${r.group}`;
    const a = out.get(k) ?? { n: 0, inPrompt: 0, hit1: 0, fb: 0, chars: 0, noise: 0 };
    a.n++;
    a.inPrompt += +r.inPrompt;
    a.hit1 += +r.hit1;
    a.fb += +(r.fb !== "none");
    a.chars += r.chars;
    a.noise += r.noise;
    out.set(k, a);
  }
  return out;
}

const pct = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)}%` : "—");

export function buildE4Report(rows: readonly E4Row[], meta: Record<string, unknown>): string {
  const agg = aggregateE4(rows);
  const configs = ["lex", ...E4_THRESHOLDS.map((t) => `sem@${t}`)];
  const lines = [
    `# E4 — anlamsal aday kaynağı ölçümü (${String(meta.stamp)})`,
    "",
    `Model: \`${String(meta.model)}\` · commit \`${String(meta.commit)}\` · gömülen metin ${String(meta.texts)} · veri SENTETİK.`,
    "Ölçü: inPrompt = cevap cümlesi istem bloğunda · hit@1 = seçilen ilk kalem altın · fb = geri çekilme sayısı · blok = ortalama karakter.",
    "Karar ölçütü (E5): parafraz inPrompt belirgin artmalı · ölçek %99'un altına inmemeli · negatifte blok şişmemeli.",
    "",
  ];
  for (const size of E4_SIZES) {
    lines.push(`## ${size} (sentetik n)`, "", "| config | ölçek inPrompt | ölçek hit@1 | parafraz inPrompt | parafraz hit@1 | parafraz fb | negatif fb | negatif blok |", "|---|---|---|---|---|---|---|---|");
    for (const c of configs) {
      const s = agg.get(`${size}|${c}|scale`);
      const p = agg.get(`${size}|${c}|para`);
      const ng = agg.get(`${size}|${c}|neg`);
      if (!s || !p || !ng) continue;
      lines.push(
        `| ${c} | ${pct(s.inPrompt, s.n)} | ${pct(s.hit1, s.n)} | ${pct(p.inPrompt, p.n)} | ${pct(p.hit1, p.n)} | ${p.fb}/${p.n} | ${ng.fb}/${ng.n} | ${Math.round(ng.chars / ng.n)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── çevrimdışı pinler (gerçek çağrı YOK) ──────────────────────────────────

describe("E4 — çevrimdışı pinler (ölçüm düzeneğinin kendisi)", () => {
  beforeAll(() => __resetKbIndexCache());

  it("sözcüksel taban ölçüm belgesiyle tutarlı: 100'lük KB'de parafrazın çoğu KAÇIYOR, ölçek sınıfı tam", () => {
    const kb = makeSyntheticKb(100);
    const pool = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const rows = e4Queries(kb).map((q) => runE4(100, pool, q, "lex"));
    const agg = aggregateE4(rows);
    const s = agg.get("100|lex|scale")!;
    const p = agg.get("100|lex|para")!;
    expect(s.inPrompt / s.n).toBeGreaterThanOrEqual(0.99);
    expect(p.n).toBe(82);
    expect(p.inPrompt / p.n).toBeLessThan(0.5); // ölçülen %38 — anlamsal kaynağın kapatması gereken açık
  });

  it("🚨 ANLAMSAL KANAL SEÇİCİYE GERÇEKTEN ULAŞIYOR: kâhin kosinüs (altın 0,9 / diğerleri 0,1) parafrazı kurtarır", () => {
    // Sessiz no-op'a karşı: düzenek anlamsal puanı seçiciye iletmiyorsa ölçüm "embedding işe yaramadı"
    // diye YANLIŞ karar üretirdi. Kâhinle parafraz inPrompt'u sözcüksel tabanın çok üstüne çıkmalı.
    const kb = makeSyntheticKb(100);
    const pool = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const chunks = chunkItems(pool);
    const qs = e4Queries(kb).filter((q) => q.group === "para");
    const oracle = qs.map((q) => {
      const gold = new Set(q.goldIds);
      return runE4(100, pool, q, "oracle", semanticMap(chunks, (c) => (gold.has(c.id) ? 0.9 : 0.1), 0.3));
    });
    const lex = qs.map((q) => runE4(100, pool, q, "lex"));
    const rate = (rs: E4Row[]) => rs.filter((r) => r.inPrompt).length / rs.length;
    expect(rate(oracle)).toBeGreaterThanOrEqual(0.9);
    expect(rate(oracle) - rate(lex)).toBeGreaterThan(0.4);
  });

  it("eşik dönüşümü kesin artan ve eşdeğer: s ≥ t ⇔ s' ≥ SEMANTIC_QUALIFY_MIN", () => {
    for (const t of E4_THRESHOLDS) {
      let prev = -1;
      for (let i = 0; i <= 1000; i++) {
        const s = i / 1000;
        const v = thresholdTransform(s, t);
        if (s > 0) expect(v).toBeGreaterThan(prev);
        prev = v;
        expect(v >= SEMANTIC_QUALIFY_MIN - 1e-12, `t=${t} s=${s}`).toBe(s >= t - 1e-12);
      }
    }
  });

  it("rapor her boyut ve yapılandırma için satır üretir (eksik veri sessizce yeşil görünmez)", () => {
    const rows: E4Row[] = [];
    for (const size of E4_SIZES) for (const config of ["lex", ...E4_THRESHOLDS.map((t) => `sem@${t}`)]) for (const group of ["scale", "para", "neg"] as const) {
      rows.push({ size, config, qid: "x", group, cls: group, inPrompt: true, hit1: true, fb: "none", chars: 10, noise: 0 });
    }
    const md = buildE4Report(rows, { stamp: "t", model: "m", commit: "c", texts: 0 });
    expect(md.match(/^\| (lex|sem@)/gm)?.length).toBe(E4_SIZES.length * (1 + E4_THRESHOLDS.length));
  });
});

// ─── gerçek ölçüm (kurucu koşar) ───────────────────────────────────────────

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

describe.skipIf(!enabled)("E4 — GERÇEK embedding ölçümü (ücretli, < 0,1 sent)", () => {
  const rows: E4Row[] = [];
  let texts = 0;

  afterAll(() => {
    if (rows.length === 0) return; // gömme başarısızsa rapor YAZILMAZ (eksik ölçüm "sonuç" sayılmaz)
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const runId = `${now.toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    let commit: string | null = null;
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || null;
    } catch {
      /* uydurma değer yazılmaz */
    }
    const meta = { stamp, runId, model: embeddingModel(), commit, texts };
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const name = `eval-e4-${stamp}-${runId}.md`;
    writeFileSync(path.join(dir, name), buildE4Report(rows, meta), "utf8");
    writeSidecar(dir, name, { suite: "embedding-e4", version: 1, meta, rows });
  });

  it("tüm metinler gömülür ve her boyut × yapılandırma ölçülür", async () => {
    const perSize = E4_SIZES.map((size) => {
      const kb = makeSyntheticKb(size);
      const pool = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return { size, pool, chunks: chunkItems(pool), queries: e4Queries(kb) };
    });
    const unique = new Set<string>();
    for (const s of perSize) {
      for (const c of s.chunks) unique.add(embeddingTextFor(c));
      for (const q of s.queries) unique.add(q.text);
    }
    const all = [...unique];
    texts = all.length;
    const estTokens = Math.ceil(all.reduce((n, t) => n + t.length, 0) / 2.5);
    console.log(`[eval-e4] ${all.length} metin, ~${estTokens} token (tahmin), model ${embeddingModel()}`);
    const vec = new Map<string, number[]>();
    for (let i = 0; i < all.length; i += EMBEDDING_BATCH_MAX) {
      const batch = all.slice(i, i + EMBEDDING_BATCH_MAX);
      const out = await embedTexts(batch);
      // Kısmi ölçüm YOK: tek parti düşerse koşu GEÇERSİZ (sağlayıcı hatası üretimdeki gibi null döner).
      if (!out) throw new Error(`gömme başarısız (parti ${i / EMBEDDING_BATCH_MAX + 1}) — koşu GEÇERSİZ, rapor yazılmaz`);
      batch.forEach((t, j) => vec.set(t, out[j]));
    }
    const collected: E4Row[] = [];
    for (const s of perSize) {
      __resetKbIndexCache();
      const chunkVec = new Map(s.chunks.map((c) => [chunkKey(c), vec.get(embeddingTextFor(c))!]));
      for (const q of s.queries) {
        collected.push(runE4(s.size, s.pool, q, "lex"));
        const qv = vec.get(q.text)!;
        for (const t of E4_THRESHOLDS) {
          const sem = semanticMap(s.chunks, (c) => cosineOfUnit(qv, chunkVec.get(chunkKey(c))!), t);
          collected.push(runE4(s.size, s.pool, q, `sem@${t}`, sem));
        }
      }
    }
    rows.push(...collected);
    expect(rows.length).toBe(perSize.reduce((n, s) => n + s.queries.length, 0) * (1 + E4_THRESHOLDS.length));
  }, 300_000);
});
