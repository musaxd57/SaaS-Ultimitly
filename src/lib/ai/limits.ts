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
 * HİBRİT RETRIEVAL (RAG dilim 1, 09-09; bayrak `KB_RETRIEVAL_MODE=hybrid`,
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
