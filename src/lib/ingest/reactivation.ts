// ─────────────────────────────────────────────────────────────────────────────
// KANALIN İPTALLİ REZERVASYONU YENİDEN ETKİN GÖSTERMESİ (G9, kurucu kararı 10-13 "Kanal açmasın, iCal aynı").
//
// Yazma servisi (`write-service.ts`) iptal edilmiş satırı kanal anlık görüntüsüyle geri AÇMAZ; bunun yerine bir `reservation.updated`
// olayı bu alan adıyla yazılır (günde en çok bir kez). Dikkat akışı (`incidents/attention.ts`) bu olayı okuyup ev sahibine "kanal bu
// rezervasyonu yeniden etkin gösteriyor — kontrol edin" satırı çıkarır. Sinyal tüketicisi bilinmeyen alan adını yok sayar (yalnız tarih
// alanları sinyal üretir). YAPRAK modül: iki taraf da buradan okur, sağlayıcı importu yok.
// ─────────────────────────────────────────────────────────────────────────────

/** `IngestEvent.changedFieldsJson` içindeki işaret (bir kolon adı değil; olay alanı). */
export const REACTIVATION_BLOCKED_FIELD = "status_reactivation_blocked";

/** Aynı rezervasyon için olay en çok bu sıklıkta yazılır (2 dakikalık senkron her geçişte yazmasın). */
export const REACTIVATION_NOTE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Panel satırı son olaydan bu kadar sonra düşer (kanal artık etkin göstermiyorsa satır kendiliğinden kalkar). */
export const REACTIVATION_ATTENTION_DAYS = 3;
