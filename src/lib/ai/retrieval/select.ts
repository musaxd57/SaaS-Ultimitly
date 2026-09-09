import { KB_RETRIEVAL_CHAR_BUDGET, KB_RETRIEVAL_MAX_CHUNKS } from "@/lib/ai/limits";
import { reportError } from "@/lib/report-error";
import { chunkKey, type KbChunk, type KbChunkSource } from "./chunker";
import { kbRetrievalMode, type KbRetrievalMode } from "./flag";
import { expandQuery } from "./lexicon";
import { getOrBuildKbIndex, type KbIndex } from "./index-cache";
import { blendScores } from "./semantic";
import { contentStems, normalizeForRetrieval } from "./text";

// ---------------------------------------------------------------------------
// HİBRİT BİLGİ SEÇİCİ — TEK BOĞAZ NOKTASI (RAG dilim 1, 09-09).
//
// Konum: `fetchKnowledgeBaseForPrompt` (yetki + mülk + onay kapısı) ve yüzeyin
// sır elemesi (`withoutSecretKbItems` / `QR_SECRET_CATEGORIES`) ÇALIŞTIKTAN
// SONRA, `suggestReply`'dan ÖNCE. Bu modül DB'ye erişmez, kalem EKLEYEMEZ,
// metni DEĞİŞTİREMEZ; yalnız kendisine verilen kümeden parça SEÇER.
//
// Bayrak `KB_RETRIEVAL_MODE=hybrid` (VARSAYILAN KAPALI). Kapalıyken çıktı
// girdinin KENDİSİDİR (aynı dizi referansı) → canlı davranış karakteri
// karakterine aynı kalır.
//
// Hibrit modda DÜRÜSTLÜK korunur: seçilmeyen kalem sayısı `droppedItems` olarak
// döner ve istemdeki "[NOT] … 'bilgi yok' DEME — insana devret" notunu besler.
// Retrieval'ın kaçırdığı bir konu, modelin "bilgim yok" demesine DEĞİL insana
// devrine gider (ürün kuralı). Sözcüksel hiç isabet yoksa hibrit KENDİNİ
// GERİ ÇEKER ve legacy küme (tamamı) gider — hibrit hiçbir durumda legacy'den
// az bilgi taşımaz, yalnız daha az GÜRÜLTÜ taşır.
//
// Kaynak çelişkisi GİZLENMEZ: `checkin`/`checkout` kategorisinden bir parça
// seçildiyse aynı kategoride SAAT taşıyan diğer parçalar da alınır —
// `findTimeConflicts` iki kaynağı da görmeye devam eder (P4).
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
}

export interface KbSelectInput<T extends KbChunkSource> {
  items: readonly T[];
  guestMessage: string;
  history?: readonly { direction: "inbound" | "outbound"; body: string }[];
  /** Bayrağı ezer (test/harness). Verilmezse env. */
  mode?: KbRetrievalMode;
  budgetChars?: number;
  maxChunks?: number;
  /** Anlamsal puanlar (parça anahtarı → 0..1), önceden hesaplanmış; yoksa yalnız sözcüksel. */
  semantic?: ReadonlyMap<string, number>;
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
  evidence: KbRetrievalEvidence | null;
}

// Puan bileşenleri — ölçülerek ayarlanır (harness), politika değildir.
export const HINT_BONUS = 0.35;
export const TITLE_BONUS = 0.15;
export const PHRASE_BONUS = 0.1;
export const CARRY_WEIGHT = 0.5;
export const RELEVANCE_FLOOR_ABS = 0.1;
export const RELEVANCE_FLOOR_REL = 0.25;
export const MAX_CHUNKS_PER_ITEM = 3;
export const MAX_SUBQUERIES = 4;
/** Sorgu bu kadar az içerik kökü taşıyorsa önceki misafir mesajları bağlam olarak eklenir. */
const THIN_QUERY_STEMS = 2;
const CARRY_HISTORY_MESSAGES = 2;
const HHMM = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/;
const CONFLICT_CATEGORIES = new Set(["checkin", "checkout"]);

const SUBQUERY_SPLIT = /[?\n;,]+|\s+(?:ve|ayrica|ayrıca|bir de|and|also|plus)\s+/i;

/**
 * ZAYIF SORGU KÖKLERİ: tek başına bir parçayı ADAY yapmaz (BM25 puanına yine
 * girer). "Jakuzi var mı?" sorusunda "var", "vardır" içeren her parçayı
 * eşleştirir ve geri çekilmeyi (no_lexical_hits) engellerdi (ölçüldü) — oysa
 * doğru davranış tam kümeyi verip modelin dürüstçe "bilgi yok" diyebilmesidir.
 */
const WEAK_QUERY_TERMS = new Set(["var", "yok", "lazim", "gerek", "isti", "kullan", "yap", "ol", "et", "al", "ver", "bul", "gel", "git", "bak", "koy", "birak", "acil", "sorun", "problem", "yardim", "help", "need", "want", "use", "get", "put", "leave", "find", "know", "bil"]);

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

function hasBigram(docStems: readonly string[], a: string, b: string): boolean {
  for (let i = 0; i + 1 < docStems.length; i++) {
    if (docStems[i] === a && docStems[i + 1] === b) return true;
  }
  return false;
}

interface Candidate {
  idx: number;
  score: number;
}

function rankForSubquery(
  index: KbIndex,
  subquery: string,
  carryStems: readonly string[],
  semantic: ReadonlyMap<string, number> | undefined,
): Candidate[] {
  const own = contentStems(subquery);
  // İNCE SORGU ("Ücretli mi?"): önceki MİSAFİR mesajlarının kökleri hem ağırlığa
  // (0.5) hem kavram genişletmesine girer — tek adım, tek karar noktası.
  const carried = own.length < THIN_QUERY_STEMS ? carryStems : [];
  const weights = new Map<string, number>();
  for (const s of own) weights.set(s, 1);
  for (const s of carried) if (!weights.has(s)) weights.set(s, CARRY_WEIGHT);
  const { expansion, categoryHints } = expandQuery([...own, ...carried]);
  for (const [s, w] of expansion) if (!weights.has(s)) weights.set(s, w);

  const { scores, resolved } = index.bm25.scores(weights);
  let max = 0;
  for (const v of scores) if (v > max) max = v;
  const ownSet = new Set(own);
  const bigrams: [string, string][] = [];
  for (let i = 0; i + 1 < own.length; i++) bigrams.push([own[i], own[i + 1]]);
  // Aday olma şartı: en az bir GÜÇLÜ sorgu kökü (fuzzy çözümü dahil) parçada
  // geçmeli YA DA kategori ipucu olmalı. Zayıf kökler yalnız sıralar.
  const strong = new Set<string>();
  for (const t of weights.keys()) if (!WEAK_QUERY_TERMS.has(t)) strong.add(resolved.get(t) ?? t);

  const out: Candidate[] = [];
  index.chunks.forEach((chunk, i) => {
    const doc = index.bm25.docs[i];
    const hint = categoryHints.get(chunk.category as never) ?? 0;
    let strongHit = false;
    for (const t of strong) {
      if (doc.tf.has(t)) {
        strongHit = true;
        break;
      }
    }
    if (!strongHit && hint === 0) return;
    let s = max > 0 ? scores[i] / max : 0;
    if (hint > 0) s += HINT_BONUS * hint;
    if (ownSet.size > 0) {
      for (const t of doc.titleStems) {
        if (ownSet.has(t)) {
          s += TITLE_BONUS;
          break;
        }
      }
    }
    if (bigrams.some(([a, b]) => hasBigram(doc.stems, a, b))) s += PHRASE_BONUS;
    s = blendScores(s, semantic?.get(chunkKey(chunk)));
    if (s > 0) out.push({ idx: i, score: s });
  });
  const best = out.reduce((m, c) => Math.max(m, c.score), 0);
  const floor = Math.max(RELEVANCE_FLOOR_ABS, best * RELEVANCE_FLOOR_REL);
  return out
    .filter((c) => c.score >= floor)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ca = index.chunks[a.idx];
      const cb = index.chunks[b.idx];
      const ta = ca.updatedAt.getTime();
      const tb = cb.updatedAt.getTime();
      if (tb !== ta) return tb - ta;
      if (ca.id !== cb.id) return ca.id < cb.id ? -1 : 1;
      return ca.chunkIndex - cb.chunkIndex;
    });
}

function legacyResult<T extends KbChunkSource>(
  items: readonly T[],
  mode: KbRetrievalMode,
  evidence: KbRetrievalEvidence | null,
): KbSelectResult<T> {
  return { mode, items: items as SelectedKbItem<T>[], droppedItems: 0, selection: "all", evidence };
}

export function selectKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): KbSelectResult<T> {
  const mode = input.mode ?? kbRetrievalMode();
  if (mode !== "hybrid") return legacyResult(input.items, "legacy", null);
  const started = performance.now();
  const evidence = (fb: KbSelectFallback, q: number, sel: number, cand: number): KbRetrievalEvidence => ({
    mode: "hybrid",
    q,
    fb,
    sel,
    cand,
    ms: Math.round((performance.now() - started) * 10) / 10,
  });
  try {
    const budget = input.budgetChars ?? KB_RETRIEVAL_CHAR_BUDGET;
    const maxChunks = input.maxChunks ?? KB_RETRIEVAL_MAX_CHUNKS;
    const items = input.items;
    if (items.length === 0) return legacyResult(items, "hybrid", evidence("small_kb", 0, 0, 0));
    // KÜÇÜK KB → SEÇİM YOK: tamamı bütçeye sığıyorsa retrieval'ın katkısı yok,
    // riski var (kaçırılan parça = gereksiz devir). Retrieval yalnız gerektiğinde.
    if (items.length <= maxChunks && renderedCharsAll(items) <= budget) {
      return legacyResult(items, "hybrid", evidence("small_kb", 0, items.length, items.length));
    }
    const subqueries = splitQuestions(input.guestMessage);
    const index = getOrBuildKbIndex(items, input.now);
    if (subqueries.length === 0) {
      return legacyResult(items, "hybrid", evidence("empty_query", 0, 0, index.chunks.length));
    }
    const carryStems = (input.history ?? [])
      .filter((m) => m.direction === "inbound")
      .slice(-CARRY_HISTORY_MESSAGES)
      .flatMap((m) => contentStems(m.body));

    const ranked = subqueries.map((q) => rankForSubquery(index, q, carryStems, input.semantic));
    if (ranked.every((r) => r.length === 0)) {
      return legacyResult(items, "hybrid", evidence("no_lexical_hits", subqueries.length, 0, index.chunks.length));
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
          const n = perItem.get(chunk.id) ?? 0;
          if (n >= MAX_CHUNKS_PER_ITEM) continue;
          picked.push(cand.idx);
          pickedSet.add(cand.idx);
          perItem.set(chunk.id, n + 1);
          progressed = true;
          break;
        }
      }
    }

    // ÇELİŞKİ KORUMA: seçilen bir giriş/çıkış parçası varsa aynı kategoride saat
    // taşıyan diğer parçalar da hemen ardından eklenir (P4 iki kaynağı görsün).
    const conflictCats = new Set<string>();
    for (const idx of picked) {
      const c = index.chunks[idx];
      if (CONFLICT_CATEGORIES.has(c.category) && HHMM.test(c.text)) conflictCats.add(c.category);
    }
    if (conflictCats.size > 0) {
      const extras: number[] = [];
      index.chunks.forEach((c, i) => {
        if (!pickedSet.has(i) && conflictCats.has(c.category) && HHMM.test(c.text)) extras.push(i);
      });
      if (extras.length > 0) {
        // İlk seçilen çelişki-kategorili parçanın hemen arkasına.
        const anchor = picked.findIndex((i) => conflictCats.has(index.chunks[i].category));
        picked.splice(anchor + 1, 0, ...extras);
        for (const i of extras) pickedSet.add(i);
      }
    }

    // Bütçe: en az bir parça her zaman gider (isabet varken boş blok gitmez).
    const chosen: KbChunk[] = [];
    let used = 0;
    for (const idx of picked) {
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
    return {
      mode: "hybrid",
      items: selected,
      droppedItems,
      selection: "retrieved",
      evidence: evidence("none", subqueries.length, selected.length, index.chunks.length),
    };
  } catch (err) {
    // Retrieval hatası ürünü BOZMAZ: legacy küme gider, hata raporlanır.
    void reportError("kb-retrieval-select", err);
    return legacyResult(input.items, "hybrid", evidence("error", 0, 0, 0));
  }
}
