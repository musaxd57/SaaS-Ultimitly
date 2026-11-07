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


---
## Gece eklenen kararlar (2026-10-28 ~20:00 UTC, sayfanın veritabanından AYNEN)

## 4-13-b — Misafir 'IBAN gönderin, transferi önceden ödeyeyim' derse transfer fiyatı ayrıca gitsin mi?

- **Seçim:** Tamamı bende kalsın (`tamami-bende`) · önerim · kaydedildi 2026-10-28T19:53:11.203Z
- **Not (aynen):**

  > evet ama şunu merak ediyorum host burda mesajı görmüş gibi saylıyormu AI cevap yazmasa bile sonuçta mesajı okudu ama görüldü okundu olarak işaretletiyor mu uygulamalarda?

## 4-14-b — Airbnb'de ONAYLI konaklamada da imzanın telefon satırı çıkarılsın mı?

- **Seçim:** Airbnb'de her zaman çıkarılsın (`airbnb-hep-cikar`) · önerim · kaydedildi 2026-10-28T19:51:48.623Z
- **Not (aynen):**

  > tam olarak oku neler lazımsa ve hostun numarasını her mesaj için özellikle sorulmadıkça veya platformca engellenme sorunu yoksa 1 kez yazılsın ki imza yerine telefon numarası bırakılması önerilmesin, uyarı bile çıkarttırabiliriz istersen, bence 
  > zaten airbnbde gözüküyorsa numara eminsen gitmesine gerek yok ama emin olman gerek yarım iş istemem airbnbde kesin varsa hostun teli airbnbde her zaman çıkarılabilir

## 8-4c-1 — 8-4c: istek defteri + 'son geçerlilik' + soruya çapalı geç cevap kurulsun mu?

- **Seçim:** Evet, tasarım + gölge ölçümle kuralım (`kuralim`) · önerim · kaydedildi 2026-10-28T19:56:09.330Z
- **Not (aynen):**

  > 1. “Çıkış sabahı geçtiyse gönderme” fazla kaba.
  > Normal çıkış 11.00, misafir hâlâ dairede ve host 11.10’da 13.00’e kadar kalmasını onaylıyor olabilir. Bu onay hâlâ işe yarayabilir. Buna karşılık misafir 10.30’da ayrılmışsa aynı cevap anlamsızlaşır. Geçerlilik; gerçek tarih, konaklama durumu, talebin amacı ve host’un verdiği karar üzerinden belirlenmeli. 
  >
  > 2. Konu değişmesi, isteğin iptali değildir.
  > Misafir geç çıkış sorusundan sonra Wi-Fi hakkında konuşabilir; geç çıkış isteği hâlâ açık olabilir. “15 mesaj geçti” veya “başka konu konuşuldu” tek başına isteği kapatmamalı. Vazgeçme, yanıtlanma, yeni taleple değiştirilme ve sürenin dolması ayrı durumlar olmalı. 
  >
  > Soruyla bağlantılı geç cevap da güzel: “Geç çıkış talebinizle ilgili…” ifadesi, alakasız bir “Bu arada…” başlangıcından daha anlaşılır. Yalnız her cevapta mekanik biçimde kullanılmasına gerek yok.

## G-1 — 'Güven' sayısı yerine ihtiyaç başına kanıt kararı — önce gölge kayıtla başlayalım mı?

- **Seçim:** Evet, önce gölge kayıt (`golge-basla`) · önerim · kaydedildi 2026-10-28T20:06:21.517Z
- **Not (aynen):**

  > Kanıt kaydı özellikle şunları ayırsın: Doğru misafir ve daire mi? Kaynak bu cevabı destekliyor mu? Cevap gerçekten sorulan ihtiyacı karşılıyor mu? Tarih ve koşullar hâlâ geçerli mi? Çelişki veya eksik bilgi var mı? Böylece “okuyucu evet dedi” de yeni bir açıklamasız güven sayısına dönüşmez.
  >
  > Önce gölge kayıtla başlamayı uygun buluyorum; mevcut gönderim davranışı değişmesin. Geçmişte düzeltilmeden gönderilen cevaplar doğrulanmış doğru cevap sayılmasın .  Evet, burada önceki önerim eksikti: bilgi doğru ve güncel olsa bile, cevap artık zamanında veya konuşmaya uygun olmayabilir. Üç gün sonra durduk yere “Havuz 20.00’de kapanıyor” yazmak teknik olarak doğru, müşteri deneyimi açısından kötü olabilir.
  >
  > Küçük bir ayrım da var: görseldeki “3 gün önce onaylı”, kaynağın onay tarihi. Senin söylediğin ise sorunun ne kadar beklediği. Sağlam sistem ikisini ayrı değerlendirmeli.
  >
  > Benim Ana Kararım
  > Üç gün beklemiş sıradan bir bilgi cevabı, yalnız hâlâ doğru olduğu için kendiliğinden gönderilmemeli. Ancak üç gündür açık bir arıza veya iade işi de “artık geç” denerek kapatılmamalı.
  >
  > Bunun için şu üç şeyi birbirinden ayırırdım:
  > - Bilginin geçerliliği: Söyleyeceğimiz şey bugün doğru mu?
  > - İhtiyacın durumu: Misafir bunu hâlâ bekliyor mu; vazgeçti mi, başka taleple değiştirdi mi?
  > - Bu mesajın gönderilebilirliği: Bu cevabı şimdi göndermek hâlâ yararlı ve uygun mu?
  > Bir mesajın gönderim hakkı sona erebilir; misafire karşı açık işimiz devam edebilir. Bence tasarımın merkezinde bu ayrım olmalı.
  >
  > Somut Senaryolar
  > Senaryo	Önerdiğim davranış
  > “Havuz kaçta kapanıyor?” cevabı üç gün gecikmiş; konuya tekrar dönülmemiş	Eski cevabı otomatik gönderme. Gecikmiş ihtiyaç olarak host’a göster; cevaplanmış sayma.
  > Aynı misafir bugün “Havuz saatini öğrenebildiniz mi?” diyor	Yeni mesaj ihtiyacı yeniden doğrular. Güncel bilgiyle cevap hazırlanabilir; eski taslak körlemesine kullanılmaz.
  > Misafir havuzu sormuş, sonra otopark konuşmuş	Otoparka geçmesi havuz sorusundan vazgeçtiğini kanıtlamaz. Ama havuz cevabının süresiz otomatik gönderilebilmesini de sağlamaz.
  > “Bu akşam havuz açık mı?” sorusuna ertesi gün yanıt bulunmuş	Eski soru için “Evet, açık” gönderilmez. İlgili akşam geçmiştir.
  > “İki hafta sonraki girişte otopark kullanabilir miyiz?”; host araştırıp döneceğini söylemiş	Üç gün sonraki yanıt hâlâ beklenen ve yararlı olabilir. Konaklama ve izin güncelse soruya bağlanarak gönderilebilir.
  > “Bugün 13.00’e kadar kalabilir miyiz?”; onay 11.10’da gelmiş, misafir hâlâ konaklıyor	Sırf normal çıkış saati geçti diye engellenmez. İstenen süre ve güncel host kararı değerlendirilir.
  > Aynı onay 14.00’te gelmiş veya misafir ayrılmış	“13.00’e kadar kalabilirsiniz” gönderilmez. Geçmişte kalan izin yeni bir gelecek izni gibi sunulmaz.
  > Klima arızası üç gündür açık	İşi kapatma. Güncel, doğrulanmış bir gelişme varsa yeni durum bildirimi hazırlanabilir; eski “teknisyen gelecek” taslağı gönderilmez.
  > Teknik görev “tamamlandı” olmuş, misafir hâlâ “çalışmıyor” diyor	Son misafir bildirimi göz ardı edilmez. Görev tamamlanması otomatik olarak sorunun giderildiğini kanıtlamaz.
  > İade talebi konaklama bittikten üç gün sonra sonuçlanmış	Çıkış yapılması bu talebi geçersiz kılmaz. Gerçek sonuç bildirilir; ödeme yapılmadıysa yapılmış gibi söylenmez.
  > Host zaten başka mesajında soruyu cevaplamış	Eski bekleyen cevap tekrar gönderilmez. Gerçekten aynı ihtiyacın cevaplandığı doğrulanır.
  > Sistem kesintiden sonra üç günlük kuyruğu açmış	Bütün eski mesajlar birden gönderilmez. Her mesaj güncel durum ve son geçerlilik açısından yeniden değerlendirilir.
  >  sürüm, koşullar ve çelişkiler değerlendirilsin. Kesin güvenlik ve yetki engelleri başka olumlu sinyallerle aşılamasın. Kanıtlar ihtiyaç bazında, eksik ve belirsiz durumları da açıkça gösterecek şekilde tutulsun
  >
  > İki Ayrı Süre
  > Ben ihtiyaç başına iki ayrı zaman sınırı tasarlardım:
  >
  > 1. Otomatik gönderim penceresi: Cevabın, yeni bir host değerlendirmesi gerektirmeden gönderilebileceği dönem. Bu pencere ihtiyacın türüne ve kanala göre belirlenir. Canlı QR sohbetindeki basit bilgi sorusuyla haftalar sonraki konaklama için araştırılan bir istek aynı değildir.
  >
  > 2. İhtiyacın anlamlı kalma sınırı: “Bu akşam”, “yarın girişten önce”, “13.00’e kadar” gibi gerçek olaylara bağlı sınır. Bu geçince eski cevabı yeniden onaylamak, geçmiş olayı yeniden gelecek yapmaz.
  >
  > Üç gün bekleyen rutin bir cevapta benim başlangıç tercihim otomatik gönderim penceresinin açık kalmaması olurdu. Kesin dakika ve saatleri ise ölçmeden evrensel doğru gibi yazmam. Gölge ölçümde hangi sürelerin yararlı cevapları gereksiz tuttuğunu da görmek gerekir.
  >
  > Önemli teknik ayrıntı: Host’un geç onay vermesi veya işçinin yeniden denemesi, sorunun yaşını sıfırlamamalı. Yoksa üç günlük cevap “şimdi onaylandı, yepyeni” diye gönderilir.
  >
  > Model ve Kod
  > Model; yeni mesajın vazgeçme, düzeltme, tekrar sorma veya bağımsız başka konu olup olmadığını anlamalı. Fakat yalnız “bence hâlâ uygun” demesi yeterli olmamalı; hangi ihtiyaç ve hangi mesajlara dayandığı belli olmalı.
  >
  > Kod; alıcıyı, konaklamayı, açık tarihleri, gerekli kaynak sürümlerini, gönderim sınırını ve tekrar güvenliğini korumalı. Geçmişteki 40 doğru gönderim, bugünkü süresi geçmiş cevaba izin vermemeli.
  >
  > Süresi geçen mesajları engellemek için kuyruklarda mesaj ömrü kavramı zaten bulunuyor. Ancak kuyruk süresi tek başına işin anlamını çözmez; uygulamanın kendi son geçerlilik denetimi gerekir. Mevcut veritabanı kuyruğunda da bu ilke uygulanabilir; sırf bunun için başka kuyruk ürününe geçmek gerekmiyor. Microsoft’un açıklaması.
  >
  > Host Nasıl Görmeli?
  > Host’a yalnız “bayat” veya “güven düşük” yazmazdım. Kısa ve somut neden gösterirdim: “Soru üç gün önce soruldu; otomatik gönderim penceresi doldu.” veya “Onaydan sonra çıkış tarihi değişti.”
  >
  > Host hâlâ yararlı buluyorsa güncel önizlemeyi inceleyip gönderebilir. Fakat iptal edilmiş temizlik için eski “ekip gelecek” metni, tek bir düğmeyle doğrulanmış gerçek hâline gelmemeli. Gerekirse bu artık eski cevabı göndermek değil, yeni bir durum mesajı hazırlamak olur.
  >
  > Ayrıca gönderim penceresi dolan ihtiyaç sessizce kaybolmamalı. hosta söylensin  Misafire de otomatik olarak “Sorunuz hâlâ geçerli mi?” gönderilmesini varsayılan yapmazdım; bu da gereksiz yeni mesajlar yaratabilir.  AIımız müşteriye gerekmedikçe soru sormamasını daha çok isterim.
  >
  > Host onayından sonra rezervasyonun değişmesi, işçinin yeniden başlaması ve aynı mesajın tekrar işlenmesi de sınanmalı. Sistem kesintiden dönünce eski cevapları topluca göndermediğinin kanıtı önemli.

---
## Uygulama / cevaplar (10-29 gece)

**4-14-b ✅ (kodda, mutasyon 5/5):** Airbnb'de imzanın telefon / e-posta / bağlantı satırı HER ZAMAN çıkar — AI cevabı, kapanış nezaketi, otomatik
karşılama / giriş / çıkış gönderimi ve önizlemeleri, kuyruğun gönderim anı yeniden kurulumu (tek kaynak `channels/airbnb-message-policy.ts`
`signatureStripsContactFor` / `signatureForChannel`). Airbnb dışı kanalda imza aynen. "Emin olman gerek" şartı: Airbnb'nin kendi yardım
sayfaları onaylı rezervasyonda ev sahibinin numarasının rezervasyon ayrıntılarında ve onay e-postasında misafire gösterildiğini söylüyor
([4116](https://www.airbnb.com/help/article/4116), [147](https://www.airbnb.com/help/article/147)); onaydan önce ve konaklama sonrası göstermiyor
— o pencerelerde zaten çıkarıyorduk ([4155](https://www.airbnb.com/help/article/4155)). Ayarlar'daki imza ipucu artık telefon yazmayı ÖNERMİYOR
("Airbnb mesajlarında imzadaki telefon ve e-posta satırları gönderilmez — Airbnb numaranızı onaylı rezervasyonda misafire kendisi gösterir.").
"Numara bir kez yazılsın" fikri: imzada değil, misafir numarayı sorarsa bilgi tabanındaki iletişim kalemiyle cevap verilir (bugünkü davranış;
Airbnb onaysız konuşmada yine tutulur).

**4-13-b sorusu ("AI cevap yazmasa da mesaj görüldü / okundu işaretleniyor mu?") — kodda ölçüldü:** Lixus sağlayıcıya yalnız iki şey yapıyor:
konuşmayı OKUR (GET `/reservations/{id}/messages`) ve mesaj GÖNDERİR (POST). "Okundu olarak işaretle" çağrısı YOK (`src/lib/hospitable.ts`).
Hospitable'ın API ile okumanın Airbnb'de misafire "okundu" gösterip göstermediğini Hospitable'ın belgelerinde bulamadım; benzer ürünlerden
Hostaway dışarıdaki okundu durumunun eşitlenmediğini yazıyor ([Hostaway](https://support.hostaway.com/hc/en-us/articles/53947756946587-Inbox-Workflow-Management-Efficiency-Tools)),
Guesty Airbnb'de toplu "okundu" işaretinin desteklenmediğini yazıyor ([Guesty](https://help.guesty.com/hc/en-gb/articles/9361442740893-Why-are-Airbnb-messages-archived-or-marked-as-read)).
Airbnb'de okundu bilgisi misafir ve ev sahibi arasında varsayılan açık ve kapatılabiliyor. Kesin cevap için: Railway açılınca bir test
rezervasyonunda misafir hesabından mesaj atılır, Lixus senkronu okur, misafir tarafında "okundu" çıkıp çıkmadığına bakılır — ya da Hospitable
desteğine sorulur. Sonuç ne olursa olsun Lixus tarafında "okundu" işareti göndermiyoruz.

**8-4c-1 + G-1:** tasarım belgesi `docs/TASARIM-2026-10-29-ihtiyac-gecerliligi-ve-kanit-kaydi.md` (bugünkü envanter, eksikler, model, gölge
ölçüm, fazlar; sorular S1 migration · S2 "unuttum" ifadesi ↔ özür yasağı · S3 başlangıç pencere adayları).
