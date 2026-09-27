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
 * GENİŞ BLOK BÜTÇESİ (#189, 09-27; bayrak `KB_RETRIEVAL_WIDE_BUDGET` varsayılan KAPALI — kurucu "hazırla, sonra aç": kredi
 * gelince cevap düzeyinde doğrulanıp açılır). Gerçek müşteri boyutunda (60 kalem, soru başına bilgi tabanı, yeniden
 * sıralayıcısız) en büyük kayıp 6k/12 bütçesiydi: iki sorulu mesajın ikinci cevabı aday listesinde ama bloğa sığmıyordu.
 * Ölçüm (`docs/olcum/rag-lab-2026-09-27*.md`, TR / diğer diller / iki soru): 60 kalemde yeni gömme modeliyle 95/98/71 →
 * 100/99/98, yalnız sözcüksel 93/89/63 → 95/95/83; 276 kalemde ayrı çağrılı yeniden sıralamayla 93/99/86 → 97/100/92. ≤30 kalem / ≤24k bilgi tabanı zaten TAMAMEN (24k'ya kadar) gider;
 * bu değer o tavanı aşmaz. 24.000 değil 23.000: paketleyici (`packKnowledgeBase`) satır başına seçicinin hesabından 1 karakter
 * fazla sayar ve kendi tavanı `KB_CHAR_BUDGET` (24k) — tam 24k seçim son parçayı sessizce "alınmadı" yapabilirdi (40 parça ×
 * 1 karakter payı; 23k ile ölçülen sonuç 24k ile birebir). Yanıtsız soruda blok ortalama ~11 → ~34 parça büyür.
 * PARÇA TAVANI 80 (kurucu 09-27 "80'e çık"; `rag-lab-2026-09-27-9/-10/-11.md`, önbellekten): 40'ta kaçan her cevapta blok 40
 * parçaya dayanmış, karakterin yarısı boş kalmıştı (çok sorgulu seçimde her listeye ~5 yer). 80 ile karakter bütçesi bağlar:
 * 276 kalemde iki soru %93,3 → %96,7, TR %98,0 → %99,1 (9 kazanç, 0 kayıp); 60 kalemde 6 kazanç, 0 kayıp. Yanıtsız soruda
 * bloğa giren parça 32 → 52 — açmadan önce ücretli cevap ölçümü (uydurma artmamalı) + holdout.
 */
export const KB_RETRIEVAL_WIDE_CHAR_BUDGET = 23_000;
export const KB_RETRIEVAL_WIDE_MAX_CHUNKS = 80;
/**
 * Hibritte `kb-fetch`in OKUMA tavanı (seçici bütün onaylı kümeyi görsün; plan
 * tavanı mülk başına 60 kalem). Modele giden miktarı belirleyen bu DEĞİL,
 * yukarıdaki bütçedir. Bayrak kapalıyken kullanılmaz.
 * #189 (09-26 gece): 200 → 400. Gerçekçi 276 kalemlik sette 200 tavanı cevapların %23'ünü OKUMADA düşürüyordu (en eski
 * kalemler seçiciye hiç ulaşmıyordu); 400'de okuma kaybı 0. Maliyet: sorgu + bellek içi dizin (tek sorgu, sayfalama yok).
 * Bugün plan tavanı (mülk başına en çok 60 aktif kalem, kurucu dahil) yüzünden canlıda ETKİSİZ; tavan büyürse hazır.
 */
export const KB_RETRIEVAL_FETCH_CAP = 400;

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
