# Kurucu kararları — karar masası (2026-10-28 akşam), AYNEN

> Kaynak: karar sayfası https://claude.ai/artifact/2tiEwpwVc4r4S5z1aGuV1V (veritabanı `kararlar`). Seçim ve not alanları değiştirilmeden kopyalandı.
> `önerim` = seçilen seçenek Claude'un önerdiği seçenek mi. Notlar kurucunun kendi sözleridir (bağlayıcı).

## R-T1 — Uzun tablo bölününce her parça sütun başlığını taşısın mı? (kodda hazır, kapalı)

- **Seçim:** Açılsın (Railway açılınca KB_TABLE_HEADER=1) (`ac`) · önerim · kaydedildi 2026-10-28T12:17:23.226Z
- **Not (aynen):**

  > evet tek bir test sonucunda mı böyle oldu yoksa genel olarak her  bakış açısından mantıklı bir durum mu ona bak ÖZELLİKLE senin tek 1 test üzerinden mutlak karar vermeden hoşlanmıyorum. dediğin mantıklı ama testleri arttırmanı istiyorum

## R-T2 — İçinde 'kapı / anahtar' geçen paragrafın tamamı 'Giriş Talimatı'na taşınıyor — ne yapalım?

- **Seçim:** Yüklemede size 'bu paragraf Giriş Talimatı'na taşındı, ayıralım mı?' sorulsun + kod taşımayan cümleler sızıntı testleriyle konusuna ayrılsın (`c-b`) · önerim · kaydedildi 2026-10-28T12:20:33.233Z
- **Not (aynen):**

  > BAĞLAM BAĞLAM BAĞLAM, AMAÇ AMAÇ AMAÇ,ANLAM İLİŞKİLERİ,Sözdizimi ve Dil Bilgisi Yapısı (Syntax) ÖNEMLİ en mantıklı yöntemi bul ama tek kelime bazından dolayı direk biryere atamak kesinlikle hatalı

## R-T3 — Anlama ve sıralama katmanları Luna'ya geçsin mi?

- **Seçim:** Anlama + sıralama 5.1'de kalsın, cevap Luna (`5.1-kalsin`) · önerim · kaydedildi 2026-10-28T12:21:22.674Z

## 8-1 — Onaylanan cevap gönderilmeden önce nasıl kontrol edilsin?

- **Seçim:** Kod yalnız durdursun, her gönderimi model onaylasın (üç yeni kural ile) (`C2`) · önerim · kaydedildi 2026-10-28T12:04:05.662Z
- **Not (aynen):**

  > Soru ile onay farklı günlerdeyse ve metinde 'yarın / bugün / bu akşam' varsa düzenleyici açılır:
  > 'Misafir bunu gece yarısından önce sordu; günü kontrol edin.' hosta böyle demesine gerek yokki
  > saat gece 1.de bunu yazıyorsa tabiki yarını niyetliyor aq ve diyelim saat gece 01.00de yazdı o zaman
  > bağlam çok önemli kalır codexe yazdım ondan yardım alıcam bu konu ile ilgili;
  > Ekrandaki Karar
  > 93 zor vakada yanlış gönderimin 14’ten 4’e düşmesi ilerleme. Ancak kalan dört hata arasında başka dairenin cevabı ve değişmiş rezervasyon bilgisi varsa bunlar önemli hata sınıfları. Bu sayılardan canlıdaki hata oranını çıkaramayız.
  >
  > Ben şu anda ikinci seçeneği seçerdim: yeni kuralları görmemiş başka bir kör sette ölçüm. Hedef mimari ise birinci seçeneğin geliştirilmiş hâli olabilir. Aynı testte bulunan hatalara kural ekleyip o testi geçirmek, yeni durumlarda güvenilirliği henüz kanıtlamaz. bak BU ÇOK ÖNEMLİ SAKIN TESTİ GEÇİRMEK İÇİN UFAK ÇAKALLIKLAR DAHİ YAPAMAZSIN. o 2. seçeneği seçerim demiş ben 1.yi seçiyorum yolu uzatmak istemediğim için 1.yi seçelim üstüne stake edelim işlerimizi
  >
  > “Yarın” Nasıl Anlaşılmalı?
  > Senin itirazın doğru: gece yarısı geçti diye her seferinde host’a soru sormak gereksiz. Ama “saat 01.00’de yazdıysa kesin ertesi günü kastediyordur” demek de her konuşmada doğru değil.
  > Durum	Önerdiğim davranış
  > 28 Ekim 23.30’da “Yarın temizlik kaçta?”; doğrulanmış görev 29 Ekim 12.00	Hedef gün 29 Ekim olarak tutulur. Onayın gece yarısını geçmesi bunu değiştirmez.
  > Bu cevap 29 Ekim 00.20’de gönderilecek	Önizlemede “29 Ekim saat 12.00’de…” görünmesi, “yarın”dan daha açık olur.
  > Misafir ilk kez 29 Ekim 01.00’de “Yarın temizlik kaçta yapılacak?” diyor	Normal takvim yorumu 30 Ekimdir; fakat önceki konuşma ve görev kaydıyla çelişiyorsa sistem kesinleştirmez.
  > “Dün sorduğum yarınki temizlik…” diyor	İç içe referans vardır; yalnız son mesajın tarihinden hesaplanmaz.
  > Host gece yarısından sonra kendisi yeni bir mesaj yazıp “Yarın 12’de gelecekler” diyor	Host’un yeni sözü ile eski misafir sorusunun tarihini aynı şey sayamayız. Çelişki varsa hedef tarih netleştirilir.
  > Kuyrukta beklerken temizlik iptal ediliyor	Önceden doğru ve onaylı olan cevap artık gönderilmez.
  >
  >
  > Burada önemli ilke: hedef tarih bir kez kanıta dayanarak çözüldüğünde, mesaj bekledi diye yeniden “yarın” hesabı yapılmamalı. Takvim hesabını kod yapabilir; hangi sözün hangi güne referans verdiğini anlamak modelin işidir.
  >
  > Ayrıca onaylanan metni sonradan sessizce değiştirmemek gerekir. En temiz deneyim, tarih netleştirmesini host’un gördüğü önizlemeden önce yapmak; gerçekten belirsiz kalan durumda yalnız gerekli seçimi sormak.
  >
  > Önerdiğim Akış
  > 1. İstek anlaşılır. Özgün misafir cümlesi korunur; hangi ihtiyaca, hangi konaklamaya ve hangi zamana ait olduğu çıkarılır. Arama için genişletilmiş sorgu, özgün isteğin yerine geçmez.
  > 2. Gerçekler bağlanır. Temizlik saati görev kaydından, mülk bilgisi doğru dairenin onaylı kaynağından gelir. Host’un açıkça verdiği yeni karar da kaynak olabilir; her yeni host bilgisini önce bilgi tabanına yazdırmak gerekmez.
  > 3. Cevap bu gerçeklerden oluşturulur. Model, olmayan temizlik onayı veya yeni bir tarih icat etmez. Her önemli iddianın dayanağı belli olur.
  > 4. Anlam denetlenir. Cevap gerçekten sorulanı cevaplıyor mu, istisnayı atlıyor mu, başka konuyu veya günü mü anlatıyor? Denetleyici yalnız genel bir güven yüzdesi değil, ilgili kaynakları ve kısa karar nedenini döndürür.
  > 5. Host onayı belirli bir sürüme bağlanır. Hangi metin, misafir, rezervasyon, ihtiyaç ve kaynak sürümü onaylandı? “Bu konuşmada bir cevap onaylanmıştı” şeklinde gevşek bir kayıt yeterli olmaz.
  > 6. Gönderimden hemen önce geçerlilik yeniden kontrol edilir. İlgili rezervasyon veya görev değişmişse eski onay körlemesine kullanılmaz. Kuyruktaki metnin, gerçekten onaylanan metin olduğu da kontrol edilir.
  > Bu, bütün bilgileri her seferinde host’a yeniden seçtirmek anlamına gelmiyor. Açık olanı sistem çözsün; yalnız gerçekten eksik veya çelişkili bilgi için host’a dönsün. Yeni gelen “teşekkürler” mesajıyla yeni gelen “tarihimiz değişti” mesajının etkisi aynı olmamalı. codex yazdı
  >
  > Başka Daire Sorunu
  > “Metinde başka dairenin adı varsa durdur” yararlı bir uyarı olabilir; ana güvence olmamalı. Yanlış cevapta daire adı hiç yazmayabilir. Tersine, “Lale 3 binasının önünden sağa dönün” doğru bir yol tarifi olabilir.
  >
  > Esas kontrol, cevaptaki bilginin bağlı olduğu mülk veya ortak alanın bu misafir için geçerli olup olmadığıdır. Başka işletmenin verisinin kullanılmasını modelin onayına bırakmam. Daireler arası ortak otopark gibi meşru ilişkiler de açıkça tanımlanmalı.
  >
  > Fine-Tuning Nerede?
  > Fine-tuning’den kaçınmam. Fakat doğru görevleri seçmek gerekir:
  > Görev	Değerlendirmem
  > “Yarın”, “ertesi gün”, “dün konuştuğumuz” ifadelerinin referansını çözmek	Etiketli, çok turlu örneklerle uzmanlaştırma adayı.
  > Hangi sorunun hangi cevaba bağlı olduğunu anlamak	Güçlü aday; önceki sauna/havuz ve bağımlı soru sorunlarıyla aynı aile.
  > Kaynak cevabı gerçekten destekliyor mu, koşul atlanmış mı?	Uzman denetleyici eğitimi için aday.
  > Doğru bilgiyi doğal ve host’un üslubunda yazmak	Üslup eğitimi adayı; doğruluğun yerine geçmez.
  > Güncel rezervasyonu, ödeme durumunu veya Wi-Fi şifresini hatırlamak	Eğitim ağırlıklarına bırakılmamalı; güncel kayıt veya RAG gerekir.
  > Yetki, alıcı kimliği, sürüm ve çift gönderim kontrolü	Kod ve kalıcı kayıt işi; model kararı bunları aşamaz.

## 8-2 — Araya başka mesaj girdiyse onaylanan cevabın başına ne eklensin?

- **Seçim:** "Bu arada," (`bu-arada`) · önerim · kaydedildi 2026-10-28T12:23:22.867Z
- **Not (aynen):**

  > bu arada yazmayı unutmuşum, eklemeyi unutmuşun diyebilsin hatta genelde onu dese bence daha mantıklı böyle biraz sert oluyor

## 8-3 — Gece onaylanan cevap sabaha ertelensin mi?

- **Seçim:** Evet, 23:00–08:00 arası, öneri 07:30 (`evet-2300-0800-0730`) · önerim · kaydedildi 2026-10-28T12:24:32.872Z

## 8-4a — Misafir arada başka bir şey sordu ve yapay zekâ onu cevapladı. Onaylanan cevap ne olsun?

- **Seçim:** Düzenleyici açılsın, ben bakayım (`duzenleyici`) · önerim DEĞİL · kaydedildi 2026-10-28T12:26:01.727Z
- **Not (aynen):**

  > burda bence bu arada kullanmamlı daha uygun bir şey bulmalıyız onu sanki görmemiş gibi oluyor öyle olmaz bunu düşünelim beraber üsttekilerden birini seçmedim yani.

## 8-4b — Misafir aynı soruyu sitemle tekrarladı. Onaylanan cevap ne olsun?

- **Seçim:** Düzenleyici açılsın (bir şey eklemek isteyebilirim) (`duzenleyici`) · önerim DEĞİL · kaydedildi 2026-10-28T12:36:23.479Z
- **Not (aynen):**

  > host isterse düzenleyebilsin mesajı eklemek istediklerini mesela adeta bir prompt gibi başında özür dile derse özür dilerim kusura bakmayın görmemişim yazabilir ki mesajı gerçekten görmemişse bu arada o 3 platformda airbnb booking vro falan onlarda görüldüler açık mı ve bizim AI kaç saniye sonra görüldü yapıyor mesajı mesela müşteri aynı soruyu tekrarlarsa birazcıkta sinirli gibiyse tonu talebi önceliklendirme yapalım. yalnız aynı soruya 2. görev onay açılmamalı onu unutma. ama kesinlikle model özür dilemeye karar vermesin şuanlık bu kısma sonradan bakalım

## 8-4c — Arada misafirin başka bir isteği de sizi bekliyor. Onaylanan cevap ne olsun?

- **Seçim:** Havuz cevabı şimdi gitsin, geç çıkışa ayrıca bakarım (`ayri-ayri`) · önerim DEĞİL · kaydedildi 2026-10-28T12:44:19.040Z
- **Not (aynen):**

  > Doğrulanmış havuz cevabı hemen gönderilsin. Geç çıkış talebi ayrı bir açık görev olarak takip edilsin. İki cevap aynı anda hazırsa yapay zekâ bunları doğal biçimde birleştirebilsin. ama o diğer soruyu görüpte cevap vermemek sonradan 1 gün sonra bile yazdı diyelim bu arada ile göndermek bok gibi olur belki ondan sonra 15 mesajlık daha konuştular burayı en en iyi şekilde milyarlık olarak nasıl çözeriz 30 dk boyunca sadece düşün fikir üret sen olsan nasıl yaparsın en iyi hatasız ve sürdürüelebilir işe yarar şekilde

## 8-5 — E-postadaki "Bunu gönder" düğmesi doğrudan mı göndersin?

- **Seçim:** Paneli açsın, gönderim orada tek tık (`paneli-acsin`) · önerim · kaydedildi 2026-10-28T12:48:27.257Z
- **Not (aynen):**

  > şimdi doğrudan gönderme uğraştırır ama ilerde böyle bir özellik varsa bunu yapmaya çalışabiliriz. şuanlık paneli açsın tek tık ile gönderim

## R-S1 — Cümleyle bulalım, modele paragrafın tamamını gönderelim mi?

- **Seçim:** Evet (`evet`) · önerim · kaydedildi 2026-10-28T12:51:28.295Z
- **Not (aynen):**

  > salak Havuz 09:00–20:00 arası açık; cumartesi 23:00'e kadar. cümle bozuk aq ingilizcedede sakın hatalı cümle göndertme modeller direk cümleden çevirmede iyi sakın yamuk garip duran cümleler oluşturmamalı bile gitmemeli. Havuz cumartesi günleri hariç  09:00–20:00 arası açık; cumartesi 23:00'e kadar açıktır. yazsın daha yumuşak sıcak oluyor hem böyle sert yazmamalı sen benle nasıl konuşuyorsan öyle modeller bunu iyi yapar zaten muhtemelen

## R-S2 — Her bölüm için "bu bölüm hangi sorulara cevap verir?" listesi üretilsin mi?

- **Seçim:** Evet, yalnız arama için (`evet-yalniz-arama`) · önerim · kaydedildi 2026-10-28T13:24:23.174Z
- **Not (aynen):**

  > model kendi içinde mi depoluycak host görebilecek mi kendisi ekstra soru yazmasın embeddingi oluşturtalım zaten salak mısın o bizim görevimiz soruları göstermesin.

## R-S4 — Uzun belge ölçüm setini kim yazsın?

- **Seçim:** İkisi: geliştirme seti model, kör set ben (`c`) · önerim · kaydedildi 2026-10-28T13:25:50.696Z
- **Not (aynen):**

  > o kadar kredim yok embeddingi direk openAI yapsın işte embedding yapıcaz işte aq ben mi bilmiyorum para olunca lazımsa Cyi yapalımmı?

## R-S5 — Bilgi tabanı taramasına iki yeni uyarı eklensin mi?

- **Seçim:** Yalnız iki dilde farklı değer uyarısı (`yalniz-2`) · önerim DEĞİL · kaydedildi 2026-10-28T13:27:01.015Z
- **Not (aynen):**

  > sadece uyuşmazlıkta olsun ve adamlar türkçe bile girse model ingilizce fransızca rusça cevaplarda hızlı olsun tam doğru şekilde çevirebilsin

## 4.11 — Okuyucu (ikinci yapay zekâ) o an cevap veremezse bir kez yeniden denensin mi?

- **Seçim:** Evet, bir kez yeniden denensin (`evet`) · önerim · kaydedildi 2026-10-28T13:35:42.561Z
- **Not (aynen):**

  > aq okuyucu herşeyi nasıl tutturabiliyor oda garip, süreye falan baksın burayı ben anlamadım okuyucu tam bu arada açıkla

## 4.12 — Modelin genel güveni düşükken kod + okuyucu tarafından doğrulanmış parça gitsin mi?

- **Seçim:** Evet, doğrulanmış parça gitsin (`evet`) · önerim · kaydedildi 2026-10-28T13:36:54.291Z
- **Not (aynen):**

  > cevaplanmayan soru var engelleme sebebi olmasını bilemedim sence mantıklı mı?  o güven artık sistemizde bayatlamaya başladı gibi burda en uzun vadeli gelişmiş sistemi düşünürmüsün

## 4.13 — "Ekstra yatağın gecelik ücreti ne kadar?" yapay zekâ cevaplasın mı?

- **Seçim:** Bilgi tabanında yazan hizmet ücreti cevaplansın (`cevaplansin`) · önerim DEĞİL · kaydedildi 2026-10-28T13:32:50.053Z

## 4.14 — İmzada telefon varken Airbnb ön sorusuna cevap nasıl gitsin?

- **Seçim:** Telefon satırı çıkarılıp cevap gitsin (`telefon-satiri-cikarilsin`) · önerim · kaydedildi 2026-10-28T13:38:19.744Z
- **Not (aynen):**

  > onaylandıktan sonra gidebiliyor mu emin değilim bu arada bence gene yasak olabilir. tabiki onaylanmamışa zaten gidemez airbnb engeller

## 4.15 — Doğrulama kütüphanesi (zod 3 → 4) ne zaman güncellensin?

- **Seçim:** Açılıştan önce (`acilistan-once`) · önerim · kaydedildi 2026-10-28T13:38:40.648Z
- **Not (aynen):**

  > tam bilmiyorum önerin mantıklı gibi açılmadan önce herşeyi halledelim o ayrı güncellemler anlamında
