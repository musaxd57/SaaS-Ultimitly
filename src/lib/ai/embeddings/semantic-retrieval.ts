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
 *  · SICAK YOL KISA: YALNIZ sorgu metinleri, `SEMANTIC_HOT_PATH_DEADLINE_MS` bütçesiyle; geçici
 *    arızada çağrı başına alarm YOK (`quiet`). Aşılırsa bu karar SÖZCÜKSEL devam eder. Kalıcı depo açıkken bellekte eksik parça
 *    varsa önce depodan AYRI bir bütçeyle (`VECTOR_STORE_READ_TIMEOUT_MS`, 250 ms) okunur — toplam bekleme en çok ikisinin toplamı.
 *  · PARÇA VEKTÖRLERİ YALNIZ ARKA PLANDA (saatlik metin tavanı): eksik parça varsa ısıtma başlar ve
 *    bu karar sözcüksel (`cold`). YARIM HARİTA YOK: bazı parçaların puanı olup bazılarının
 *    olmaması sıralamayı sessizce çarpıtırdı.
 *  · BİLİNEN SINIRLAR: depo ve ısıtma tavanı TÜM kiracılarda ORTAK (vektör metnin saf fonksiyonu,
 *    kiracı taşımaz; ama büyük bir kiracı saatlik ısıtma tavanını tüketebilir) · toplam parça depo
 *    tavanını aşarsa KB'ler birbirini tahliye eder (tavanla sınırlı yeniden ısıtma). Kalıcı çözüm E2.
 *  · Vektörler SÜREÇ BELLEĞİNDE (Float32Array, LRU). Kalıcı depo (migration 87, `vector-store.ts`, anahtar
 *    `KB_VECTOR_STORE_ENABLED`) açıkken ısıtma önce depoya bakar, yalnız eksikleri gömer ve üreteni depoya yazar; sıcak yol bellekte
 *    eksik parça görürse depodan zaman sınırlı okur. Kapalıyken bedel her yeniden başlatmada KB başına tek seferlik ~0,1 sent.
 *  · ASLA FIRLATMAZ; her arıza "anlamsal kaynak yok" demektir (seçici sözcüksel çalışır).
 *  · Veri akışı YENİ DEĞİL: KB metni ve misafir mesajı zaten aynı sağlayıcıya gidiyor
 *    (`provider.ts` başlığı). PII kanıta/loga YAZILMAZ; anahtarlar metin ÖZETİDİR.
 * ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { reportError } from "@/lib/report-error";
import { chunkItems, chunkKey, type KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { kbRetrievalMode, semanticRetrievalInfo, type KbRetrievalMode } from "@/lib/ai/retrieval/flag";
import { getOrBuildKbIndex } from "@/lib/ai/retrieval/index-cache";
import { dropSuperseded, type Supersedable } from "@/lib/ai/retrieval/rerank";
import { retrievalNeeded, retrievalQueries, type ExtraQuery } from "@/lib/ai/retrieval/select";
import { semanticThresholdFor, thresholdTransform } from "@/lib/ai/retrieval/semantic";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { embedTexts, embeddingModel, EMBEDDING_BATCH_MAX } from "@/lib/ai/embeddings/provider";
import {
  inputHashOf,
  loadChunkVectors,
  pairKey,
  persistChunkVectors,
  vectorStoreEnabled,
  type ChunkOwner,
  VECTOR_STORE_READ_TIMEOUT_MS,
  VECTOR_STORE_WARM_READ_TIMEOUT_MS,
} from "@/lib/ai/embeddings/vector-store";

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
  /** Anlama katmanının yeniden yazdığı sorgular — seçiciyle AYNI liste gömülür (`retrievalQueries`). */
  extraQueries?: readonly ExtraQuery[];
  mode?: KbRetrievalMode;
  fullSetMaxItems?: number;
  /** Küçük-KB ölçüsü için isteme girecek hâl (yer tutucular doldurulmuş) — seçiciyle AYNI karar (`KbSelectInput.sizeItems`). */
  sizeItems?: readonly T[];
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

function trimStore(): void {
  while (store.size > storeMax) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function storeSet(key: string, vec: readonly number[]): void {
  store.set(key, Float32Array.from(vec));
  trimStore();
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

/** Isıtma girdisi: gömülecek metin + o metni taşıyan kalem ve ısıtmanın gördüğü kalem sürümü (kalıcı depo satırı kaleme bağlanır). */
interface WarmEntry {
  text: string;
  itemId: string;
  updatedAt: Date;
}

/**
 * Kalıcı depoda KENDİ satırı olduğu bilinen (kalem, girdi özeti) çiftleri — yalnız anahtar açıkken dolar, süreç başına ve sınırlı. Aynı
 * metin iki kalemde (ör. kopyalanmış bilgi tabanı) geçerken bellekteki vektör ikinci kalemin satırını da yazdırır (Haiku 10-28): yoksa
 * yeniden başlatmadan sonra o kalemin dairesi yeniden ödemeye ve "cold"a düşerdi.
 */
const persisted = new Set<string>();
const PERSISTED_MAX = 50_000;
function markPersisted(keys: Iterable<string>): void {
  for (const k of keys) {
    if (persisted.size >= PERSISTED_MAX) persisted.clear();
    persisted.add(k);
  }
}

function pushOwner(map: Map<string, ChunkOwner[]>, text: string, owner: ChunkOwner): void {
  const list = map.get(text) ?? [];
  if (!list.some((o) => o.kbItemId === owner.kbItemId)) list.push(owner);
  map.set(text, list);
}

/**
 * Eksik parça metinlerini arka planda gömer (bekletmez, fırlatmaz, tekrarlamaz). Kuyruğa GERÇEKTEN alınan metin sayısını döner.
 * Kalıcı depo açıkken: önce depodan okur (bulunanlar gömülmez), saatlik bütçe YALNIZ gerçekten gömülecek metne sayılır (depodan okuma
 * bütçe doluyken de yapılır), üretilen vektör ve bellekte olup kalemin kendi satırı olmayan vektör depoya yazılır.
 */
function scheduleWarm(model: string, entries: readonly WarmEntry[]): number {
  const storeOn = vectorStoreEnabled();
  const owners = new Map<string, ChunkOwner[]>();
  const persistOnly = new Map<string, ChunkOwner[]>();
  for (const e of entries) {
    const k = storeKey(model, e.text);
    if (warming.has(k)) continue;
    const owner = { kbItemId: e.itemId, updatedAt: e.updatedAt };
    if (store.has(k)) {
      if (storeOn && !persisted.has(pairKey(e.itemId, inputHashOf(e.text)))) pushOwner(persistOnly, e.text, owner);
      continue;
    }
    pushOwner(owners, e.text, owner);
  }
  const todo = [...owners.keys()];
  if (storeOn) {
    if (todo.length === 0 && persistOnly.size === 0) return 0;
  } else if (todo.length === 0 || !takeWarmBudget(todo.length, Date.now())) {
    return 0;
  }
  const keys = todo.map((t) => storeKey(model, t));
  for (const k of keys) warming.add(k);
  const job = (async () => {
    try {
      let remaining = todo;
      if (storeOn) {
        const fromMemory = [...persistOnly].flatMap(([text, list]) => {
          const vector = store.get(storeKey(model, text));
          return vector ? [{ owners: list, text, vector }] : [];
        });
        if (fromMemory.length > 0) markPersisted(await persistChunkVectors(model, fromMemory));
        if (todo.length > 0) {
          const refs = todo.flatMap((text) => (owners.get(text) ?? []).map((o) => ({ kbItemId: o.kbItemId, text })));
          const { vectors, found } = await loadChunkVectors(model, refs, VECTOR_STORE_WARM_READ_TIMEOUT_MS);
          markPersisted(found);
          for (const [text, vec] of vectors) store.set(storeKey(model, text), vec);
          trimStore();
          // Metin başka bir kalemin satırından bulunduysa bu kalemin KENDİ satırı yazılır.
          const ownless = [...vectors].flatMap(([text, vector]) => {
            const hash = inputHashOf(text);
            const list = (owners.get(text) ?? []).filter((o) => !found.has(pairKey(o.kbItemId, hash)));
            return list.length > 0 ? [{ owners: list, text, vector }] : [];
          });
          if (ownless.length > 0) markPersisted(await persistChunkVectors(model, ownless));
          remaining = todo.filter((t) => !vectors.has(t));
          if (remaining.length > 0 && !takeWarmBudget(remaining.length, Date.now())) remaining = [];
        }
      }
      for (let i = 0; i < remaining.length; i += EMBEDDING_BATCH_MAX) {
        const batch = remaining.slice(i, i + EMBEDDING_BATCH_MAX);
        const out = await embedTexts(batch, { quiet: true });
        // Sağlayıcı arızası: dur. Alarm sağlayıcının kendi (geçiş tabanlı) yolunda; burada ikinci
        // bir alarm YOK (kalıcı kota arızasında her misafir mesajı bir e-posta demek olurdu).
        if (!out) break;
        batch.forEach((t, j) => storeSet(storeKey(model, t), out[j]));
        if (storeOn) {
          markPersisted(await persistChunkVectors(model, batch.map((t, j) => ({ owners: owners.get(t) ?? [], text: t, vector: out[j] }))));
        }
      }
    } catch (err) {
      void reportError("kb-semantic-warm", err);
    } finally {
      for (const k of keys) warming.delete(k);
    }
  })();
  inflight.add(job);
  void job.finally(() => inflight.delete(job));
  return todo.length;
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
    if (!retrievalNeeded(input.sizeItems ?? input.items, input.fullSetMaxItems)) return done("not_needed");
    const { queries } = retrievalQueries(input.guestMessage, input.history, { embedTexts: true, extraQueries: input.extraQueries });
    if (queries.length === 0) return done("not_needed");
    // Seçiciyle AYNI küme (sürüm kuralı sonrası) → aynı indeks önbellek girdisi, aynı parça anahtarları.
    const { kept } = dropSuperseded(input.items as readonly (T & Supersedable)[]);
    const index = getOrBuildKbIndex(kept, input.now);
    if (index.chunks.length > SEMANTIC_MAX_CHUNKS) return done("unavailable");

    const model = embeddingModel();
    const chunkTexts = index.chunks.map((c) => embeddingTextFor(c));
    // 🚨 PARÇA VEKTÖRLERİ YALNIZ ARKA PLANDA ÜRETİLİR (09-23 inceleme). İlk sürüm eksik parçaları
    // sorguyla AYNI çağrıda, misafirin 1,5 sn'lik bütçesinde gömüyordu: çağrı bütçeyi aşınca eksikler
    // ısıtmaya hiç gitmiyor, KB her mesajda aynı ~50 parçayı yeniden ödeyip `unavailable` kalıyordu
    // (ölçüldü: 2 sn gecikmeli sağlayıcıda üç ardışık karar, depo büyümedi). Sektör düzeni de budur:
    // dizin YAZMA zamanında kurulur, sorgu zamanında yalnız sorgu gömülür. Bedel: yeni/değişen KB'nin
    // İLK kararı sözcüksel (`cold`). Aynı anda gelen çağrılar aynı parçaları iki kez ödemez (`warming`).
    let missingIdx = chunkTexts.flatMap((t, i) => (store.has(storeKey(model, t)) ? [] : [i]));
    // Kalıcı depo (anahtar açıkken): bellekte eksik parçalar YALNIZ bu kümenin kalem kimlikleriyle, zaman sınırıyla okunur. Okunan
    // vektörler bu kararda doğrudan kullanılır (bellek deposu dolu olup tahliye etse de — Haiku 10-28). Hâlâ eksik varsa aşağıda bugünkü
    // gibi "cold" + arka plan ısıtması (YARIM HARİTA YOK).
    const loaded = new Map<string, Float32Array>();
    if (missingIdx.length > 0 && vectorStoreEnabled()) {
      const refs = missingIdx.map((i) => ({ kbItemId: index.chunks[i].id, text: chunkTexts[i] }));
      const { vectors, found } = await loadChunkVectors(model, refs, VECTOR_STORE_READ_TIMEOUT_MS);
      markPersisted(found);
      for (const [text, vec] of vectors) {
        loaded.set(text, vec);
        store.set(storeKey(model, text), vec);
      }
      trimStore();
      missingIdx = missingIdx.filter((i) => !vectors.has(chunkTexts[i]));
    }
    const chunkVecs: Float32Array[] = [];
    for (const t of chunkTexts) {
      const v = storeGet(storeKey(model, t)) ?? loaded.get(t); // okuma tazeliği yeniler: kullanılan KB tahliyeye direnir
      if (v) chunkVecs.push(v);
    }
    if (missingIdx.length > 0 || chunkVecs.length !== chunkTexts.length) {
      // Depoda olanları `scheduleWarm` kendisi atlar → yalnız eksikler kuyruğa girer (bugünkü küme).
      scheduleWarm(
        model,
        chunkTexts.map((text, i) => ({ text, itemId: index.chunks[i].id, updatedAt: index.chunks[i].updatedAt })),
      );
      return done("cold"); // YARIM HARİTA YOK
    }

    const queryTexts = [...new Set(queries.flatMap((q) => q.embedTexts))];
    const vecs = await embedTexts(queryTexts, { deadlineMs: SEMANTIC_HOT_PATH_DEADLINE_MS, quiet: true });
    if (!vecs) return done("unavailable");
    const queryVec = new Map(queryTexts.map((t, j) => [t, vecs[j]]));

    const bySubquery = new Map<string, Map<string, number>>();
    // Eşik MODELE göre (kosinüs dağılımı modele özgü; #189).
    const threshold = semanticThresholdFor(model);
    for (const q of queries) {
      const qvs = q.embedTexts.map((t) => queryVec.get(t));
      if (qvs.length === 0 || qvs.some((v) => !v)) return done("unavailable");
      const scores = new Map<string, number>();
      index.chunks.forEach((c, i) => {
        // Çoklu sorgu: alt sorgunun metinlerinden (ham cümle / alt sorgu) EN YÜKSEK benzerlik.
        let cos = -1;
        for (const qv of qvs as number[][]) cos = Math.max(cos, dot(qv, chunkVecs[i]));
        const v = thresholdTransform(cos, threshold);
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

/**
 * YAZMA / AÇILIŞ ISITMASI (#189, `kb-warm.ts`): seçicinin bu kümeyle kuracağı parça metinlerinden depoda OLMAYANLARI arka plan
 * ısıtmasına verir (misafiri beklemez; saatlik tavan aynen). Kuyruğa alınan metin sayısını döner. Anahtar kapalıyken, küçük
 * KB'de (retrieval koşmayacak) ya da parça tavanını aşan KB'de hiçbir şey yapmaz. Fırlatmaz.
 * 🚨 Yalnız PARÇALAR (A7 #2, 09-27): sözcüksel dizini (BM25 + n-gram + parça başına saat alanı okuması) KURMAZ ve dizin
 * önbelleğine YAZMAZ — 60 kalem × 20k'da dizin 5,9 sn senkron CPU'ydu (olay döngüsü her kiracı için durur), yazılan girdi de
 * o an kullanılan başka bir kiracının dizinini tahliye edebiliyordu. Parçalar dizinin parçalarıyla aynı fonksiyondan
 * (`chunkItems`) → gömülen metinler birebir aynı (pinli).
 */
export function warmKbVectors<T extends KbChunkSource>(items: readonly T[]): number {
  try {
    if (!semanticRetrievalInfo().enabled) return 0;
    if (!retrievalNeeded(items)) return 0;
    const { kept } = dropSuperseded(items as readonly (T & Supersedable)[]);
    const chunks = chunkItems(kept);
    if (chunks.length > SEMANTIC_MAX_CHUNKS) return 0;
    const model = embeddingModel();
    // Depoda olmayan ve hâlihazırda ısıtılmayan metinler (sayı kuyruğa GERÇEKTEN alınanlar; bütçe reddederse 0).
    return scheduleWarm(
      model,
      chunks.map((c) => ({ text: embeddingTextFor(c), itemId: c.id, updatedAt: c.updatedAt })),
    );
  } catch (err) {
    void reportError("kb-semantic-warm-items", err);
    return 0;
  }
}

// ─── test/teşhis kancaları ──────────────────────────────────────────────────

export function __resetSemanticRetrieval(): void {
  store.clear();
  persisted.clear();
  storeMax = CHUNK_VECTOR_CACHE_MAX;
  warming.clear();
  warmWindowStart = 0;
  warmUsed = 0;
}

export function __semanticStoreSize(): number {
  return store.size;
}

/** Test: saatlik ısıtma bütçesini doldur (bütçe doluyken kalıcı depodan okumanın sürdüğünü sınamak için). */
export function __exhaustWarmBudgetForTests(): void {
  warmWindowStart = Date.now();
  warmUsed = WARM_TEXTS_PER_HOUR;
}

/** Test: depo tavanını küçült (tahliye yarışını sınamak için). `__resetSemanticRetrieval` geri alır. */
export function __setChunkVectorCacheMaxForTests(n: number): void {
  storeMax = n;
}

/** Süren arka plan ısıtmalarının bitmesini bekler (test). */
export async function __awaitSemanticWarm(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight]);
}
