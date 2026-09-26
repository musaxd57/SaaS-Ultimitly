import { KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { isAiReadableReviewState } from "@/lib/kb-review";
import { detectKbInstructionHijack } from "@/lib/ai/fallback";
import {
  pendingGuestMessages,
  retrievalNeeded,
  retrievalQueries,
  selectKbForPrompt,
  type ExtraQuery,
  type KbSelectInput,
  type KbSelectResult,
} from "@/lib/ai/retrieval/select";
import { chunkItems, chunkKey, type KbChunk, type KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { dropSuperseded, type Supersedable } from "@/lib/ai/retrieval/rerank";
import { getOrBuildKbIndex } from "@/lib/ai/retrieval/index-cache";
import { SEMANTIC_COSINE_THRESHOLD, thresholdTransform } from "@/lib/ai/retrieval/semantic";
import { SEMANTIC_MAX_CHUNKS } from "@/lib/ai/embeddings/semantic-retrieval";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import {
  RERANK_MAX_CANDIDATES,
  RERANK_QUESTION_CHARS,
  RERANK_SCHEMA,
  RERANK_SYSTEM_PROMPT,
  RERANK_TEXT_CHARS,
  parseRerank,
  rerankQuestionText,
  unionTopCandidates,
} from "@/lib/ai/semantic/rerank";
import { redactForSemanticModel } from "@/lib/ai/semantic/redact";
import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { semanticApiKey, semanticModel, semanticReasoningEffort, semanticTimeoutMs } from "@/lib/ai/semantic/config";
import {
  understandGuestMessages,
  UNDERSTANDING_ITEMS_PROMPT_ADDENDUM,
  UNDERSTANDING_RULES_PROMPT_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
} from "@/lib/ai/semantic/understand";
import { understandingQueries, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { digest, dotF32, embedCached, embedCachedWith, llmCached } from "./cache";

// ---------------------------------------------------------------------------
// RAG LAB — ÜRETİM BORU HATTININ AŞAMA AŞAMA İZLENMESİ (#189, kurucu 09-26: "önce ölçüyü düzeltin").
//
// Üretim `ai/kb-retrieve.ts` sırası AYNEN: okuma (kb-fetch: onay kapısı + ele geçirme süzgeci + en yeni N) → anlama
// katmanı sorguları → alt sorgu başına anlamsal puan (eşik dönüşümü) → seçici (1. koşu, aday listeleri) → yeniden
// sıralayıcı (yalnız `sem: ok` + `fb: none`, ilk K aday) → seçici (2. koşu, sıra sinyali) → istem bloğu. Model çıktıları
// ve gömmeler disk önbellekli (`cache.ts`): yapılandırmalar AYNI girdiyle kıyaslanır.
// Her kaçan cevap için AŞAMA: okumada yok → parça yok (iğne parça sınırında bölünmüş) → aday listesinde yok (eşik altı /
// sözcüksel isabet yok) → yeniden sıralayıcı penceresinin dışında → (yeniden sıralayıcı 600 karakter kırpması iğneyi
// kesti) → bütçede düştü → geri çekilme (legacy kümesi). "Tavan" kalem kimliğiyle değil CEVAP TAŞIYAN PARÇA ile ölçülür.
// ---------------------------------------------------------------------------

export interface LabItem extends KbChunkSource {
  supersededById: string | null;
  reviewState?: string;
}

export interface LabAnswer {
  /** Cevabı taşıyan metin (biri istem bloğunda geçmeli). */
  needles: string[];
  /** Cevabın geçtiği kalemler (bilgi amaçlı). */
  goldIds: string[];
}

export interface LabQuery {
  id: string;
  group: string;
  cls: string;
  lang: string;
  text: string;
  history?: { direction: "inbound" | "outbound"; body: string }[];
  /** Boş = cevabı bilgi tabanında YOK (negatif). */
  answers: LabAnswer[];
  /** Blokta GEÇMEMESİ gereken metin (eski sürüm iğnesi, onaysız kalem): geçerse sızıntı. */
  forbiddenNeedles?: string[];
  /** Çelişki sorusu: iki taraf da blokta YA DA çelişki notu yazılmış = doğru. */
  conflictOk?: boolean;
}

export interface LabConfig {
  name: string;
  /** null = anlamsal kaynak yok (SOĞUK yol ya da anahtar kapalı). `model` = deney gömme modeli (yoksa üretimin). */
  semantic: null | { t: number; model?: string };
  understanding: boolean;
  rerank: null | {
    k: number;
    crop: number;
    /** Pencere kuruluşu: "rr" = alt sorgu listelerinden sırayla (üretim) · "fused" = listeler arası RRF puanı. */
    window?: "rr" | "fused";
    /** Özgün sorgular isabetsizken (geri çekilme) anlama katmanı sorgularının adaylarını da sıralat (üretimde KAPALI). */
    onFallback?: boolean;
    /** KURU: pencereyi kur ama modeli ÇAĞIRMA (ücretsiz tavan ölçümü: cevap pencereye giriyor mu). */
    dry?: boolean;
  };
  fetchCap: number;
  /** Seçiciye ek girdiler (deney seçenekleri). */
  select?: Partial<KbSelectInput<LabItem>>;
}

export const PROD: LabConfig = {
  name: "prod",
  semantic: { t: SEMANTIC_COSINE_THRESHOLD },
  understanding: true,
  rerank: { k: RERANK_MAX_CANDIDATES, crop: RERANK_TEXT_CHARS },
  fetchCap: KB_RETRIEVAL_FETCH_CAP,
};

export type Stage =
  | "ok"
  | "fetch"
  | "chunk"
  | "no_candidate_below_t"
  | "no_candidate_other"
  | "beyond_window"
  | "budget_after_rerank"
  | "window_ok"
  | "budget"
  | "fallback";

export interface AnswerTrace {
  stage: Stage;
  /** En iyi cevap parçasının aday listelerindeki en iyi sırası (0 tabanlı; yoksa -1). */
  bestRank: number;
  /** En iyi cevap parçasının en yüksek ham kosinüsü (anlamsal yoksa null). */
  maxCos: number | null;
  /** Yeniden sıralayıcının cevap parçalarına verdiği en iyi etiket (3/2; yoksa null). */
  rrLabel: number | null;
  /** Yeniden sıralayıcı penceresindeki cevap parçasının kırpılmış metni iğneyi TAŞIMIYOR mu. */
  cropCut: boolean;
}

export interface LabRow {
  kb: string;
  size: number;
  config: string;
  qid: string;
  group: string;
  cls: string;
  lang: string;
  inBlock: boolean;
  answers: AnswerTrace[];
  fb: string;
  sem: string;
  rr: string;
  blockChars: number;
  selected: number;
  /** Negatif sorguda: blokta seçilen parça sayısı (şişme). */
  negChunks: number;
  /** Yasak metin (eski sürüm / onaysız kalem) blokta. */
  leak: boolean;
  /** Seçicinin çelişki notu yazıldı mı. */
  conflictNote: boolean;
}

/** kb-fetch'in saf ikizi: onay kapısı + ele geçirme süzgeci + `updatedAt desc` + okuma tavanı. */
export function labFetch(items: readonly LabItem[], cap: number): LabItem[] {
  return items
    .filter((i) => isAiReadableReviewState(i.reviewState ?? "legacy"))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1))
    .slice(0, cap)
    .filter((r) => !detectKbInstructionHijack(`${r.title}\n${r.content}`));
}

// ─── anlama katmanı (disk önbellekli; canlının kipi: öğe + kural) ─────────────
export const UNDERSTANDING_MODE = { items: true, rules: true } as const;
const UND_PROMPT_VERSION = digest([UNDERSTANDING_SYSTEM_PROMPT, UNDERSTANDING_ITEMS_PROMPT_ADDENDUM, UNDERSTANDING_RULES_PROMPT_ADDENDUM]);

export async function labUnderstand(q: LabQuery): Promise<MessageUnderstanding | null> {
  const history = q.history ? [...q.history, { direction: "inbound" as const, body: q.text }] : undefined;
  return llmCached<MessageUnderstanding>("understand", { v: UND_PROMPT_VERSION, m: semanticModel(), t: q.text, h: history ?? null, mode: UNDERSTANDING_MODE }, async () => {
    const o = await understandGuestMessages({ guestMessage: q.text, history, ...UNDERSTANDING_MODE });
    return o.status === "ok" ? o.value : null;
  });
}

// ─── yeniden sıralayıcı (üretim isteğinin parametreli ikizi; varsayılanda BİREBİR aynı istek — pin testi) ─────
export function labRerankRequest(
  guestMessage: string,
  candidates: readonly { key: string; title: string; text: string }[],
  opts: { k: number; crop: number },
  names: readonly string[] = [],
): { user: string; ids: Map<string, string> } {
  const fence = (t: string) => t.replace(/[<>]{2,}/g, "");
  const ids = new Map<string, string>();
  const lines = candidates.slice(0, opts.k).map((c, i) => {
    const id = `C${i + 1}`;
    ids.set(id, c.key);
    return `[${id}] <<<${fence(`${c.title} — ${c.text}`.slice(0, opts.crop))}>>>`;
  });
  const question = fence(redactForSemanticModel(guestMessage.slice(0, RERANK_QUESTION_CHARS), names));
  return { user: [`Guest message: <<<${question}>>>`, "", "Candidates:", ...lines].join("\n"), ids };
}

export async function labRerank(
  question: string,
  candidates: readonly { key: string; title: string; text: string }[],
  opts: { k: number; crop: number },
): Promise<Map<string, number> | null> {
  const { user, ids } = labRerankRequest(question, candidates, opts);
  const model = semanticModel();
  const raw = await llmCached<Record<string, string[]>>("rerank", { m: model, s: RERANK_SYSTEM_PROMPT, u: user }, async () => {
    const apiKey = semanticApiKey();
    if (!apiKey) return null;
    const res = await callStructuredJson({
      apiKey,
      model,
      system: RERANK_SYSTEM_PROMPT,
      user,
      schema: RERANK_SCHEMA,
      timeoutMs: semanticTimeoutMs(model),
      maxTokens: 400,
      maxCompletionTokens: 2_000,
      reasoningEffort: semanticReasoningEffort(),
    });
    return res.ok ? (res.data as Record<string, string[]>) : null;
  });
  return raw ? parseRerank(raw, ids) : null;
}

// ─── boru hattı ──────────────────────────────────────────────────────────────
export interface LabRun {
  result: KbSelectResult<LabItem>;
  lists: readonly (readonly { id: string; key: string }[])[];
  rrScores: Map<string, number> | null;
  rrStatus: "ok" | "failed" | "skipped" | "off" | "dry";
  window: string[];
  semStatus: "off" | "not_needed" | "ok" | "unavailable";
  cosByKey: Map<string, number> | null;
  pool: LabItem[];
  text: string;
}

export async function runPipeline(kbItems: readonly LabItem[], q: LabQuery, cfg: LabConfig, now: number): Promise<LabRun> {
  const pool = labFetch(kbItems, cfg.fetchCap);
  const history = q.history ? [...q.history, { direction: "inbound" as const, body: q.text }] : undefined;
  const base: KbSelectInput<LabItem> = { items: pool, guestMessage: q.text, history, mode: "hybrid", now, ...(cfg.select ?? {}) };
  let extraQueries: ExtraQuery[] = [];
  if (cfg.understanding && retrievalNeeded(pool, base.fullSetMaxItems)) {
    const u = await labUnderstand(q);
    extraQueries = understandingQueries(u ?? undefined);
  }
  const withExtra: KbSelectInput<LabItem> = extraQueries.length > 0 ? { ...base, extraQueries } : base;

  // Anlamsal hazırlık — `prepareSemanticScores` ile aynı kural (küçük KB'de koşmaz; parça tavanı; alt sorgu başına en yüksek kosinüs).
  let semStatus: LabRun["semStatus"] = "off";
  let bySubquery: Map<string, Map<string, number>> | undefined;
  let cosByKey: Map<string, number> | null = null;
  if (cfg.semantic) {
    if (!retrievalNeeded(pool, base.fullSetMaxItems)) semStatus = "not_needed";
    else {
      const { queries } = retrievalQueries(q.text, history, { embedTexts: true, extraQueries });
      const { kept } = dropSuperseded(pool as readonly (LabItem & Supersedable)[]);
      const index = getOrBuildKbIndex(kept, now);
      if (queries.length === 0) semStatus = "not_needed";
      else if (index.chunks.length > SEMANTIC_MAX_CHUNKS) semStatus = "unavailable";
      else {
        const chunkTexts = index.chunks.map((c) => embeddingTextFor(c));
        const queryTexts = [...new Set(queries.flatMap((x) => x.embedTexts))];
        const vec = cfg.semantic.model
          ? await embedCachedWith([...chunkTexts, ...queryTexts], cfg.semantic.model, 1536)
          : await embedCached([...chunkTexts, ...queryTexts]);
        bySubquery = new Map();
        cosByKey = new Map();
        for (const sq of queries) {
          const qvs = sq.embedTexts.map((t) => vec.get(t)!);
          const scores = new Map<string, number>();
          index.chunks.forEach((c, i) => {
            let cos = -1;
            for (const qv of qvs) cos = Math.max(cos, dotF32(qv, vec.get(chunkTexts[i])!));
            const key = chunkKey(c);
            cosByKey!.set(key, Math.max(cosByKey!.get(key) ?? -1, cos));
            const v = thresholdTransform(cos, cfg.semantic!.t);
            if (v > 0) scores.set(key, v);
          });
          bySubquery.set(sq.subquery, scores);
        }
        semStatus = "ok";
      }
    }
  }
  const semInput: KbSelectInput<LabItem> = bySubquery ? { ...withExtra, semanticBySubquery: bySubquery } : withExtra;
  let lists: readonly (readonly { id: string; key: string }[])[] = [];
  let result = selectKbForPrompt({ ...semInput, onCandidates: (l) => (lists = l) });
  let rrScores: Map<string, number> | null = null;
  let rrStatus: LabRun["rrStatus"] = "off";
  let window: string[] = [];
  const fbOk = result.evidence?.fb === "none" || (cfg.rerank?.onFallback === true && result.evidence?.fb === "no_lexical_hits" && extraQueries.length > 0);
  if (cfg.rerank && semStatus === "ok" && fbOk) {
    window = cfg.rerank.window === "fused" ? fusedWindow(lists, cfg.rerank.k) : unionTopCandidates(lists, cfg.rerank.k);
    const wanted = new Set(window.map((k) => k.slice(0, k.lastIndexOf("#"))));
    const byKey = new Map(chunkItems(pool.filter((it) => wanted.has(it.id))).map((c) => [chunkKey(c), c] as const));
    const cands = window.flatMap((k) => {
      const c = byKey.get(k);
      return c ? [{ key: k, title: c.title, text: c.text }] : [];
    });
    if (cands.length < 2) rrStatus = "skipped";
    else if (cfg.rerank.dry) rrStatus = "dry";
    else {
      const earlier = [...pendingGuestMessages(history, q.text)].reverse();
      rrScores = await labRerank(rerankQuestionText(q.text, earlier), cands, cfg.rerank);
      rrStatus = rrScores ? "ok" : "failed";
      if (rrScores && rrScores.size > 0) result = selectKbForPrompt({ ...semInput, rerankScores: rrScores });
    }
  }
  const text = packKnowledgeBase(result.items, result.droppedItems, result.selection, result.notes).text;
  return { result, lists, rrScores, rrStatus, window, semStatus, cosByKey, pool, text };
}

/** Listeler arası RRF (K=60) ile ilk `k` benzersiz anahtar — pencere kuruluşu deneyi. */
export function fusedWindow(lists: readonly (readonly { key: string }[])[], k: number): string[] {
  const score = new Map<string, number>();
  const first = new Map<string, number>();
  let order = 0;
  for (const list of lists) {
    list.forEach((c, r) => {
      score.set(c.key, (score.get(c.key) ?? 0) + 1 / (60 + r + 1));
      if (!first.has(c.key)) first.set(c.key, order++);
    });
  }
  return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || first.get(a)! - first.get(b)!).slice(0, k);
}

/** Bir cevabın aşaması. */
export function traceAnswer(run: LabRun, a: LabAnswer, cfg: LabConfig, allItems: readonly LabItem[]): AnswerTrace {
  const inBlock = a.needles.some((n) => run.text.includes(n));
  const poolIds = new Set(run.pool.map((i) => i.id));
  const answerItems = allItems.filter((i) => a.needles.some((n) => i.content.includes(n) || i.title.includes(n)));
  const fetched = answerItems.filter((i) => poolIds.has(i.id));
  const chunks: KbChunk[] = chunkItems(fetched).filter((c) => a.needles.some((n) => c.text.includes(n)));
  const keys = new Set(chunks.map((c) => chunkKey(c)));
  let bestRank = -1;
  for (const list of run.lists) {
    const i = list.findIndex((c) => keys.has(c.key));
    if (i >= 0 && (bestRank < 0 || i < bestRank)) bestRank = i;
  }
  let maxCos: number | null = null;
  if (run.cosByKey) for (const k of keys) maxCos = Math.max(maxCos ?? -1, run.cosByKey.get(k) ?? -1);
  let rrLabel: number | null = null;
  if (run.rrScores) for (const k of keys) rrLabel = Math.max(rrLabel ?? 0, run.rrScores.get(k) ?? 0) || rrLabel;
  const inWindow = run.window.some((k) => keys.has(k));
  const cropCut =
    inWindow &&
    !!cfg.rerank &&
    !chunks.some((c) => keys.has(chunkKey(c)) && run.window.includes(chunkKey(c)) && a.needles.some((n) => `${c.title} — ${c.text}`.slice(0, cfg.rerank!.crop).includes(n)));
  const t: Omit<AnswerTrace, "stage"> = { bestRank, maxCos, rrLabel, cropCut };
  if (inBlock) return { stage: "ok", ...t };
  if (fetched.length === 0) return { stage: "fetch", ...t };
  if (chunks.length === 0) return { stage: "chunk", ...t };
  if (run.result.selection === "all") return { stage: "fallback", ...t };
  if (bestRank < 0) {
    const below = cfg.semantic !== null && maxCos !== null && maxCos < cfg.semantic.t;
    return { stage: below || cfg.semantic === null ? "no_candidate_below_t" : "no_candidate_other", ...t };
  }
  if (run.rrStatus === "ok") return { stage: inWindow ? "budget_after_rerank" : "beyond_window", ...t };
  if (run.rrStatus === "dry") return { stage: inWindow ? "window_ok" : "beyond_window", ...t };
  return { stage: "budget", ...t };
}

export async function labRow(kbName: string, size: number, items: readonly LabItem[], q: LabQuery, cfg: LabConfig, now: number): Promise<LabRow> {
  const run = await runPipeline(items, q, cfg, now);
  const answers = q.answers.map((a) => traceAnswer(run, a, cfg, items));
  const selected = run.result.items.length;
  const leak = (q.forbiddenNeedles ?? []).some((n) => run.text.includes(n));
  const conflictNote = run.result.notes.some((n) => n.includes("farklı değerler"));
  const allOk = answers.length > 0 && answers.every((a) => a.stage === "ok");
  return {
    kb: kbName,
    size,
    config: cfg.name,
    qid: q.id,
    group: q.group,
    cls: q.cls,
    lang: q.lang,
    inBlock: !leak && (allOk || (q.conflictOk === true && conflictNote)),
    answers,
    fb: run.result.evidence?.fb ?? "legacy",
    sem: run.semStatus,
    rr: run.rrStatus,
    blockChars: run.text.length,
    selected,
    negChunks: q.answers.length === 0 ? selected : 0,
    leak,
    conflictNote,
  };
}

// ─── rapor ───────────────────────────────────────────────────────────────────
export const STAGES: readonly Stage[] = [
  "fetch",
  "chunk",
  "fallback",
  "no_candidate_below_t",
  "no_candidate_other",
  "beyond_window",
  "budget_after_rerank",
  "window_ok",
  "budget",
];

export interface GroupSummary {
  n: number;
  ok: number;
  stages: Record<string, number>;
  cropCut: number;
  negChunks: number;
  negFb: number;
  leaks: number;
}

export function summarize(rows: readonly LabRow[]): Map<string, GroupSummary> {
  const out = new Map<string, GroupSummary>();
  for (const r of rows) {
    const k = `${r.kb}|${r.size}|${r.config}|${r.group}`;
    const s = out.get(k) ?? { n: 0, ok: 0, stages: {}, cropCut: 0, negChunks: 0, negFb: 0, leaks: 0 };
    s.n += 1;
    if (r.leak) s.leaks += 1;
    if (r.answers.length === 0) {
      s.negChunks += r.negChunks;
      s.negFb += +(r.fb !== "none");
    } else if (r.inBlock) s.ok += 1;
    for (const a of r.answers) {
      if (a.stage !== "ok") s.stages[a.stage] = (s.stages[a.stage] ?? 0) + 1;
      if (a.cropCut) s.cropCut += 1;
    }
    out.set(k, s);
  }
  return out;
}

export function reportLines(rows: readonly LabRow[], title: string, meta: Record<string, unknown>): string[] {
  const sum = summarize(rows);
  const lines = [
    `# ${title}`,
    "",
    ...Object.entries(meta).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
    "",
    "Ölçü: blokta = cevap cümlesi istem bloğunda (iki sorulu mesajda İKİ cevap da). Aşama sütunları KAÇAN CEVAP sayısıdır:",
    "okuma = okuma tavanı/onay süzgeci · parça = iğne parça sınırında bölünmüş · geri = geri çekilme (legacy kümesi) ·",
    "eşik = aday listesinde yok, kosinüs eşik altı (ya da anlamsal yok) · aday-diğer = eşik üstü ama aday değil · pencere =",
    "aday listesinde ama yeniden sıralayıcının ilk K'sının dışında · bütçe(rr) = pencerede, yeniden sıralamadan sonra bütçeye",
    "girmedi · bütçe = aday listesinde, bütçeye girmedi (yeniden sıralayıcı yok) · kırpma = pencerede ama kırpılmış metin iğneyi",
    "taşımıyor (bilgi). Negatif satırında blokta = — ; `neg parça` ortalama seçilen parça, `neg geri` geri çekilme sayısı.",
    "",
    "| KB | boyut | yapılandırma | grup | n | blokta | okuma | parça | geri | eşik | aday-diğer | pencere | bütçe(rr) | pencerede (kuru) | bütçe | kırpma | neg parça | neg geri | sızıntı |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const keys = [...sum.keys()].sort((a, b) => {
    const [ka, sa, ca, ga] = a.split("|");
    const [kb, sb, cb, gb] = b.split("|");
    return ka.localeCompare(kb) || Number(sa) - Number(sb) || ga.localeCompare(gb) || ca.localeCompare(cb);
  });
  for (const k of keys) {
    const [kbName, size, config, group] = k.split("|");
    const s = sum.get(k)!;
    const isNeg = group.startsWith("neg") || group === "draft";
    const pct = isNeg ? "—" : `${s.ok}/${s.n} (%${Math.round((100 * s.ok) / s.n)})`;
    const st = (x: Stage) => s.stages[x] ?? 0;
    lines.push(
      `| ${kbName} | ${size} | ${config} | ${group} | ${s.n} | ${pct} | ${st("fetch")} | ${st("chunk")} | ${st("fallback")} | ${st("no_candidate_below_t")} | ${st("no_candidate_other")} | ${st("beyond_window")} | ${st("budget_after_rerank")} | ${st("window_ok")} | ${st("budget")} | ${s.cropCut} | ${isNeg ? (s.negChunks / s.n).toFixed(1) : ""} | ${isNeg ? s.negFb : ""} | ${s.leaks} |`,
    );
  }
  return lines;
}
