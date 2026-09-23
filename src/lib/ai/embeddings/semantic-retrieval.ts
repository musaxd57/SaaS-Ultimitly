/* ---------------------------------------------------------------------------
 * ANLAMSAL ADAY KAYNAĞI — ÜRETİM YOLU (E5 hazırlığı, 09-23).
 *
 * 🚨 ANAHTAR VARSAYILAN KAPALI (`KB_SEMANTIC_RETRIEVAL`, `retrieval/flag.ts`). Kapalıyken bu
 * modül ağa ÇIKMAZ, seçiciye puan VERMEZ ve kanıta alan YAZMAZ — davranış birebir eskisi
 * (davranışsal pin `kb-semantic-retrieval.test.ts`). Açma sırası: E4 ölçümü (eşik + birleşim,
 * `npm run eval`, < 0,1 sent) → `SEMANTIC_COSINE_THRESHOLD` ölçülen değere → kurucu onayı → env.
 *
 * ── NEDEN (ölçüm 09-23, `docs/olcum/kb-retrieval-parafraz-2026-09-23.md` + ajan ölçümü) ──────
 * 100 kalemlik KB'de cevaplanabilir 275 sorunun 58'inde cevap parçası sözcüksel ADAY LİSTESİNE
 * HİÇ GİRMİYOR (çoğu kelime paylaşmayan parafraz: "evi ılık yapabilir miyiz" ↔ "kombi"). Hiçbir
 * eşik/kesme kuralı bunu düzeltemez — kesme yalnız aday listesini KISALTIR. Eksik olan ikinci
 * bir ADAY ÜRETİCİSİDİR: sektörün iki aşamalı düzeni (yoğun + seyrek aday → birleşim → sıralama).
 *
 * ── TASARIM ────────────────────────────────────────────────────────────────────────────────
 *  · ALT SORGU BAŞINA puan (`retrievalQueries` tek kaynak): çok sorulu mesajda tek mesaj vektörü
 *    iki konunun karışımıdır. Her alt sorgu 1–2 metinle sorulur (ait olduğu ham cümle + virgülle
 *    bölündüyse kendisi) ve parçanın puanı EN YÜKSEK kosinüstür (çoklu sorgu).
 *  · SICAK YOL KISA: yalnız sorgu metinleri (≤6) + küçük bir eksik parça kümesi satır içinde,
 *    `SEMANTIC_HOT_PATH_DEADLINE_MS` bütçesiyle. Aşılırsa bu karar SÖZCÜKSEL devam eder.
 *  · SOĞUK KB MİSAFİRİ BEKLETMEZ: parça vektörleri eksik ve satır içine sığmıyorsa arka planda
 *    ısıtılır (saatlik metin tavanı), bu karar sözcüksel (`cold`). YARIM HARİTA YOK: bazı
 *    parçaların puanı olup bazılarının olmaması sıralamayı sessizce çarpıtırdı.
 *  · Vektörler SÜREÇ BELLEĞİNDE (Float32Array, LRU). Kalıcı tablo E2 (migration onayı); o gelene
 *    kadar bedel her yeniden başlatmada KB başına tek seferlik ~0,1 sent.
 *  · ASLA FIRLATMAZ; her arıza "anlamsal kaynak yok" demektir (seçici sözcüksel çalışır).
 *  · Veri akışı YENİ DEĞİL: KB metni ve misafir mesajı zaten aynı sağlayıcıya gidiyor
 *    (`provider.ts` başlığı). PII kanıta/loga YAZILMAZ; anahtarlar metin ÖZETİDİR.
 * ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { reportError } from "@/lib/report-error";
import { chunkKey, type KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { kbRetrievalMode, semanticRetrievalInfo, type KbRetrievalMode } from "@/lib/ai/retrieval/flag";
import { getOrBuildKbIndex } from "@/lib/ai/retrieval/index-cache";
import { dropSuperseded, type Supersedable } from "@/lib/ai/retrieval/rerank";
import { retrievalNeeded, retrievalQueries } from "@/lib/ai/retrieval/select";
import { thresholdTransform } from "@/lib/ai/retrieval/semantic";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { embedTexts, embeddingModel, EMBEDDING_BATCH_MAX } from "@/lib/ai/embeddings/provider";

/** Misafir beklerken gömme için toplam bütçe (tekrar denemeler dâhil). */
export const SEMANTIC_HOT_PATH_DEADLINE_MS = 1_500;
/** Parça vektörü deposu tavanı: 4.096 × 1.536 × 4 bayt ≈ 25 MB. */
export const CHUNK_VECTOR_CACHE_MAX = 4_096;
/**
 * Tek KB için anlamsal kaynağın desteklediği parça tavanı. Üstünde (200 kalem × uzun rehber) depo
 * KB'yi tek başına taşıyamaz ve sürekli yeniden ısıtma = sessiz maliyet → `unavailable`.
 */
export const SEMANTIC_MAX_CHUNKS = 1_000;
/** Arka plan ısıtmasının saatlik metin tavanı (≈300k token ≈ 0,6 sent/saat üst sınır). */
export const WARM_TEXTS_PER_HOUR = 2_000;

export type SemanticStatus = "off" | "not_needed" | "ok" | "cold" | "unavailable";

export interface SemanticPrep {
  /** Alt sorgu → parça anahtarı → seçici ölçeğinde puan. Yalnız `ok`ta dolu. */
  bySubquery?: Map<string, Map<string, number>>;
  status: SemanticStatus;
  ms: number;
}

export interface SemanticPrepInput<T extends KbChunkSource> {
  items: readonly T[];
  guestMessage: string;
  history?: readonly { direction: "inbound" | "outbound"; body: string }[];
  mode?: KbRetrievalMode;
  fullSetMaxItems?: number;
  now?: number;
}

// ─── parça vektörü deposu (LRU) ─────────────────────────────────────────────

const store = new Map<string, Float32Array>();
let storeMax = CHUNK_VECTOR_CACHE_MAX;
const warming = new Set<string>();
const inflight = new Set<Promise<void>>();
let warmWindowStart = 0;
let warmUsed = 0;

function storeKey(model: string, text: string): string {
  return `${model}:${createHash("sha256").update(text).digest("base64url")}`;
}

function storeGet(key: string): Float32Array | undefined {
  const v = store.get(key);
  if (v === undefined) return undefined;
  store.delete(key);
  store.set(key, v);
  return v;
}

function storeSet(key: string, vec: readonly number[]): void {
  store.set(key, Float32Array.from(vec));
  while (store.size > storeMax) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function takeWarmBudget(n: number, now: number): boolean {
  if (now - warmWindowStart >= 3_600_000) {
    warmWindowStart = now;
    warmUsed = 0;
  }
  if (warmUsed + n > WARM_TEXTS_PER_HOUR) return false;
  warmUsed += n;
  return true;
}

/** Eksik parça metinlerini arka planda gömer (bekletmez, fırlatmaz, tekrarlamaz). */
function scheduleWarm(model: string, texts: readonly string[]): void {
  const todo = [...new Set(texts)].filter((t) => {
    const k = storeKey(model, t);
    return !store.has(k) && !warming.has(k);
  });
  if (todo.length === 0 || !takeWarmBudget(todo.length, Date.now())) return;
  const keys = todo.map((t) => storeKey(model, t));
  for (const k of keys) warming.add(k);
  const job = (async () => {
    try {
      for (let i = 0; i < todo.length; i += EMBEDDING_BATCH_MAX) {
        const batch = todo.slice(i, i + EMBEDDING_BATCH_MAX);
        const out = await embedTexts(batch);
        // Sağlayıcı arızası: dur. Alarm sağlayıcının kendi (geçiş tabanlı) yolunda; burada ikinci
        // bir alarm YOK (kalıcı kota arızasında her misafir mesajı bir e-posta demek olurdu).
        if (!out) break;
        batch.forEach((t, j) => storeSet(storeKey(model, t), out[j]));
      }
    } catch (err) {
      void reportError("kb-semantic-warm", err);
    } finally {
      for (const k of keys) warming.delete(k);
    }
  })();
  inflight.add(job);
  void job.finally(() => inflight.delete(job));
}

function dot(a: readonly number[], b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Seçiciye verilecek ALT SORGU BAŞINA anlamsal puanlar. Anahtar kapalıyken HİÇBİR ŞEY yapmaz
 * (`off`, ms 0). Fırlatmaz.
 */
export async function prepareSemanticScores<T extends KbChunkSource>(input: SemanticPrepInput<T>): Promise<SemanticPrep> {
  if (!semanticRetrievalInfo().enabled) return { status: "off", ms: 0 };
  if ((input.mode ?? kbRetrievalMode()) !== "hybrid") return { status: "off", ms: 0 };
  const started = performance.now();
  const done = (status: SemanticStatus, bySubquery?: Map<string, Map<string, number>>): SemanticPrep => ({
    status,
    ms: Math.round((performance.now() - started) * 10) / 10,
    ...(bySubquery ? { bySubquery } : {}),
  });
  try {
    if (!retrievalNeeded(input.items, input.fullSetMaxItems)) return done("not_needed");
    const { queries } = retrievalQueries(input.guestMessage, input.history);
    if (queries.length === 0) return done("not_needed");
    // Seçiciyle AYNI küme (sürüm kuralı sonrası) → aynı indeks önbellek girdisi, aynı parça anahtarları.
    const { kept } = dropSuperseded(input.items as readonly (T & Supersedable)[]);
    const index = getOrBuildKbIndex(kept, input.now);
    if (index.chunks.length > SEMANTIC_MAX_CHUNKS) return done("unavailable");

    const model = embeddingModel();
    const chunkTexts = index.chunks.map((c) => embeddingTextFor(c));
    const missing = [...new Set(chunkTexts.filter((t) => !store.has(storeKey(model, t))))];
    const queryTexts = [...new Set(queries.flatMap((q) => q.embedTexts))];
    if (missing.length > 0 && missing.length + queryTexts.length > EMBEDDING_BATCH_MAX) {
      scheduleWarm(model, missing);
      return done("cold");
    }

    const vecs = await embedTexts([...queryTexts, ...missing], { deadlineMs: SEMANTIC_HOT_PATH_DEADLINE_MS });
    if (!vecs) return done("unavailable");
    missing.forEach((t, j) => storeSet(storeKey(model, t), vecs[queryTexts.length + j]));
    const queryVec = new Map(queryTexts.map((t, j) => [t, vecs[j]]));

    const chunkVecs: Float32Array[] = [];
    for (const t of chunkTexts) {
      const v = storeGet(storeKey(model, t));
      if (!v) return done("cold"); // depo bu KB'yi tutamadı (eşzamanlı tahliye) — yarım harita YOK
      chunkVecs.push(v);
    }

    const bySubquery = new Map<string, Map<string, number>>();
    for (const q of queries) {
      const qvs = q.embedTexts.map((t) => queryVec.get(t));
      if (qvs.length === 0 || qvs.some((v) => !v)) return done("unavailable");
      const scores = new Map<string, number>();
      index.chunks.forEach((c, i) => {
        // Çoklu sorgu: alt sorgunun metinlerinden (ham cümle / alt sorgu) EN YÜKSEK benzerlik.
        let cos = -1;
        for (const qv of qvs as number[][]) cos = Math.max(cos, dot(qv, chunkVecs[i]));
        const v = thresholdTransform(cos);
        if (v > 0) scores.set(chunkKey(c), v);
      });
      bySubquery.set(q.subquery, scores);
    }
    return done("ok", bySubquery);
  } catch (err) {
    void reportError("kb-semantic-prepare", err);
    return done("unavailable");
  }
}

// ─── test/teşhis kancaları ──────────────────────────────────────────────────

export function __resetSemanticRetrieval(): void {
  store.clear();
  storeMax = CHUNK_VECTOR_CACHE_MAX;
  warming.clear();
  warmWindowStart = 0;
  warmUsed = 0;
}

export function __semanticStoreSize(): number {
  return store.size;
}

/** Test: depo tavanını küçült (tahliye yarışını sınamak için). `__resetSemanticRetrieval` geri alır. */
export function __setChunkVectorCacheMaxForTests(n: number): void {
  storeMax = n;
}

/** Süren arka plan ısıtmalarının bitmesini bekler (test). */
export async function __awaitSemanticWarm(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight]);
}
