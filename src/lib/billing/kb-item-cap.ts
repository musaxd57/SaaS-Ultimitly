// Yaprak modül (hiçbir şey import etmez): plan sınırları (`plan-limits.ts`, veritabanına bağlı) ve dosyadan içe aktarma çekirdeği
// (`kb-import/document.ts`, saf) AYNI sayıyı okusun diye burada (Opus 10-23 akşam KB incelemesi R4: içe aktarma 20.000'lik kendi tavanını
// kullanıyordu, kayıt yolu 3.000'de reddediyordu — 3.001–20.000 karakterlik her taslak 400 alırdı).

/**
 * TEK bir kaydın karakter tavanı — plana göre DEĞİŞMEZ, bilerek.
 *
 * Sebebi: kayıt sayısını sınırlarsan, kullanıcı her şeyi tek kayda doldurup
 * sınırı anlamsız kılabilir ("giriş mesajına hepsini yazarım"). Bu tavan o kaçışı
 * kapatır. Plana bağlamak yerine sabit tutuyoruz çünkü amacı ayrıştırma değil,
 * sayı-sınırının delinmesini engellemek. Ayrışma zaten KAYIT SAYISINDA.
 *
 * 3.000 karakter ≈ 420 Türkçe kelime. BOŞLUKLAR DA SAYILIR (`.length`). Hazır
 * şablonlarımızın en uzunu ~300 karakter, yani 10 kat pay var — meşru hiçbir
 * kaydı kesmez. Önceki değer 20.000'di; tek bir kayıtla AI istemini şişirmeye
 * fazlasıyla yetiyordu. (Kısaca 2.000 denendi, kullanıcı 3.000'e döndürdü:
 * "ne olur ne olmaz", ve 420 kelimeden uzun bir bilgi kaydı pratikte yazılmıyor.)
 */
export const KB_CHARS_PER_ITEM = 3_000;
