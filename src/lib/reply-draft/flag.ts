// TASLAK ↔ GÖNDERİLEN METİN BAĞI anahtarları (kurucu 11-13; tasarım docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md §7). YAPRAK modül.
// İkisi de VARSAYILAN KAPALI; yalnız "1" açar (`scripts/env-check.mjs` STRICT_ONE_FLAGS). Kapalıyken hiçbir satır yazılmaz, ağ çağrısı yok.

/** Gölge bağ kaydı (gönderim başarılı olduktan sonra, kendi try/catch'iyle). */
export function replyDraftLinkEnabled(): boolean {
  return process.env.REPLY_DRAFT_LINK_ENABLED === "1";
}

/** Anlam benzerliği + eklenen parça vektörleri (zamanlanmış senkronun sonunda, bütçeli; OpenAI embedding kredisi gerekir). */
export function replyDraftEmbeddingEnabled(): boolean {
  return process.env.REPLY_DRAFT_EMBEDDING_ENABLED === "1";
}
