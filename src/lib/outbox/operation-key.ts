// ---------------------------------------------------------------------------
// S1 (kurucu kararı 11-11) — İŞLEM KİMLİĞİ ANAHTARLARI, TEK KAYNAK. YAPRAK modül (hiçbir şey içe aktarmaz).
//
// Yapay zekâ önerisinin onayı bir işlemdir; kuyruk anahtarı ve doğrudan yolun talebi bu anahtarı kullanır. Üç yer aynı biçimi bilmek
// zorunda: cevap rotası (anahtarı kurar), gönderim çekirdeği (misafire ulaşmamış gönderimden sonra yeniden deneme anahtarını türetir),
// gönderim durumu ekranı (yeniden denemeyle DEVRALINMIŞ eski satırı tanır). Biçim burada; ayrışamaz.
// ---------------------------------------------------------------------------

/** İşlemin taban anahtarı: konuşma + önerinin üretildiği andaki konuşma sonu (son gerçek mesaj). */
export function suggestionOperationKey(conversationId: string, anchorMessageId: string): string {
  return `suggestion:${conversationId}:${anchorMessageId}`;
}

/** "Gönderilemedi / iptal" ile biten gönderimden SONRAKİ denemenin anahtarı — o satırdan türer (iki yönetici aynı anahtara düşer). */
export function operationRetryKey(baseKey: string, failedRowId: string): string {
  return `${baseKey}:retry:${failedRowId}`;
}

/** Anahtar bir işlem anahtarıysa (taban ya da yeniden deneme) taban anahtarı; başka türden anahtarda null. */
export function operationBaseKey(key: string): string | null {
  const m = /^(suggestion:[^:]+:[^:]+)(?::retry:[^:]+)?$/.exec(key);
  return m ? m[1] : null;
}
