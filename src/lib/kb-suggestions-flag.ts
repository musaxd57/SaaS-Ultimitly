// ---------------------------------------------------------------------------
// KNOWLEDGE HUB — GEÇMİŞ CEVAP BACAĞI: BAYRAK + SORGU TAVANI (yaprak modül).
//
// ⚠️ NEDEN ROTADA DEĞİL: Next.js bir `route.ts` dosyasından yalnız bilinen rota
// alanlarını (`GET`/`POST`/`dynamic`/…) export etmeye izin verir; başka her
// export `tsc` kapısında "not a valid Route export field" ile patlar. Bu ders
// repoda ZATEN yazılıydı (`chat/[token]/route.ts` yorumu: *"Route dosyasından
// yardımcı export edilemez… bu yüzden kütüphanede durur"*) ve buna rağmen bir
// kez daha takıldım — sabitler baştan yaprak modülde durmalı.
// ---------------------------------------------------------------------------

/**
 * 🚨 GEÇMİŞ BACAĞI VARSAYILAN KAPALI (dış denetim 09-18 + kurucu kararı 09-11).
 *
 * Kart `kb-manager.tsx`ten 09-11'de SÖKÜLDÜ çünkü ürettiği soru↔cevap çiftleri
 * YANLIŞTI. Ama 09-18'de ÖLÇÜLDÜ: **yalnız GÖSTERİM durmuştu.** Rota geçmiş
 * bacağını KOŞULSUZ hesaplayıp sonucu HTTP gövdesiyle tarayıcıya gönderiyordu —
 * üstelik bugün CANLI olan `KbTemplateSuggestions` kartı AYNI rotayı çağırıyor
 * ve yalnız `fromTemplates` okuyor. Yani her "Tara" tıklaması:
 *   · 3.000 satırlık mesaj sorgusunu tetikliyor (şablon bacağının HİÇ İHTİYACI
 *     YOK: şablonlar `messageTemplate` tablosundan geliyor) ve `await` ile SERİ
 *     olduğu için doğrudan kartın açılma süresine biniyordu,
 *   · maskelenmemiş host cevaplarını + iç mesaj kimliklerini tele koyup ATIYORDU.
 * Yazma yolu gerçekten kapalıydı (hiçbir yüzey render etmiyor), ama "hesaplama
 * ve aktarım da durdu" iddiası YANLIŞTI. Kapı artık VERİNİN KENDİSİNDE.
 *
 * Geri açma ön koşulları (CLAUDE.md): ① yakınlık penceresi + araya giren
 * outbound ✅ · ② gösterilen çift GERÇEK çift ✅ · ③ proaktif host mesajı tespiti
 * ✅ (zaman penceresi) · ④ tercihen `Message.replyToMessageId` (migration) ·
 * ⑤ UI `?propertyId=` göndermeli ve `capped` uyarısını göstermeli ·
 * ⑥ UI `sensitiveClasses` doluysa tek tıkla eklemeyi kapatmalı. ④–⑥ AÇIK.
 */
export function kbHistorySuggestionsEnabled(): boolean {
  return process.env.KB_HISTORY_SUGGESTIONS_ENABLED === "1";
}

/**
 * 🚨 SORGU TAVANI. Prod'da ~17.000 mesaj var; tavansız `findMany` bir panel
 * isteğini dakikalara çıkarır. En yeniden geriye doğru okunur, yani tavan
 * "en taze N mesaj" demektir — öneri zaten TAZELİK üzerine kurulu.
 *
 * ⚠️ BİLİNEN SINIR (dış denetim bulgu 5): tarama ORG GENELİDİR, yani yoğun bir
 * mülk tavanı tek başına doldurursa sessiz mülklerden hiç öneri çıkmaz. Bacak
 * KAPALI olduğu için bugün etkisi yok; geri açarken UI mülk filtresi göndermeli
 * ve `capped` bayrağını OKUMALI (geri açma ön koşulu ⑤).
 */
export const HISTORY_MESSAGE_CAP = 3_000;
