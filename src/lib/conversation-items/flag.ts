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

/**
 * Aynı mesajda aynı türden ikinci istek AYRI öğe (migration 84 `ordinal`; kurucu 10-23 D) + kısa konu etiketi (`topic`, kurucu C).
 * Yalnız tam "1" açar; varsayılan KAPALI → her mesajda tür başına tek öğe, `ordinal` hep 0, etiket yazılmaz (bayt bayt bugünkü).
 */
export function itemOrdinalEnabled(): boolean {
  return process.env.AI_ITEM_ORDINAL_ENABLED === "1";
}

