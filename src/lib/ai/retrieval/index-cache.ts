import { createHash } from "node:crypto";
import { Bm25Index } from "./bm25";
import { chunkItems, chunkKey, type KbChunk, type KbChunkSource } from "./chunker";
import { NgramIndex } from "./sources";
import { extractFieldTimes, type FieldTimes } from "./rerank";

// ---------------------------------------------------------------------------
// İNDEKS ÖNBELLEĞİ — İÇERİK PARMAK İZİYLE (RAG dilim 1, 09-09).
//
// 🚨 ANAHTAR `max(updatedAt)` DEĞİLDİR (CLAUDE.md: o bir sürüm kimliği değil).
// Anahtar, girdi kümesinin TAMAMININ parmak izidir: her kalemin kimliği +
// `updatedAt` + kategori/başlık/içerik özeti. Sonuç:
//   - silinen / pasifleşen / onaydan düşen kalem → küme değişir → yeni indeks
//     (türetilmiş indekste eski içerik YAŞAYAMAZ);
//   - içerik `updatedAt` değişmeden değişse bile (ör. yer tutucu ikamesi bir
//     misafirin ADINI içeriğe yazar) parmak izi değişir → başka misafirin adı
//     taşıyan parça ASLA başka bir sohbete dönmez.
// Yetki/onay/sır filtreleri bu önbelleğin ÖNÜNDEDİR: önbellek yalnız kendisine
// verilen (zaten süzülmüş) kümeyi indeksler; küme başına ayrı giriş.
//
// LRU + TTL, `translate.ts` emsali (sınırlı, deploy'da sıfırlanır, replikalar
// arası paylaşılmaz — bir hızlandırmadır, doğruluk kaynağı değil).
// ---------------------------------------------------------------------------

export const INDEX_CACHE_MAX_ENTRIES = 64;
export const INDEX_CACHE_TTL_MS = 10 * 60 * 1000;

export interface KbIndex {
  fingerprint: string;
  chunks: KbChunk[];
  bm25: Bm25Index;
  /** Karakter 3-gram kaynağı (ikinci aday üreticisi; `sources.ts`). */
  ngram: NgramIndex;
  /**
   * Parça başına SAAT ALANI → SAATLER (`extractFieldTimes`: her saat içinde
   * geçtiği cümleciğin alan kavramına, o yoksa başlığın alanına atfedilir;
   * belirsizde hiçbirine). Çelişki kontrolü kategoriye değil buna bakar.
   */
  fieldTimes: FieldTimes[];
}

const _cache = new Map<string, { value: KbIndex; expires: number }>();

export function fingerprintItems(items: readonly KbChunkSource[]): string {
  const h = createHash("sha256");
  const lines = items
    .map(
      (i) =>
        `${i.id}|${i.updatedAt instanceof Date ? i.updatedAt.getTime() : "?"}|${i.category}|` +
        createHash("sha256").update(`${i.title}\n${i.content}`).digest("hex").slice(0, 16),
    )
    .sort();
  for (const l of lines) h.update(l).update("\n");
  return h.digest("hex").slice(0, 32);
}

export function buildKbIndex(items: readonly KbChunkSource[]): KbIndex {
  const chunks = chunkItems(items);
  const bm25 = new Bm25Index(chunks.map((c) => ({ key: chunkKey(c), title: c.title, text: c.text })));
  const ngram = new NgramIndex(chunks.map((c) => `${c.title} ${c.text}`));
  const fieldTimes = chunks.map((c) => extractFieldTimes(c.title, c.text, c.category));
  return { fingerprint: fingerprintItems(items), chunks, bm25, ngram, fieldTimes };
}

export function getOrBuildKbIndex(items: readonly KbChunkSource[], now = Date.now()): KbIndex {
  const fp = fingerprintItems(items);
  const hit = _cache.get(fp);
  if (hit && hit.expires > now) {
    _cache.delete(fp);
    _cache.set(fp, hit);
    return hit.value;
  }
  if (hit) _cache.delete(fp);
  const built = buildKbIndex(items);
  if (_cache.size >= INDEX_CACHE_MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(fp, { value: built, expires: now + INDEX_CACHE_TTL_MS });
  return built;
}

/** Test kancaları (`__resetTranslateCache` emsali). */
export function __resetKbIndexCache(): void {
  _cache.clear();
}
export function __kbIndexCacheSize(): number {
  return _cache.size;
}
