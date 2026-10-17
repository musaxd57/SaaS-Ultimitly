import { understandingEnabled } from "@/lib/ai/semantic/understand";

/**
 * KONUŞMA ÖĞELERİ bayrağı (09-26, kurucu kararları; `docs/TASARIM-2026-09-26-konusma-ogeleri.md`). Yalnız tam "1" açar;
 * varsayılan KAPALI. Kapalıyken anlama katmanının şeması / istemi / önbellek anahtarı, kanal kapısı, uyarı geçişi ve
 * kapanış gizlemesi bayt bayt eskisi. Anlama katmanı kapalıyken (ya da anahtarı yokken) bayrak AÇIK SAYILMAZ: öğeler onun
 * istek listesine dayanır — katmansız öğe kipi uyarı geçişinde "Sorunlu" durumunu kaldırıp cevap geçişinde hiç öğe
 * kuramazdı. Açma = görünürlük dilimi + ücretli ölçüm + örnekli sonuç + kurucu onayı.
 */
export function conversationItemsEnabled(): boolean {
  return process.env.AI_CONVERSATION_ITEMS_ENABLED === "1" && understandingEnabled();
}
