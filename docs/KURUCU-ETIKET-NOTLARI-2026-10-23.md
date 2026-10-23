# Kurucunun okuyucu etiketleri ve notları — 10-23 (AYNEN)

> Kaynak: etiket sayfası https://claude.ai/artifact/9tGjT8eYyvvdggdkiVEfwQ (veritabanı `labels/<örnek>`), 10-23 08:04–08:51 arası. Kurucu: "NOTLAR ÇOK ÇOK ÖNEMLİ
> DİDİK DİDİK OKU … NOTLARI KAYDET". Notlar **değiştirilmeden** aşağıda; her örneğin misafir mesajı, değerlendirilen soru, nottaki bilgi ve
> gidecek cevap yanında. Notlardan çıkan istekler ve kararlar: `docs/TASARIM-2026-10-23-okuyucu-baglami-anlam-denetimi-etiketleme.md` §3a ve
> `docs/RAPOR-2026-10-23-ogle-okuyucu-anlam-denetimi-ve-etiketler.md`. Örnekler geliştirme setidir (`evals/part-reader-dev.json`), kör sete karışmaz.

Sorular: (1) Cevap sorulanı gerçekten cevaplıyor mu? (2) Cevaptaki bilgi notta yazıyor mu? (3) Eksik ya da yanıltıcı koşul var mı?
(sayfada 10-23 öğle: "Cevap bir koşulu atlıyor ya da yanlış yansıtıyor mu?" olarak yeniden yazıldı — kurucu notu: "BEN BU SORUNU ANLAMADIM").

## 1. `codex-1-bar-cevap-degil`

- Misafir: Havuz kaçta açılıyor?
- Değerlendirilen soru: havuz kaçta açılıyor
- Not: Havuz: Havuz barı 11:00'de açılır. Havuz 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz barı 11:00'de açılıyor.
- Benim beklentim: hold (havuz barı ≠ havuz (cevaplamıyor))
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** havuzun kaçta açıldığını soruyor bu havuz barının açılışını yazıyor hatalı, hostların girdiği kbleri embeddingleyelim otomatik hemen ve rag sistemi gibi dosya bazında tutalım en doğru şekilde embeddingle bu soruları ayırmaz mıyız ki bunu model ayıramıyorsa onunda amk ben o 2sini aynı şey zannediyorsa allah belasını versin zaten fine tunining yapalım kesinlikle bu arada bence bu hata ne aq

## 2. `codex-2-bar-bilgisi-havuza-tasindi`

- Misafir: Havuz kaçta açılıyor?
- Değerlendirilen soru: havuz kaçta açılıyor
- Not: Havuz: Havuz barı 11:00'de açılır. Havuz 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz 11:00'de açılıyor.
- Benim beklentim: hold (barın saati havuza taşındı)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** havuzun kaçta açıldığını soruyor bu havuz barının açılışını yazıyor hatalı, hostların girdiği kbleri embeddingleyelim otomatik hemen ve rag sistemi gibi dosya bazında tutalım en doğru şekilde değerlendirilen soru doğru ama doğru yeri seçmiyor cevabı yani

## 3. `codex-3-bar-sorusu`

- Misafir: Havuz barı kaçta açılıyor?
- Değerlendirilen soru: havuz barı kaçta açılıyor
- Not: Havuz: Havuz barı 11:00'de açılır. Havuz 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz barı 11:00'de açılıyor.
- Benim beklentim: keep (soru + kaynak uyumlu)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 4. `s9-istisna-tek-basina`

- Misafir: Havuz 22:00'ye kadar açık mı?
- Değerlendirilen soru: havuz 22:00'ye kadar açık mı
- Not: Havuz: Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Havuz hafta sonu 23:00'e kadar açık.
- Benim beklentim: hold (kurucu Soru 9)
- **Kurucu:** cevaplıyor mu = Belirsiz · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** günü yazarak çözsün şuan çok baştan savma yazıyor Evet, havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır. yazsa daha iyi

## 5. `s9-genel-ve-istisna`

- Misafir: Havuz 22:00'ye kadar açık mı?
- Değerlendirilen soru: havuz 22:00'ye kadar açık mı
- Not: Havuz: Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açık.
- Benim beklentim: keep (kurucunun uygun cevabı)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** burda çok ufak eksik var cevap vermiyor açıklama yapıyor cevapta versin başta evet diye onun dışında güzel

## 6. `s9-hafta-sonu-soruldu`

- Misafir: Hafta sonu havuz kaçta kapanıyor?
- Değerlendirilen soru: hafta sonu havuz kaçta kapanıyor
- Not: Havuz: Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Hafta sonu havuz 23:00'e kadar açık.
- Benim beklentim: keep (misafir istisnayı sordu)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 7. `s9-onceki-mesaj-cumartesi`

- Önceki konuşma: Cumartesi geliyoruz, iki kişiyiz.
- Misafir: Havuz kaçta kapanıyor?
- Değerlendirilen soru: havuz kaçta kapanıyor
- Not: Havuz: Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Hafta sonu havuz 23:00'e kadar açık.
- Benim beklentim: keep (önceki mesajda gün belirtildi)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 8. `s9-genel-kural-yok`

- Misafir: Havuz kaçta kapanıyor?
- Değerlendirilen soru: havuz kaçta kapanıyor
- Not: Havuz: Hafta sonu havuz 23:00'e kadar açıktır.
- Gidecek cevap: Hafta sonu havuz 23:00'e kadar açık.
- Benim beklentim: keep (kaynakta genel kural yok)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** BAK BURASI ÇOK ÖNEMLİ HANGİ GÜN İÇİN OLDUĞU BELİRSİZ BİR SORU HAFTA SONUNUN BİLGİ VAR GİDECEK CEVAP DOĞRU AMA HAFTA İÇİ İÇİN SORULMA İHTİMALİ DE VAR BURDA MODEL ŞU 3ÜNÜ ÇOK HIZLI ŞEKİLDE YAPMALI : BU SORUYU DİREK EMBEDDİNG VE RAG SİSTEMİ İLE CEVABI BULMAYA ÇALIŞMALI, HOSTUN DAHA ÖNCEKİ CEVAPLARINDAN HEMEN ARAMALI GENELDE DEĞİŞMEZ ONUN BİLGİLERİ EN GÜNCEL VERDİĞİ CEVAP ÇOK BÜYÜK TÜYODUR HEMEN bunu şıklı olarak göstererek hosta onay kısmı için bildirim gider host wpdan da uygulamadanda onayla derse hemen hafta içi bu saate kadar açık diyebilir, ama onun süresi önemli müşteri diyelim dediki hafta için kaçta kapanıyor dedi hemen cevabı alır almaz cevabı göndersin, peki teşşekkürler derse amacına göre bağlama anlama göre gerekli bilgiyi alda denebilir öyle olmazsa cevap geldiği vakit çok süre geçmemişse konu değişmemişse ekstra mesaj gelmemişse bu arada hafta içi havuz bu saate kadar açık gidebilir BU SORU ÇOK İYİYDİ. bu arada o onay yerinde önceden verdiği cevabın saatini yazsın ki değişmemiş olma ihtimali genelde daha yüksektir onaylanırsa bunu kaydetsin aklında bu kısımda bunu bilgi tabanınıza kaydetmek istermisiniz gibi bir soru çıkıyor mu? çıkmıyorsa bence çıkabilir

## 9. `s9-baska-konuda-gun`

- Önceki konuşma: Pazar günü market açık mı?
- Misafir: Bahçe kaça kadar açık?
- Değerlendirilen soru: bahçe kaça kadar açık
- Not: Bahçe: Bahçe 21:00'e kadar açık, cumartesi 23:00'e kadar.
- Gidecek cevap: Cumartesi bahçe 23:00'e kadar açık.
- Benim beklentim: hold (gün başka konuda geçti)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** ÖNCEKİ SORUSUNA YANIT GİTTİMİ YOKSA O SORUYU YUTTU MU ÖYLE OLMAZ DİĞER sorunun bilgisi yoksa normal ama diğer türlü bilgi var host önceden cevaplamışsa üstteki soru için yazdığım gibi. burdada cumartesiyi vermiş BURDA BİLGİ TABANINDAKİ BİLGİ ÇOK KARIŞIK BURDA normalde aslında hafta içi gibi olabilir saat 21.00e kadar açık olmasıda onu nasıl yapabiliriz acaba her host kb girdikten sonra quick böyle kb taraması ile eksik hatalı veya anlaşılması zor şeyler tek tek onay gibi küçük sorular olarak hosta sorulsa mı acaba mesela host ekledi hemen taradık kbyi tamamen  3 tane günlük bu sınır olsun mesela şurda bu şekilde bir bilgi var bunu bu şekilde uygulamamı istermisiniz böyle değiştirmemi onaylıyormusunuz gibi eksiklikleri gidermek hemde kbyi AIın işini kolaylaştırır.

## 10. `s9-istisna-baska-kalemde`

- Misafir: Bahçede 22:00'ye kadar oturabilir miyiz?
- Değerlendirilen soru: bahçe kaça kadar açık
- Not: Bahçe (cumartesi): Cumartesi bahçe 23:00'e kadar açık.
- Not: Bahçe: Bahçe 21:00'e kadar açık.
- Gidecek cevap: Cumartesi bahçe 23:00'e kadar açık.
- Benim beklentim: hold (genel kural öteki kalemde)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Belirsiz · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** mesela üstteki soru için yazdığım notu iyice oku bu arada burda belirsiz karışık ya hemen hosta sorar tarandıktan sonra bunu bahçe cumartesi günü hariç saat 21.00e kadar açık, cumartesi günü 23.00e kadar açık olarak birleştirmemi düzenlememi onaylıyormusunuz diyebilir güzel bir dille açıklamayla artık nasıl en iyisi olursa onaylanırsada hemen o daire için başka daireye dokunmadan değiştirsin yalnız başka daireler içinde aynı bozukluk var diyelim o hostun dairelerinin kblerinde diğer daireler içinde uygulamamı istermisiniz desin kısa bir ön gösterim yapabilir bu bu olarak bu daireler için değiştirildi gibi böyle şık bir görsel oluşabilir sen seç burayı uzun uzun düşün. Onun dışında host direk cumartesiyi soruyorsa zaten cevap doğru olarak verilebilir.

## 11. `evet-hayir-ucret`

- Misafir: Bisiklet ücretsiz mi?
- Değerlendirilen soru: bisiklet ücretsiz mi
- Not: Bisiklet: Bisiklet talep üzerine günlük 200 TL'ye kiralanır.
- Gidecek cevap: Bisiklet ücretsiz değil; talep üzerine günlük 200 TL'ye kiralanıyor.
- Benim beklentim: keep (evet/hayır sorusuna olguyla cevap)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 12. `oteki-soru-yarim-degil-wifi`

- Misafir: Wi-Fi şifresi neydi? Bunu nereden biliyorsun?
- Değerlendirilen soru: wifi şifresi
- Not: Wi-Fi: Ağ Lale-5G, şifre Lale2025!
- Gidecek cevap: Wi-Fi şifresi Lale2025!
- Benim beklentim: keep (öteki soru ayrı istek)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 13. `oteki-soru-yarim-degil-giris`

- Misafir: Giriş saati kaçta? Erken giriş mümkün mü?
- Değerlendirilen soru: giriş saati kaçta
- Not: Check-in saati: 15:00
Check-out saati: 11:00
- Gidecek cevap: Giriş saatimiz 15:00.
- Benim beklentim: keep (erken giriş ayrı istek)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** erken giriş için kontrolleri sana daha önceden yazmıştım bana onları yaz tekrardan kontrolleri durumları hosta giden istek varsa ne zaman gidiyor falan gibi host onay verirse zaten hemen kabul edilebilsin bu arada onay olursa otomatik doğru kabul edilebilir hosttan.

## 14. `yanlis-numara`

- Misafir: Otopark var mı?
- Değerlendirilen soru: otopark var mı
- Not: Otopark: Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır.
- Gidecek cevap: Evet, ücretsiz otopark var; size 7 numaralı yer ayrıldı.
- Benim beklentim: hold (kaynakta 12, parçada 7)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** yanlış cevaplıyor DİREK HATA ZATEN SENDE GÖREBİLİYORSUN 7 YERİNE 12 YAZMALI bu arada burda aynı numarada farklı daireler için varsa hemen kbden farkedilip hosta sorulsun örnek olarak bu 2 daire için aynı otopark numaları var çakışma tehlikesi olabilir hostun cevabına göre sorun yok diyebilir onay falan isteyebilir ama yazılmışsa sorun yok modelde farkında olsun otoparkı kullanan bu dairedeki adamın çıkış tarihine baksın ona özel ID atıyoruz dimi her müşteri için ayrı olarak yoksa sadece isimden mi oluyor bu kısımlarıda bana uzun uzun anlat akışı.

## 15. `dahil-mi-dogru`

- Misafir: Kahvaltı dahil mi?
- Değerlendirilen soru: kahvaltı dahil mi
- Not: Kahvaltı: Kahvaltı fiyata dahil değildir; kişi başı 250 TL.
- Gidecek cevap: Kahvaltı fiyata dahil değil; kişi başı 250 TL.
- Benim beklentim: keep (destekli + cevap)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 16. `ek-olgu`

- Misafir: Kahvaltı dahil mi?
- Değerlendirilen soru: kahvaltı dahil mi
- Not: Kahvaltı: Kahvaltı fiyata dahil değildir; kişi başı 250 TL.
- Gidecek cevap: Kahvaltı fiyata dahil değil; kişi başı 250 TL, çocuklar ücretsiz.
- Benim beklentim: hold (çocuklar ücretsiz kaynakta yok)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** çocuklara ücretsiz falan yazmıyor hatalı

## 17. `e-v3-kaca-kadar-bitis-yeter`

- Misafir: Kahvaltı kaça kadar?
- Değerlendirilen soru: kahvaltı kaça kadar
- Not: Kahvaltı: Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar zemin kattaki kafede verilir.
- Gidecek cevap: Kahvaltı hafta içi 10:30'a, hafta sonu 11:00'e kadar servis ediliyor.
- Benim beklentim: keep (E ölçümü v3 (gerçek akış): 'kaça kadar' sorusuna iki bitiş saati tam cevap; açılış saati sorulmadı)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = Belirsiz · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** hatalı burası kahvaltı kısmı zaten üstlerde soruların notlarına yazdım didik didik bak o notlara kafa yor hatalı bu cvap 2. cümle doğru 1. cümle için hosta hemen soru gider ekledikten sonra kbye o bilgiyi kahvaltı hafa için 8 ile 10.30 arası gibi onaylıyormusunuz diye sorar onaylanırsa öyle kaydeder nasıl kaydedileceğinide göstersin zaten

## 18. `saat-baska-tesise`

- Misafir: Sauna kaça kadar açık?
- Değerlendirilen soru: sauna kaça kadar açık
- Not: Havuz ve sauna: Havuz 20:00'de, sauna 22:00'de kapanır.
- Gidecek cevap: Sauna 20:00'de kapanır.
- Benim beklentim: hold (havuzun saati saunaya)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** 22:00'de kapanır.

## 19. `ayni-konu-cevap-degil-isitma`

- Misafir: Havuz ısıtmalı mı?
- Değerlendirilen soru: havuz ısıtmalı mı
- Not: Havuz: Havuz ısıtmalıdır, 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz 09:00-20:00 arası açık.
- Benim beklentim: hold (ısıtma sorusuna saat)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** havuz ısıtmalı yazıyor ya aq adam onu sormuş onu neden eklememiş Havuzumuz ısıtmalıdır, 09:00-20:00 arası açıktır. yazabilir yalnız çekimlerde iyi ol

## 20. `ayni-konu-cevap-degil-saat`

- Misafir: Havuz kaçta açılıyor?
- Değerlendirilen soru: havuz kaçta açılıyor
- Not: Havuz: Havuz ısıtmalıdır, 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz ısıtmalıdır.
- Benim beklentim: hold (saat sorusuna ısıtma)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** Havuz 09:00-20:00 arası açıktır. yazıcak aq bu cevap ne yerleri mi karıştırdın

## 21. `olumsuz-dogru`

- Misafir: Evcil hayvan kabul ediyor musunuz?
- Değerlendirilen soru: evcil hayvan kabul ediliyor mu
- Not: Evcil hayvan: Evcil hayvan kabul edilmez.
- Gidecek cevap: Evcil hayvan kabul edilmiyor.
- Benim beklentim: keep (olumsuz cevap destekli)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 22. `kosul-dusmus`

- Misafir: Köpeğimle gelebilir miyim?
- Değerlendirilen soru: köpekle gelinebilir mi
- Not: Evcil hayvan: 10 kg altı evcil hayvan kabul edilir, gecelik 100 TL.
- Gidecek cevap: Evet, evcil hayvan kabul ediyoruz.
- Benim beklentim: hold (10 kg + ücret koşulu düştü)
- **Kurucu:** cevaplıyor mu = Kısmen · notta mı = — · koşul eksik / yanlış = —
- **Kurucu notu (aynen):** bu soruya yanıt vermesin ücret geçiyor hosta bıraksın bildirim verip zaten
host kabul etmişse bedavadan bu cevap gidebilir ama 10 kg altı evcil hayvanın kabul edileceği gitsin bu cevap eksik hemde hatalı ki dairelerde köpek için ücret var burda ücreti söylemesin bedava ise host evcil hayvan kabul edilir yazmışsa ve ücret yoksa gidebilir Evet, evcil hayvan kabul ediyoruz. bu cevap onun dışında zaten evcil hayvan getiriyorsa onun için ücret ödüyorlar kiralarken sorulursa host karar versin çoğunlukla.

## 23. `yeniden-ifade`

- Misafir: Çöpü nereye atayım?
- Değerlendirilen soru: çöp nereye atılıyor
- Not: Çöp: Çöpler bina girişinin sağındaki konteynere atılır.
- Gidecek cevap: Çöpleri bina girişinin sağındaki konteynere atabilirsiniz.
- Benim beklentim: keep (yeniden ifade)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 24. `ceviri-en`

- Misafir: What's the wifi password?
- Değerlendirilen soru: wifi şifresi
- Not: Wi-Fi: Ağ Lale-5G, şifre Lale2025.
- Gidecek cevap: The Wi-Fi network is Lale-5G and the password is Lale2025.
- Benim beklentim: keep (çeviri)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## 25. `ceviri-de-tam`

- Misafir: Wann schließt der Pool?
- Değerlendirilen soru: havuz kaçta kapanıyor
- Not: Havuz: Havuz her gün 20:00'de kapanır. Hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Der Pool schließt um 20:00 Uhr, am Wochenende um 23:00 Uhr.
- Benim beklentim: keep (çeviri, genel + istisna)
- **Kurucu:** cevaplıyor mu = Belirsiz · notta mı = Belirsiz · koşul eksik / yanlış = Belirsiz
- **Kurucu notu (aynen):** burda kbde hata var hostun girdiğinde üste girdiğim kurallar geçerli onu hemen kb girilir girilmez tarama ile düzeltmeye çalışsın web sitemiz almanca bilmediğim için cevapta veremiyorum belirsiz dedim o yüzden

## 26. `ceviri-de-bugun`

- Misafir: Wann schließt der Pool?
- Değerlendirilen soru: havuz kaçta kapanıyor
- Not: Havuz: Havuz her gün 20:00'de kapanır. Hafta sonu 23:00'e kadar açıktır.
- Gidecek cevap: Der Pool schließt heute um 20:00 Uhr.
- Benim beklentim: hold ('heute' uydurma + istisna yok)
- **Kurucu:** cevaplıyor mu = Belirsiz · notta mı = Belirsiz · koşul eksik / yanlış = Belirsiz
- **Kurucu notu (aynen):** almanca bilmediğim için cevapta veremiyorum belirsiz dedim o yüzden ing biliyorumda almanca yok bende

## 27. `ek-soz`

- Misafir: Check-out saati kaçta?
- Değerlendirilen soru: çıkış saati kaçta
- Not: Check-in saati: 15:00
Check-out saati: 11:00
- Gidecek cevap: Çıkış saatiniz 11:00; geç çıkış için ev sahibiniz size yardımcı olacaktır.
- Benim beklentim: hold (kaynakta olmayan söz)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** hatalı öğüt veriyor adam geç çıkış bile istememişki yardımcı olucaktır yazmasın hatalı bu BU ARADA BEN Eksik ya da yanıltıcı bir koşul var mı? BEN BU SORUNU ANLAMADIM SORU İÇİN Mİ NOTTA MI O YÜZDEN Bİ GARİP AMA NEYSE ZATEN SANA ÇOK ÇOK AÇIKLADIM

## 28. `yarim-tarif`

- Misafir: Klimayı nasıl soğutmaya alırım?
- Değerlendirilen soru: klima soğutma nasıl açılır
- Not: Klima: Klima kumandası komodinin çekmecesinde; mavi kar tanesi tuşu soğutma.
- Gidecek cevap: Klima kumandası komodinin çekmecesinde.
- Benim beklentim: hold (yarım cevap)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Evet · koşul eksik / yanlış = —
- **Kurucu notu (aynen):** KB de doğru bilgi var salak yazmamış mavi kar tanesi tuşuna basarak soğutma moduna alabilirsiniz yazabilir.

## 29. `olmayan-tesis`

- Misafir: Spor salonunuz var mı?
- Değerlendirilen soru: spor salonu var mı
- Not: Havuz: Havuz 09:00-20:00 arası açıktır.
- Gidecek cevap: Havuz 09:00-20:00 arası açık.
- Benim beklentim: hold (başka tesis)
- **Kurucu:** cevaplıyor mu = Hayır · notta mı = Hayır · koşul eksik / yanlış = Var
- **Kurucu notu (aynen):** soruda ne soruyor o ne yanıtlıyor aq kbde bilgisi yoksa hemen hostun eski mesajları falan üstteki soruların notlarında açıkladım zaten

## 30. `bavul-dogru`

- Misafir: Çıkıştan sonra bavulumu bırakabilir miyim?
- Değerlendirilen soru: çıkıştan sonra bavul bırakılabilir mi
- Not: Bavul: Bavullar çıkıştan sonra 14:00'e kadar resepsiyonda tutulabilir.
- Gidecek cevap: Evet, bavulunuzu 14:00'e kadar resepsiyonda bırakabilirsiniz.
- Benim beklentim: keep (destekli)
- **Kurucu:** cevaplıyor mu = Evet · notta mı = Evet · koşul eksik / yanlış = Yok
- **Kurucu notu (aynen):** —

## Etiketlenmemiş örnekler

`bavul-uydurma-sure`, `ic-istisna-atlanmis`, `opus-g2-parantez-arizali`, `opus-g2-parantez-bayram-ucretli`, `parantez-istisna`
