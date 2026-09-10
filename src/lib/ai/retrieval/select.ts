import { KB_RETRIEVAL_CHAR_BUDGET, KB_RETRIEVAL_MAX_CHUNKS } from "@/lib/ai/limits";
import { reportError } from "@/lib/report-error";
import type { KbChunk, KbChunkSource } from "./chunker";
import { kbRetrievalMode, type KbRetrievalMode } from "./flag";
import { fuseNormalizedScores, fuseRankings, type SourceRanking } from "./fusion";
import { expandQuery, TIME_FIELD_LABELS } from "./lexicon";
import { getOrBuildKbIndex, type KbIndex } from "./index-cache";
import {
  dropSuperseded,
  preserveTimeConflicts,
  rerank,
  sortCandidates,
  type Candidate,
  type Supersedable,
} from "./rerank";
import { SOURCE_WEIGHTS } from "./semantic";
import { NGRAM_QUALIFY_MIN } from "./sources";
import { contentStems, normalizeForRetrieval } from "./text";
import { detectGuestLanguage } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// HİBRİT BİLGİ SEÇİCİ — TEK BOĞAZ NOKTASI (RAG dilim 1+2, 09-09).
//
// Boru hattı (bayrak AÇIKKEN):
//   girdi (yetki+mülk+onay+sır süzgeçlerinden GEÇMİŞ kalemler)
//   → sürüm kuralı (halefi kümede olan kalem düşer)
//   → küçük-KB passthrough (≤12 kalem ve ≤6k: tamamı gider)
//   → alt sorgular (?, satır, ; , ve/ayrıca/and/also; ≤4)
//   → her alt sorgu için ADAY KAYNAKLARI: BM25 (kök+sözlük+fuzzy) · karakter
//     3-gram kosinüsü (yalnız Türkçe sorguda, ölçümle) · (varsa) anlamsal
//     puanlar — ÜRETİMDE ANLAMSAL KAYNAK YOK, yalnız sözleşme → CombSUM
//     birleşimi → yeniden sıralama (ipucu/başlık/kalıp; tazelik yalnız
//     yakın-eşitlik bozucu) → eşik
//   → alt sorgular arası round-robin (kalem başına ≤3 parça)
//   → çelişki koruma (aynı SAAT ALANINDA farklı saat; kategori-bağımsız)
//   → bütçe (6k / 12 parça); sığmayan çelişki AÇIKÇA bildirilir (notes)
//   → seçilen parçalar + düşen kalem sayısı + PII'siz kanıt
// Aday hiç yoksa / selamlaşmada / hatada TAM küme gider: hibrit legacy'den az
// bilgi taşımaz. Bayrak KAPALIYKEN çıktı girdinin KENDİSİDİR (aynı referans).
//
// Bu modül DB'ye erişmez, kalem EKLEYEMEZ, metni DEĞİŞTİREMEZ (pinler).
// ---------------------------------------------------------------------------

export { kbRetrievalMode, type KbRetrievalMode } from "./flag";

export type KbSelectFallback = "none" | "small_kb" | "empty_query" | "no_lexical_hits" | "error";

/** PII'siz kanıt parçası — `RiskEvent.kbEvidenceJson`'a girer (yalnız sayılar/kodlar). */
export interface KbRetrievalEvidence {
  mode: "hybrid";
  /** Alt sorgu sayısı. */
  q: number;
  fb: KbSelectFallback;
  /** Seçilen parça / indeksteki toplam parça. */
  sel: number;
  cand: number;
  ms: number;
  /** Etkin aday kaynakları. */
  srcs?: string[];
  /** Sürüm kuralıyla düşen kalem sayısı. */
  sup?: number;
  /** Tespit edilen saat-alanı çelişkisi sayısı. */
  conf?: number;
  /** Bütçe yüzünden tüm tarafları bloğa SIĞMAYAN çelişki sayısı (istem notuyla bildirilir). */
  confDropped?: number;
}

export interface KbSelectSources {
  /**
   * Karakter 3-gram kaynağı. "auto" (VARSAYILAN, ölçümle): yalnız sorgu TÜRKÇE
   * algılanırsa — n-gram benzerliği bilgi tabanının diliyle (Türkçe) aynı dilde
   * anlamlıdır; İngilizce sorguda Türkçe metne düşen trigramlar isabeti düşürüp
   * bloğu büyütüyordu (ölçüldü: en h1 −1–3, karakter +30%; morph gürültüsü ise
   * n-gram ile yarıya iniyor). `true`/`false` ölçüm/harness içindir.
   */
  ngram?: boolean | "auto";
  /** Birleşim: "sum" (büyüklük koruyan, VARSAYILAN — ölçüldü) ya da "rrf". */
  fusion?: "sum" | "rrf";
}

export interface KbSelectInput<T extends KbChunkSource> {
  items: readonly T[];
  guestMessage: string;
  history?: readonly { direction: "inbound" | "outbound"; body: string }[];
  /** Bayrağı ezer (test/harness). Verilmezse env. */
  mode?: KbRetrievalMode;
  budgetChars?: number;
  maxChunks?: number;
  /** Anlamsal puanlar (parça anahtarı → 0..1), önceden hesaplanmış; yoksa kaynak yok. */
  semantic?: ReadonlyMap<string, number>;
  sources?: KbSelectSources;
  now?: number;
}

export type SelectedKbItem<T> = T & { chunk?: number; chunkCount?: number };

export interface KbSelectResult<T extends KbChunkSource> {
  mode: KbRetrievalMode;
  /** Legacy'de girdinin KENDİSİ; hibritte sıralı parçalar. */
  items: SelectedKbItem<T>[];
  /** Hiçbir parçası seçilmeyen kalem sayısı (istemdeki devir notunu besler). */
  droppedItems: number;
  /** İstemin bilgi bloğunu nasıl adlandıracağı. */
  selection: "all" | "retrieved";
  /**
   * İsteme eklenecek DÜRÜST notlar (PII yok): örn. bütçeye sığmayan saat çelişkisi
   * ("çıkış için farklı saat değerleri var; kesin saat söyleme, insana devret").
   * Legacy'de boş.
   */
  notes: string[];
  evidence: KbRetrievalEvidence | null;
}

export { HINT_BONUS, TITLE_BONUS, PHRASE_BONUS } from "./rerank";
export const CARRY_WEIGHT = 0.5;
export const RELEVANCE_FLOOR_ABS = 0.1;
export const RELEVANCE_FLOOR_REL = 0.25;
export const MAX_CHUNKS_PER_ITEM = 3;
export const MAX_SUBQUERIES = 4;
export const DEFAULT_SOURCES: Required<KbSelectSources> = { ngram: "auto", fusion: "sum" };
/** Sorgu bu kadar az içerik kökü taşıyorsa önceki misafir mesajları bağlam olarak eklenir. */
const THIN_QUERY_STEMS = 2;
const CARRY_HISTORY_MESSAGES = 2;

const SUBQUERY_SPLIT = /[?\n;,]+|\s+(?:ve|ayrica|ayrıca|bir de|and|also|plus)\s+/i;

/**
 * ZAYIF SORGU KÖKLERİ: tek başına bir parçayı ADAY yapmaz (BM25 puanına yine
 * girer). "Jakuzi var mı?" sorusunda "var", "vardır" içeren her parçayı
 * eşleştirir ve geri çekilmeyi (no_lexical_hits) engellerdi (ölçüldü) — oysa
 * doğru davranış tam kümeyi verip modelin dürüstçe "bilgi yok" diyebilmesidir.
 */
const WEAK_QUERY_TERMS = new Set([
  "var", "yok", "lazim", "gerek", "isti", "kullan", "yap", "ol", "et", "al", "ver", "bul", "gel", "git", "bak", "koy", "birak",
  "acil", "sorun", "problem", "yardim", "help", "need", "want", "use", "get", "put", "leave", "find", "know", "bil",
  // KÖK UZAYI ARTEFAKTI (09-10, ölçek harness'ı): "çalışıyor" → calis → EN "s" → cali →
  // "ca" (= "çalarsa"); iki harfli nadir kök yüksek IDF ile ilgisiz kalemi öne çekiyordu
  // ("Asansörünüz çalışıyor mu?" → yangın alarmı kalemi). "ko" da adaydı ("koyabilirim",
  // "koduna", "koşu") ama kök sökücü düzeltmesiyle kaynağı kalmadı ("koy"/"kod"/"kos") —
  // "ko" artık "kodu"nun DEĞİL yalnız nadir kelimelerin kökü, listeye ALINMADI.
  "ca",
]);
/**
 * Zayıf kökün BM25 ağırlığı (09-10): 1.0 iken "altı→al" gibi bir zayıf terim üç
 * güçlü kökü geçebiliyordu; aday şartı zaten güçlü kök ister, puanda da aynı
 * ölçüde geri planda kalsın (ölçüldü: kapalı hit@1 +0.5–1.1 puan, isabet düşmedi).
 */
const WEAK_QUERY_WEIGHT = 0.25;

/** Misafir mesajını alt sorgulara böl (çok soru → her biri ayrı retrieval). */
export function splitQuestions(message: string): string[] {
  const norm = normalizeForRetrieval(message);
  const parts = norm
    .split(SUBQUERY_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && contentStems(p).length > 0);
  if (parts.length === 0) return contentStems(norm).length > 0 ? [norm] : [];
  return parts.slice(0, MAX_SUBQUERIES);
}

function renderedChars(c: { category: string; title: string; text: string }): number {
  return c.category.length + c.title.length + c.text.length + 6;
}

function renderedCharsAll(items: readonly KbChunkSource[]): number {
  let n = 0;
  for (const i of items) n += renderedChars({ category: i.category, title: i.title, text: i.content });
  return n;
}

interface RankOptions {
  carryStems: readonly string[];
  semantic: ReadonlyMap<string, number> | undefined;
  sources: Required<KbSelectSources>;
  /** Dil, HAM misafir mesajından algılanır (alt sorgular ASCII-katlanmıştır; oradan algılanamaz). */
  queryIsTurkish: boolean;
}

/** Bir alt sorgu için aday listesi (sıralı, eşiklenmiş). */
function rankForSubquery(index: KbIndex, subquery: string, opt: RankOptions): { cands: Candidate[]; sources: string[] } {
  const own = contentStems(subquery);
  // İNCE SORGU ("Ücretli mi?"): önceki MİSAFİR mesajlarının kökleri hem ağırlığa
  // (0.5) hem kavram genişletmesine girer — tek adım, tek karar noktası.
  const carried = own.length < THIN_QUERY_STEMS ? opt.carryStems : [];
  const weights = new Map<string, number>();
  for (const s of own) weights.set(s, WEAK_QUERY_TERMS.has(s) ? WEAK_QUERY_WEIGHT : 1);
  for (const s of carried) if (!weights.has(s)) weights.set(s, CARRY_WEIGHT);
  const { expansion, categoryHints } = expandQuery([...own, ...carried]);
  for (const [s, w] of expansion) if (!weights.has(s)) weights.set(s, w);

  // --- Kaynak 1: BM25 (kök + sözlük genişletmesi + fuzzy) -------------------
  const { scores: bm25, resolved } = index.bm25.scores(weights);
  const strong = new Set<string>();
  for (const t of weights.keys()) if (!WEAK_QUERY_TERMS.has(t)) strong.add(resolved.get(t) ?? t);
  const strongHit = (i: number): boolean => {
    const tf = index.bm25.docs[i].tf;
    for (const t of strong) if (tf.has(t)) return true;
    return false;
  };

  // --- Kaynak 2: karakter 3-gram kosinüsü (kökten bağımsız) ----------------
  const n = index.chunks.length;
  const rankings: SourceRanking[] = [{ source: "bm25", weight: SOURCE_WEIGHTS.bm25, scores: bm25 }];
  const sources = ["bm25"];
  let ngram: Float64Array | null = null;
  const useNgram = opt.sources.ngram === "auto" ? opt.queryIsTurkish : opt.sources.ngram;
  if (useNgram) {
    // Durak kelimeler gram üretmez (`gramsOf`); zayıf kökler ("var") için ayrı
    // süzgeç YOK — aday şartı n-gram için `NGRAM_QUALIFY_MIN` eşiğidir ve
    // "Jakuzi var mı?"nın "vardır"lı parçayı aday yapmadığı test-pinli. Eşik altı
    // kosinüs birleşime girer ama TEK BAŞINA kanıt sayılmaz (`hasEvidence`).
    ngram = index.ngram.query(carried.length > 0 ? `${subquery} ${carried.join(" ")}` : subquery);
    rankings.push({ source: "ngram", weight: SOURCE_WEIGHTS.ngram, scores: ngram });
    sources.push("ngram");
  }
  // --- Kaynak 3: anlamsal (varsa; sözleşme semantic.ts) --------------------
  if (opt.semantic && opt.semantic.size > 0) {
    const sem = new Float64Array(n);
    index.chunks.forEach((c, i) => {
      const v = opt.semantic!.get(`${c.id}#${c.chunkIndex}`);
      if (typeof v === "number" && Number.isFinite(v) && v > 0) sem[i] = Math.min(1, v);
    });
    rankings.push({ source: "semantic", weight: SOURCE_WEIGHTS.semantic, scores: sem });
    sources.push("semantic");
  }

  // ADAY ŞARTI: güçlü kök isabeti YA DA kategori ipucu YA DA n-gram eşiği YA DA
  // anlamsal puan. Zayıf kökler ("var") tek başına aday yapmaz.
  const semanticScores = rankings.find((r) => r.source === "semantic")?.scores;
  const hasEvidence = (i: number): boolean =>
    strongHit(i) || (ngram !== null && ngram[i] >= NGRAM_QUALIFY_MIN) || (semanticScores !== undefined && semanticScores[i] > 0);
  const qualified = (i: number): boolean => hasEvidence(i) || (categoryHints.get(index.chunks[i].category as never) ?? 0) > 0;

  // Niteliksiz parçalar birleşime girmez (kaynak sıralarını şişirmesin).
  for (const r of rankings) {
    for (let i = 0; i < n; i++) if (!qualified(i)) r.scores[i] = 0;
  }
  const fused = opt.sources.fusion === "rrf" ? fuseRankings(rankings, n).fused : fuseNormalizedScores(rankings, n);
  let max = 0;
  for (const v of fused) if (v > max) max = v;
  const base = new Float64Array(n);
  if (max > 0) for (let i = 0; i < n; i++) base[i] = fused[i] / max;

  // Başlık/bigram bonusu FUZZY çözümlü köklerle çalışır ("otopakr" → "otopark"):
  // aksi hâlde yazım hatalı sorguda gerçek başlık bonusu alamaz, kısa çeldirici öne geçer (ölçüldü).
  const ownResolved = own.map((s) => resolved.get(s) ?? s);
  const ownSet = new Set(ownResolved);
  const bigrams: [string, string][] = [];
  for (let i = 0; i + 1 < ownResolved.length; i++) bigrams.push([ownResolved[i], ownResolved[i + 1]]);
  const expansionStems = new Set(expansion.keys());
  const cands = rerank(index.chunks, index.bm25.docs, base, qualified, { ownStems: ownSet, expansionStems, bigrams, categoryHints }, hasEvidence);
  const best = cands.reduce((m, c) => Math.max(m, c.score), 0);
  const floor = Math.max(RELEVANCE_FLOOR_ABS, best * RELEVANCE_FLOOR_REL);
  return { cands: sortCandidates(cands.filter((c) => c.score >= floor), index.chunks), sources };
}

function legacyResult<T extends KbChunkSource>(
  items: readonly T[],
  mode: KbRetrievalMode,
  evidence: KbRetrievalEvidence | null,
): KbSelectResult<T> {
  return { mode, items: items as SelectedKbItem<T>[], droppedItems: 0, selection: "all", notes: [], evidence };
}

export function selectKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): KbSelectResult<T> {
  const mode = input.mode ?? kbRetrievalMode();
  if (mode !== "hybrid") return legacyResult(input.items, "legacy", null);
  const started = performance.now();
  const evidence = (
    fb: KbSelectFallback,
    q: number,
    sel: number,
    cand: number,
    extra: Pick<KbRetrievalEvidence, "srcs" | "sup" | "conf" | "confDropped"> = {},
  ): KbRetrievalEvidence => ({
    mode: "hybrid",
    q,
    fb,
    sel,
    cand,
    ms: Math.round((performance.now() - started) * 10) / 10,
    ...extra,
  });
  try {
    const budget = input.budgetChars ?? KB_RETRIEVAL_CHAR_BUDGET;
    const maxChunks = input.maxChunks ?? KB_RETRIEVAL_MAX_CHUNKS;
    const sources: Required<KbSelectSources> = { ...DEFAULT_SOURCES, ...(input.sources ?? {}) };
    if (input.items.length === 0) return legacyResult(input.items, "hybrid", evidence("small_kb", 0, 0, 0));
    // SÜRÜM KURALI: halefi kümede olan kalem (A5 `supersededById`) düşer.
    const { kept: items, dropped: sup } = dropSuperseded(input.items as readonly (T & Supersedable)[]);
    // KÜÇÜK KB → SEÇİM YOK: tamamı bütçeye sığıyorsa retrieval'ın katkısı yok,
    // riski var (kaçırılan parça = gereksiz devir). Retrieval yalnız gerektiğinde.
    if (items.length <= maxChunks && renderedCharsAll(items) <= budget) {
      return legacyResult(sup > 0 ? items : input.items, "hybrid", evidence("small_kb", 0, items.length, items.length, { sup }));
    }
    const subqueries = splitQuestions(input.guestMessage);
    const index = getOrBuildKbIndex(items, input.now);
    if (subqueries.length === 0) {
      return legacyResult(sup > 0 ? items : input.items, "hybrid", evidence("empty_query", 0, 0, index.chunks.length, { sup }));
    }
    const carryStems = (input.history ?? [])
      .filter((m) => m.direction === "inbound")
      .slice(-CARRY_HISTORY_MESSAGES)
      .flatMap((m) => contentStems(m.body));

    const queryIsTurkish = detectGuestLanguage(input.guestMessage) === "tr";
    const rankedAll = subqueries.map((q) => rankForSubquery(index, q, { carryStems, semantic: input.semantic, sources, queryIsTurkish }));
    const ranked = rankedAll.map((r) => r.cands);
    const srcs = rankedAll[0]?.sources ?? [];
    if (ranked.every((r) => r.length === 0)) {
      return legacyResult(
        sup > 0 ? items : input.items,
        "hybrid",
        evidence("no_lexical_hits", subqueries.length, 0, index.chunks.length, { srcs, sup }),
      );
    }

    // Alt sorgular arasında sırayla (round-robin) → çok sorulu mesajda her
    // sorunun en iyi parçası bütçeden pay alır; tek konu bütçeyi yutamaz.
    const picked: number[] = [];
    const pickedSet = new Set<number>();
    const perItem = new Map<string, number>();
    const cursors = ranked.map(() => 0);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let qi = 0; qi < ranked.length; qi++) {
        const list = ranked[qi];
        while (cursors[qi] < list.length) {
          const cand = list[cursors[qi]++];
          if (pickedSet.has(cand.idx)) continue;
          const chunk = index.chunks[cand.idx];
          const cnt = perItem.get(chunk.id) ?? 0;
          if (cnt >= MAX_CHUNKS_PER_ITEM) continue;
          picked.push(cand.idx);
          pickedSet.add(cand.idx);
          perItem.set(chunk.id, cnt + 1);
          progressed = true;
          break;
        }
      }
    }

    // ÇELİŞKİ KORUMA (alan bazlı): aynı SAAT ALANINDA çapadan farklı saat taşıyan
    // parçalar çapanın hemen arkasına taşınır (P4 iki kaynağı görsün).
    const { order, conflicts } = preserveTimeConflicts(index.chunks, picked, index.fieldTimes);

    // Bütçe: en az bir parça her zaman gider (isabet varken boş blok gitmez).
    const chosen: KbChunk[] = [];
    let used = 0;
    for (const idx of order) {
      const c = index.chunks[idx];
      const cost = renderedChars({ category: c.category, title: c.title, text: c.text });
      if (chosen.length > 0 && (used + cost > budget || chosen.length >= maxChunks)) break;
      chosen.push(c);
      used += cost;
    }

    const byId = new Map<string, T>();
    for (const it of items) byId.set(it.id, it);
    const selected: SelectedKbItem<T>[] = chosen.map((c) => {
      const src = byId.get(c.id) as T;
      const title = c.chunkCount > 1 ? `${c.title} (${c.chunkIndex + 1}/${c.chunkCount})` : c.title;
      return { ...src, title, content: c.text, chunk: c.chunkIndex, chunkCount: c.chunkCount };
    });
    const representedIds = new Set(chosen.map((c) => c.id));
    const droppedItems = byId.size - representedIds.size;
    // BÜTÇE ÇELİŞKİYİ YUTAMAZ: bir çelişkinin tüm tarafları bloğa sığmadıysa
    // model bunu bilmeli — kesin saat söylememeli, insana devretmeli.
    const chosenIdx = new Set(order.filter((idx) => chosen.includes(index.chunks[idx])));
    const notes: string[] = [];
    let confDropped = 0;
    for (const c of conflicts) {
      const complete = chosenIdx.has(c.anchorIdx) && c.partnerIdx.every((i) => chosenIdx.has(i));
      if (complete) continue;
      confDropped += 1;
      notes.push(
        `Kaynaklarda ${TIME_FIELD_LABELS[c.field] ?? c.field} saati için farklı değerler var (${c.values.join(" / ")}); ` +
          "tamamı bu yanıta sığmadı. Kesin saat SÖYLEME — konuyu insana devret.",
      );
    }
    return {
      mode: "hybrid",
      items: selected,
      droppedItems,
      selection: "retrieved",
      notes,
      evidence: evidence("none", subqueries.length, selected.length, index.chunks.length, {
        srcs,
        sup,
        conf: conflicts.length,
        confDropped,
      }),
    };
  } catch (err) {
    // Retrieval hatası ürünü BOZMAZ: legacy küme gider, hata raporlanır.
    void reportError("kb-retrieval-select", err);
    return legacyResult(input.items, "hybrid", evidence("error", 0, 0, 0));
  }
}
