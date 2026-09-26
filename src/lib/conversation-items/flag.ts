/**
 * KONUŞMA ÖĞELERİ bayrağı (09-26, kurucu kararları; `docs/TASARIM-2026-09-26-konusma-ogeleri.md`). Yalnız tam "1" açar;
 * varsayılan KAPALI. Kapalıyken anlama katmanının şeması / istemi / önbellek anahtarı ve kapı bayt bayt eskisi.
 * Açma = ücretli ölçüm + örnekli sonuç + kurucu onayı.
 */
export function conversationItemsEnabled(): boolean {
  return process.env.AI_CONVERSATION_ITEMS_ENABLED === "1";
}
