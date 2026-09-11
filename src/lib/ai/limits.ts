// ---------------------------------------------------------------------------
// AI İSTEM TAVANLARI — YAPRAK MODÜL (bilerek bağımlılıksız).
//
// ⚠️ NEDEN AYRI BİR DOSYA: bu sayılar hem sunucuda (istem kurulurken) hem de
// TARAYICIDA (Bilgi Tabanı ekranındaki "AI en fazla N kalem okur" uyarısı)
// gerekiyor. Sabitler `prompts.ts` içinde durduğu sürece o uyarıyı gösteren
// `"use client"` bileşeni 75 KB'lık `prompts.ts`'i import etmek zorunda kalıyordu
// — yani sistem promptunun tamamı, 20+ eğitim örneği ve TÜM güvenlik/kaçınma
// talimatları tarayıcıya giden paketin bağımlılık grafiğine giriyordu.
//
// Depo tam da bu dosya yüzünden PRIVATE yapıldı ("yayınlanmış kara liste =
// kaçınma haritası"). Paketleyicinin bu saf `const`'ları eleyip elemediği ancak
// üretim çıktısına bakılarak doğrulanabilir; o varsayıma güvenmek yerine zincir
// tamamen koparıldı. `prompts.ts` artık `server-only` ile mühürlü, yani biri
// aynı hatayı tekrar yapmaya kalkarsa BUILD kırılır — sessizce sızmaz.
// ---------------------------------------------------------------------------

/**
 * AI'nın tek seferde okuyabileceği bilgi tabanı kalemi sayısı. Sorgular bununla
 * sınırlanır (`ai/kb-fetch.ts`); host'a görünen uyarı da bu sayıyı kullanır —
 * tek kaynak olsun ki "AI N kalem kullanır" iddiası hep doğru kalsın.
 */
export const KB_ITEM_CAP = 30;

/**
 * Bilgi tabanı bloğunun KARAKTER bütçesi. Adet tavanı tek başına maliyeti
 * SINIRLAMAZ: tek bir kalem 20.000 karaktere kadar çıkabildiği için (validators)
 * 30 kalem hâlâ 600.000 karakter demektir. İstem boyutunun üst sınırını çizen şey
 * budur; sistem istemi ~75KB ve önbelleklidir, şişen kısım hep bu bloktur.
 */
export const KB_CHAR_BUDGET = 24_000;

/**
 * HİBRİT RETRIEVAL (RAG dilim 1, 09-09; 🚨 09-11'den beri VARSAYILAN AÇIK —
 * `KB_RETRIEVAL_MODE` artık bir ACİL DURDURMA düğmesidir, açma düğmesi değil,
 * VARSAYILAN KAPALI). Soruya göre seçilen parçaların karakter bütçesi ve parça
 * tavanı. Legacy bütçenin (24k) çok altında olması BİLİNÇLİ: retrieval'ın
 * varlık sebebi daha az ve daha ilgili bağlam. Bilgi tabanı bu bütçeye ZATEN
 * sığıyorsa seçim yapılmaz, tamamı gider (`select.ts` "small_kb").
 */
export const KB_RETRIEVAL_CHAR_BUDGET = 6_000;
export const KB_RETRIEVAL_MAX_CHUNKS = 12;
/**
 * Hibritte `kb-fetch`in OKUMA tavanı (seçici bütün onaylı kümeyi görsün; plan
 * tavanı mülk başına 60 kalem). Modele giden miktarı belirleyen bu DEĞİL,
 * yukarıdaki bütçedir. Bayrak kapalıyken kullanılmaz.
 */
export const KB_RETRIEVAL_FETCH_CAP = 200;

/* ---------------------------------------------------------------------------
 * KONUŞMA GEÇMİŞİ PENCERESİ (kurucu, 2026-09-11: "context windowmuz iyi olsun
 * normal airbnb sohbetlerindede qr sohbetlerindede kaç cümle eskiye kadar
 * görebiliyor").
 *
 * 🚨 ÖLÇÜLEN DARBOĞAZ: `prompts.ts` geçmişi ÇIPLAK `.slice(-6)` ile kesiyordu
 * ve GEREKÇESİ HİÇBİR YERDE YAZMIYORDU. Yukarı akışta üç yüzeyin üçü de çok
 * daha fazlasını taşıyor — oto-yanıt ve inbox öneri konuşmanın TAMAMINI
 * (tavan yok), QR ise özenle kurulmuş 24 mesaj / 8.000 karakterlik bir pencere
 * (`guest-chat.ts buildGuestChatContextWindow`). Yani QR'ın penceresi mesaj
 * sayısı bakımından ÖLÜYDÜ: 7.–24. mesajlar burada atılıyordu ve o kodun kendi
 * gerekçesi ("eski 12'lik tavan ≈6 tur taşıyordu, yetersizdi") uygulanmıyordu.
 *
 * Tavan 25, bütçe 6.000 karakter — CLAUDE.md'nin kendi gereksinimi ("tavan 25,
 * hedef ~10–12"). Mekanik `-6 → -25` YAPILMADI: sayı değil BÜTÇE karar verir,
 * çünkü tek bir 4.000 karakterlik mesaj 25 kısa mesajdan pahalıdır.
 * ------------------------------------------------------------------------- */
/** İsteme giren geçmiş mesaj sayısının MUTLAK tavanı. */
export const HISTORY_MESSAGE_CAP = 25;
/** Geçmiş bloğunun karakter bütçesi (güvenlik penceresi bunu AŞABİLİR). */
export const HISTORY_CHAR_BUDGET = 6_000;
