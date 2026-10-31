/* ---------------------------------------------------------------------------
 * GÖMME MODELİ — YAPRAK MODÜL (hiçbir şey import etmez; `instrumentation.ts` açılış logu da okur). Tek okuyucu
 * `embeddingModel()`; `provider.ts` yeniden verir.
 * ------------------------------------------------------------------------- */

/**
 * Model. `text-embedding-3-small`: 1536 boyut, ölçülen maliyet kurucu org'un
 * TÜM bilgi tabanı için **0,18 sent** (tek sefer), sorgu tarafı mesaj başına
 * 67 token = sohbet isteminin %0,37'si.
 *
 * #189 (09-26 gece) ÖLÇÜMÜ: `OPENAI_EMBEDDING_MODEL=text-embedding-3-large` (1536'ya KISALTILMIŞ, ↓ `embeddingRequestExtras`;
 * boyut sözleşmesi ve depo belleği aynı) gerçekçi 276 kalemlik sette yeniden sıralayıcısız blokta Türkçe parafrazı 77→83/111,
 * Türkçe dışı dilleri 76→93/111 taşıdı; iki sorulu mesajda aday listesine hiç girmeyen cevap 7→0. Maliyet $0,13/1M token
 * (small $0,02) — 300 kalemlik KB'nin tamamı ≈ 0,8 sent, mesaj başına sorgu ≈ 0,002 sent. Varsayılan DEĞİŞMEDİ: kurucu
 * kararıyla env'den açılır (eşik modele göre ayrı, `semanticThresholdFor`).
 */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * 🚨 HER ÇAĞRIDA OKUNUR, import anında DONDURULMAZ.
 *
 * İlk yazımda `const EMBEDDING_MODEL = process.env… || default` idi ve test
 * bunu YAKALADI: env sonradan değişse bile modül eski değeri kullanmaya devam
 * ediyordu. Kardeş yol (`ai/index.ts:98`, `:396`) env'i çağrı anında okuyor;
 * ayrışma sessizdir ve önbellek anahtarı modeli içerdiği için EN KÖTÜ hâlde
 * "yeni modelin vektörü eski modelin anahtarıyla" saklanırdı.
 */
export function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}
