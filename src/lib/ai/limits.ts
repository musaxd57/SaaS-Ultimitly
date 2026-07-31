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
