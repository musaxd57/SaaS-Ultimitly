# Kurucunun karar masası notlarına açıklamalar ve tasarım düşünceleri (2026-10-28 akşam)

> Kaynak: kurucunun 19 kararı aynen `docs/KURUCU-KARARLARI-2026-10-28-karar-masasi.md`. Bu belge yalnız AÇIKLAMA ve TASARIM; müşteriye
> giden davranışı değiştiren her öneri ayrıca soru olarak işaretlendi (SORMADAN SİSTEM KURULMAZ). Kodda bugün yapılanlar §8'de.

---

## 1. Okuyucu nedir, "her şeyi nasıl tutturuyor", süre (4.11 notu)

Kurucu notu (aynen): "okuyucu herşeyi nasıl tutturabiliyor oda garip, süreye falan baksın burayı ben anlamadım okuyucu tam bu arada açıkla".

**Okuyucu her şeyi tutturmuyor ve tutturması da gerekmiyor.** Okuyucu (kodda "parça okuyucusu", `src/lib/ai/semantic/part-reader.ts`) ikinci bir
yapay zekâ çağrısıdır ama yetkisi tek yönlüdür: **yalnız TUTAR, hiçbir şey eklemez, hiçbir şeyi "gönder" diye zorlayamaz.** Akış şöyle:

1. Cevap modeli misafirin her ihtiyacı için ayrı bir "parça" yazar ve her parçanın bilgi tabanındaki dayanağını (alıntısını) verir.
2. **Kod** her parçayı denetler: alıntı bilgi tabanında gerçekten var mı, parçadaki değer (saat, fiyat, kod) alıntıdakiyle aynı mı, konu aynı
   mı, "hariç / yalnız / cumartesi" gibi koşul düşmüş mü, olumsuzluk ters çevrilmiş mi. Kodun reddettiği parça gitmez.
3. Koddan geçen parçalar okuyucuya gider. Okuyucu her parça için beş soruya cevap verir: sorulanı cevaplıyor mu · notlarda yazıyor mu ·
   doğru şeye bağlı mı · tek başına bir istisnayı mı anlatıyor · yarım mı. **Herhangi bir "hayır / emin değilim" o parçayı tutar.**
4. Okuyucu düşerse (cevap vermezse, bozuk cevap verirse, bir parçaya hüküm vermezse) **bütün parçalar tutulur.**

Yani okuyucu yanılırsa iki yönden biri olur: (a) doğru bir parçayı gereksiz tutar → misafire bir şey gitmez, ev sahibine kalır (güvenli
yön); (b) yanlış bir parçaya "evet" der → ama o parça zaten kodun değer / konu / koşul denetiminden geçmiştir; okuyucu ikinci kemerdir.
Tek başına "her şeyi bilen" bir yargıç değil, kodun arkasındaki ikinci kontrol. Ölçülen hatası: 10-23 kör setlerde okuyucu açıkken yanlış
gönderim 0–1, gereksiz tutma ise okuyucunun en büyük maliyeti.

**Süre:** okuyucu tur başına yaklaşık 1,5–2 sn ekliyor (10-23 ölçümü, tur ortalaması okuyucu açık 10,7 sn / kapalı 8,5 sn). Okuyucunun
kendi tavanı anlam katmanı tavanıdır: düşünen modelde 12 sn, düşünmeyen modelde 6 sn (`AI_SEMANTIC_TIMEOUT_MS` ile ayarlanır, en çok 20 sn).

**Bugün kodlanan (4.11 "bir kez yeniden denensin"):** okuyucu GEÇİCİ bir hata alırsa (ağ kopması, hız sınırı 429, sunucu hatası 5xx) bir kez
yeniden dener. Sizin "süreye baksın" notunuz için kural: **toplam bekleme tek çağrının tavanını aşmaz.** İkinci deneme, ilk denemeden kalan
süreyle koşar; ilk hata yavaş geldiyse (tavanın yarısından fazlası geçtiyse) hiç denenmez — sağlayıcı zorlanıyordur, kısa ikinci deneme de
yetişmez. Zaman aşımı, kota bitmesi, anahtar reddi, bozuk / kesik cevap yeniden denenmez (biri düzelmez, öteki beklemeyi ikiye katlardı).
Örnek: okuyucu 0,3 sn'de "503" döndü → 1 sn bekle → kalan ~10,7 sn içinde ikinci deneme → "doğru" derse "Site restoranı diğer aylarda
12:00–21:00 arasında açık." gider. Okuyucunun hükmü değişmez; yalnız düşen çağrı bir kez tekrarlanır.

---

## 2. "Güven" bayatladı — uzun vadeli sistem (4.12 notu)

Kurucu notu: "cevaplanmayan soru var engelleme sebebi olmasını bilemedim sence mantıklı mı? o güven artık sistemimizde bayatlamaya başladı
gibi burda en uzun vadeli gelişmiş sistemi düşünürmüsün".

**Haklısınız: tek bir "genel güven" sayısı artık yanlış soyutlama.** Model cevabın bütününe 0–1 arası bir sayı veriyor; bu sayı (a) kalibre
değil (model "0,72" dediğinde gerçekte %72 doğru demek değil), (b) cevaplanamayan öteki sorudan düşüyor (bisiklet şifresi doğru ama kuaför
yok → 0,72 → hiçbir şey gitmiyor), (c) neden düştüğünü söylemiyor. Bugün sistemimizin asıl güvencesi zaten başka yerde: kodun parça
denetimi, okuyucunun hükmü, risk / acil / şikâyet kapıları.

**Bugün kodlanan (kararınız "evet"):** parça kipinde giden metin yalnız doğrulanmış parçalardan oluşuyorsa genel güven tek başına durdurmaz.
Kesilmiş cevap, şeması bozuk cevap, risk / şikâyet / acil, "bilgim yok", dil, Airbnb ve öteki bütün kapılar aynen önde. Güven sayısı kayıtta
değişmeden durur (ölçüm için).

**Uzun vadeli öneri — "ihtiyaç başına kanıt kararı":** tek sayı yerine her ihtiyaç (parça) için kanıt alanları:

| Alan | Kim üretir | Örnek |
|---|---|---|
| dayanak bulundu mu, değer / konu / koşul tuttu mu | kod (deterministik) | "kahvaltı 08:00–10:30" alıntıyla birebir |
| sorulanı cevaplıyor mu, istisna / yarım mı | okuyucu (model) | "evet" + alıntı |
| kaynak ne kadar taze / kim yazdı / onaylı mı | kod (bilgi tabanı kaydı) | ev sahibi 3 gün önce onayladı |
| bu mülkte bu konu geçmişte ne kadar doğru gitti | kalıcı kayıt (ev sahibi düzeltmeleri) | "otopark" cevapları 40/40 düzeltilmeden gitti |
| konu riski | kod (tür tablosu) | Wi-Fi düşük, giriş kodu yüksek, para yüksek |

Karar bir **politika tablosu** olur (sayı değil): "kod tuttu + okuyucu evet + kaynak onaylı + konu düşük risk → gider"; "kaynak 180 günden
eski → ev sahibine sor"; "bu mülkte bu konuda son 30 günde ev sahibi 2 kez düzeltti → tut". Modelin kendi güveni yalnız tanı sinyali
olarak kayıtta kalır. Kalibrasyon: ev sahibinin onayladığı / düzelttiği her cevap etikettir; ayda bir hangi kanıt bileşimi ne kadar doğru
gitti ölçülür. Bu, geçmişten öğrenme (L1) ve doğrulanmış cevap önbelleği (migration 85 gölge) ile aynı veriyi kullanır — yeni tablo
gerektirebilir (migration → ayrıca onay). **Soru (G-1):** Bu yönde tasarım belgesi + gölge ölçümle başlayalım mı (önce yalnız kayıt, karar
değişmez)?

---

## 3. 8-4c — Arada başka bir istek de bekliyorken (derin düşünce)

Kurucu notu (özet): doğrulanmış havuz cevabı hemen gitsin, geç çıkış ayrı açık görev; ikisi aynı anda hazırsa doğal birleşsin; ama 1 gün
sonra, 15 mesaj sonra "bu arada" ile göndermek çok kötü olur; "milyarlık" şekilde nasıl çözülür.

**Kök sorun:** bir cevabın "doğru" olması yetmez; **o anda hâlâ söylenmesi gereken şey** olması gerekir. Onay ile gönderim arasındaki
zamanda konuşma değişir. Büyük ürünler (destek masaları, e-posta istemcilerinin "geç yanıt" uyarıları) bunu tek bir kuralla değil,
**isteğin kendi yaşam döngüsüyle** çözer. Önerdiğim yapı:

1. **İstek defteri (zaten tasarımda, 10-22 Soru 1):** her ihtiyacın kimliği, durumu (açık / cevaplandı / geçersiz / ev sahibinde),
   **son geçerlilik anı** (geç çıkış: çıkış gününün sabahı; havuz saati: konaklama sonuna kadar; "bu akşam restoran": o akşam 21:00) ve
   **bağlamı** (hangi mesajlarla ilişkili).
2. **Gönderim anında yeniden okunan tazelik:** onaylı cevap kuyruğa girer ama gönderilmeden önce defterden şu üç şey okunur — ihtiyaç hâlâ
   açık mı (misafir vazgeçmedi, başkası cevaplamadı), son geçerlilik geçmedi mi, konuşma o konudan **kopmadı** mı (arada aynı konuda yeni
   bilgi / soru yok). Üçü de tamamsa gider; değilse ev sahibine "bu cevap artık bayat" diye döner (sessizce gitmez).
3. **Geç cevabın dili "bu arada" değil, sorunun kendisine çapa:** cevap aradan uzun süre / çok mesaj sonra gidecekse metnin başına kod,
   misafirin kendi sorusunu hatırlatan kısa bir çapa koyar: "Geç çıkış sorunuzla ilgili: ..." / "About your late check-out question: ...".
   Bu, "görmezden geldik" hissi vermez, neyin cevaplandığını netleştirir. Kısa aralıkta (aynı konu, birkaç mesaj) çapaya gerek yok.
4. **Birleştirme:** iki ihtiyacın cevabı aynı anda hazırsa (havuz doğrulandı + ev sahibi geç çıkışı onayladı) tek mesajda, misafirin
   soruş sırasıyla gider; birleştirmeyi model yazar ama içerik yalnız doğrulanmış parçalar + ev sahibinin onayladığı metin olur.
5. **Önceliklendirme:** son geçerliliği yakın olan ihtiyaç (yarın sabah çıkış → geç çıkış sorusu) ev sahibine öne çıkar, panelde süre sayacı.
6. **Kodla / modelle ayrım:** süre, sıra, tazelik ve bayatlık KOD; "bu yeni mesaj o konuyu değiştiriyor mu" ve doğal birleştirme MODEL.

Örnek (önce / sonra):
- **Bugün:** 14:00 "Havuz kaçta kapanıyor? Bir de geç çıkış mümkün mü?" → havuz cevabı ev sahibi onayı bekliyor; ertesi gün 15 mesaj sonra
  "Bu arada, havuz 20:00'de kapanıyor." gider.
- **Öneri:** havuz cevabı 14:00'te hemen gider; geç çıkış ayrı açık görev (çıkış sabahına kadar sayaç). Ev sahibi ertesi gün geç çıkışı
  onaylarsa ve arada konu kopmuşsa: "Geç çıkış sorunuzla ilgili: 13:00'e kadar kalabilirsiniz." Çıkış sabahı geçtiyse gitmez, ev sahibine
  "artık bayat" uyarısı.

**Soru (8-4c-1):** Bu yapıyı (istek defteri + son geçerlilik + çapalı geç cevap) tasarım belgesi ve önce gölge ölçümle kuralım mı?
Migration gerektirir (son geçerlilik alanı).

---

## 4. 8-1 C2 ilkeleri — uygulama planı (Codex akışı 1–6 + sizin notunuz)

Kararınız C2: kod yalnız durdursun, her gönderimi model onaylasın, üç yeni kural. Notunuzdaki ilkeler ve kodlama sırası:

1. **Hedef tarih bir kez, kanıtla çözülür.** "Yarın" misafirin yazdığı ana göre (gece 01:00'de yazdıysa ertesi gün niyeti; ama önceki konuşma
   / görev kaydı çelişiyorsa kesinleştirilmez). Çözülen tarih onay kaydına yazılır; mesaj kuyrukta bekledi diye yeniden hesaplanmaz.
2. **Önizlemede mutlak tarih:** ev sahibi "yarın" değil "29 Ekim saat 12:00" görür. Ev sahibine "gece yarısını kontrol edin" uyarısı
   GÖSTERİLMEZ (notunuz: "hosta böyle demesine gerek yok") — belirsizlik varsa yalnız gerekli seçim sorulur.
3. **Onay bir sürüme bağlıdır:** onaylanan metin + misafir + rezervasyon + ihtiyaç + kaynak sürümü özetlenip kaydedilir.
4. **Gönderimden hemen önce yeniden doğrulama:** rezervasyon / görev değiştiyse eski onay kullanılmaz; kuyruktaki metin onaylanan metinle
   birebir mi denetlenir.
5. **Başka daire:** "metinde başka dairenin adı" yalnız uyarı; asıl güvence cevaptaki bilginin bağlı olduğu mülkün bu misafirin mülkü
   olması (kaynak-mülk bağı). Ortak otopark gibi meşru paylaşımlar açıkça tanımlanır.
6. **Fine-tuning adayları:** göreli zaman çözme, soru–cevap bağı, kaynak destekliyor mu, üslup. Rezervasyon / şifre gibi güncel bilgiler
   ve yetki / sürüm / çift gönderim asla modele bırakılmaz. ⚠️ OpenAI ince ayar API'si bugün `training_not_available` dönüyor (siz
   OpenAI'ye yazdınız; cevap gelince yeniden bakılır).

Sizin seçiminiz "1. yolu seçiyorum, yolu uzatmayalım, üstüne stake edelim": kurallar kodlanır, yeni kör setle ölçülür; **testi geçirmek
için ufak çakallık yok** — kör set ayarda kullanılmaz, yeni hatalar kurala değil sebebine göre çözülür.

---

## 5. R-T2 — Bağlamla erişim ayrımı (kelimeyle değil)

Kurucu notu: "BAĞLAM BAĞLAM BAĞLAM, AMAÇ AMAÇ AMAÇ, ANLAM İLİŞKİLERİ, Sözdizimi ... tek kelime bazından dolayı direk bir yere atamak kesinlikle
hatalı".

Bugünkü sorun: içinde "kapı / anahtar" geçen paragrafın tamamı "Giriş Talimatı"na (rezervasyon öncesi ve QR'da görünmeyen kategori)
taşınıyor; "Kapının önünde bisiklet park yeri var" gibi zararsız cümle de gizleniyor. Önerilen yöntem (yükleme anında, canlı yolda değil):

1. **Cümleyi işlevine göre sınıfla:** (a) erişim SIRRI veriyor mu (kod, şifre, anahtar kutusu yeri + açılış adımı) · (b) erişim nasıl
   yapılır anlatıyor ama sır yok · (c) genel bilgi. Bunu model yapar (cümlenin amacı ve ilişkileri), kelime değil.
2. **Kod sınır koyar:** sır DEĞERİ (rakam dizisi, şifre biçimi) bir erişim nesnesine (kapı, kutu, kilit, Wi-Fi) bağlı cümle hiçbir zaman açık
   kategoriye gitmez — model "genel" dese bile. Model yalnız "zararsız" cümleyi serbest bırakmayı önerebilir; sırrı serbest bırakamaz.
3. **Ev sahibine sorulur (kararınız c-b):** "Bu paragraf Giriş Talimatı'na taşındı, şu iki cümleyi ayrı konuya ayıralım mı?" — tek tık.
4. **Sızıntı testleri:** her dilde "Kod 4821, kutu kapının solunda" türü cümle asla açık kategoriye gitmez (iki yönlü pin + mutasyon).

---

## 6. 8-4b — Sitemle tekrarlanan soru (fikirler)

Notunuzdan alınanlar: aynı soru için ikinci görev / onay AÇILMAZ (birleşir); sinirli tekrar önceliği yükseltir; ev sahibi düzenleyicide
bir talimat yazabilir ("başına özür ekle") ama **model kendiliğinden özür dilemeye karar vermez**; platformların "görüldü" bilgisi
araştırılacak (Airbnb / Booking / VRBO'da okundu bilgisi API'de var mı, bizim sistem mesajı ne zaman "okundu" yapıyor) — bu kısım
sonraya. Bugün kodda bir değişiklik yapılmadı.

---

## 7. 4.14 notu — onaydan sonra telefon serbest mi?

Notunuz: "onaylandıktan sonra gidebiliyor mu emin değilim bu arada bence gene yasak olabilir".

Araştırma (bu ortamdan Airbnb'nin kendi sayfası açılamadı; arama sonuçlarındaki Airbnb yardım metinleri + ikinci el kaynaklar):
- Airbnb yardım 4155 / 147: misafirin ve ev sahibinin telefonu **yalnız rezervasyon onaylanınca** görünür, iptalde kaybolur; onaydan önce
  platform dışına çağırmak kural ihlali. Onaydan sonra numara paylaşımı genel olarak serbest, ama Airbnb mesajlaşmayı ana kanal olarak ister.
- Airbnb yardım 4169: **20 Kasım 2026 ve sonrası yapılan rezervasyonlar için güncellenmiş bir politika** var (ikinci el özetler: onaydan sonra
  misafir isterse / kabul ederse başka kanala geçilebilir, misafiri belirli bir uygulamaya zorlamak yasak). Tam metni okuyamadım.
- **Önemli:** Airbnb onaylı rezervasyonda numaranızı misafire zaten gösteriyor. Yani imzadaki numara onaylı konaklamada da bir şey
  kazandırmıyor, yalnız risk taşıyor.

**Soru (4.14-b):** Airbnb'de onaylı konaklamada da imzanın telefon satırı çıkarılsın mı? Örnek — "Wi-Fi şifresi ne?" (onaylı konaklama):
bugün "Ağ: Lale-5G, şifre Lale2025.\n\nSevgiler, Ali\n📞 +90 532 …" gider; öneri "…\n\nSevgiler, Ali". Booking / doğrudan kanalda imza tam kalır.

---

## 8. Bugün kodda yapılanlar (kısa liste; ayrıntı commit mesajlarında)

| Karar | Ne yapıldı | Anahtar |
|---|---|---|
| 4.11 | okuyucu geçici hatada bir kez yeniden dener, toplam süre tek çağrı tavanını aşmaz | anahtarsız (okuyucunun kendisi kapalı) |
| 4.12 | parça kipinde doğrulanmış parça genel güvene takılmaz | parça kipi anahtarı (kapalı) |
| 4.13 | hizmet ücreti sorusu "ödeme" sayılmaz (anlama eki) + okuyucu "yalnız fiyat söylemek ödeme değil" satırı | `AI_KB_FEE_RULE_ENABLED` (kapalı) |
| 4.14 | onaysız Airbnb konuşmasında imzanın telefon / e-posta / bağlantı satırı çıkar, cevap gider | anahtarsız |
| ölçümle bulunan | kısa Almanca / Fransızca soruya Türkçe gövdeli cevap gidiyordu → kod emin değilken modelin bildirdiği dil ölçüt | anahtarsız (yalnız daha çok tutar) |
