# 05-yerel-rakipler

> Soru: Türkiye'de yerli otel / pansiyon / kısa dönem kiralama yazılımları ve kanal yöneticileri (HotelRunner, Elektraweb, Sirius, Odamax, Reseliva, diğerleri) — kısa dönem kiralama ev sahiplerine sundukları, AI mesajlaşma özellikleri, fiyatları, pazar payı tahminleri.

# Türkiye'de yerli otel/pansiyon/kısa dönem kiralama yazılımları ve kanal yöneticileri

**Önemli sınırlama:** Arama aracı kotası ikinci turda doldu. Bu yüzden Sirius, Odamax'ın yazılım tarafı, Elektraweb'in AI özellikleri ve pazar payı için ek doğrulama yapamadım. Bu konularda "kaynak bulunamadı" yazdım. Sayfa tarihleri, arama motorunun verdiği "sayfa yaşı" bilgisine dayanır ve yaklaşıktır.

## Özet

- **HotelRunner** bu listedeki en geniş ürün ailesine sahip yerli oyuncu. Kısa dönem kiralama için ayrı bir "Vacation Rentals" çözümü var. Airbnb, Booking.com ve VRBO dahil 150'den fazla kanala bağlanıyor.
- **HotelRunner fiyatı:** Güncel resmi fiyat sayfasında hibrit model var. Oda sayısı sınırsız, aylık minimum ücret 19,95–39,95 USD, üstüne ciro yüzdesi ekleniyor. Capterra'daki 9,95 USD/ay başlangıç fiyatı resmi sayfayla uyuşmuyor, eski olabilir.
- **AI mesajlaşma:** HotelRunner'ın kendi sayfalarında doğrulayabildiğim AI ürünü **Review Center**. Bu ürün yorumlara AI ile yanıt üretiyor, misafir mesajlaşma botu değil. WhatsApp, telefon ve Instagram'dan yanıt veren çözüm üçüncü taraf bir ürün: Heyhotel AI, HotelRunner ile entegre çalışıyor.
- **Reseliva** en şeffaf fiyatı veriyor: kanal başı ücret yok, komisyon yok, bağlayıcı sözleşme yok. Listelenen fiyat 46 USD/ay veya 460 USD/yıl. Capterra'da başlangıç fiyatı 19 €/ay görünüyor.
- **Elektraweb** fiyatı sayfada açık değil, teklif usulü. Bir bayiye göre fiyat oda sayısına, modüllere ve entegrasyon sayısına göre belirleniyor. Paketler Mini, Midi ve Standart. Ürün otel odaklı bir PMS ve kanal yöneticisi. Kısa dönem kiralamaya özel bir çözüm bulamadım.
- **Odamax** bir yazılım ya da kanal yöneticisi olarak değil, tüketiciye dönük otel/pansiyon rezervasyon sitesi olarak görünüyor. **Sirius** için kaynak bulunamadı.
- **Pazar payı:** Türkiye için güvenilir ve bağımsız bir pazar payı verisi bulunamadı. Sayısal tahmin üretmedim.
- Ev sahibi tarafında kullanılan araçlar ağırlıklı olarak yabancı (Lodgify, Hostaway, Smoobu, Guesty, iGMS). Yerli tarafta Hanemo, Dodo ve PeraHomes gibi yazılım değil, **yönetim hizmeti** sunan şirketler öne çıkıyor.

## Ayrıntı

### 1) Oyuncu bazında karşılaştırma

| Oyuncu | Ne? | Kısa dönem kiralama (KDK) uygunluğu | Fiyat | AI mesajlaşma |
|---|---|---|---|---|
| HotelRunner | Kanal yöneticisi, rezervasyon motoru, PMS, GRM, yorum merkezi, POS vb. | Var: ayrı "Vacation Rentals" çözümü | Hibrit: aylık minimum + ciro yüzdesi | Review Center (yorum yanıtı); mesajlaşma için üçüncü taraf entegrasyon |
| Elektraweb | PMS + kanal yöneticisi + rate manager + POS/SPA | Bayi sayfası Airbnb senkronunu anıyor, KDK'ya özel çözüm bulunamadı | Teklifle | Kaynak bulunamadı |
| Reseliva | Kanal yöneticisi + rezervasyon motoru | Kanal yöneticisi olarak kullanılabilir, KDK'ya özel kaynak yok | 46 USD/ay veya 460 USD/yıl | Kaynak bulunamadı |
| Sistem Otel | PMS + kanal yöneticisi + e-fatura, 5651 loglama | Otel odaklı | Kaynak bulunamadı | Kaynak bulunamadı |
| HMS Otel | Bulut PMS + kanal yöneticisi | Otel odaklı | Kaynak bulunamadı | Kaynak bulunamadı |
| Odamax | Tüketici rezervasyon sitesi | Yazılım değil | Uygulanamaz | Uygulanamaz |
| Sirius | – | – | – | **Kaynak bulunamadı** |

### 2) HotelRunner

- **Kanallar ve ortaklıklar:** Kanal yöneticisi 150'den fazla satış kanalına bağlanıyor. Şirket, Booking.com Premier Connectivity Partner ve Airbnb Preferred Software Partner olduğunu belirtiyor (hotelrunner.com/en/products/channel-manager/, ~36 gün önceki sayfa).
- **Kısa dönem kiralama sayfası:** Tek mülk de, apart-otel ve serviced apartment portföyü de hedefleniyor. Airbnb, Booking.com ve VRBO ile 150'den fazla kanal, Google ve trivago görünürlüğü, çok dilli/çok para birimli doğrudan rezervasyon sayılıyor (hotelrunner.com/en/solutions/vacation-rentals/, ~412 gün önceki sayfa).
- **Fiyat, resmi sayfa (~8 gün önce):** "Essential" planları hibrit modelde (hotelrunner.com/en/pricing/):
  - **Manage:** %0,75, minimum 19,95 USD/ay.
  - **Sell:** %1,25, minimum 29,95 USD/ay.
  - **Complete:** %1, minimum 39,95 USD/ay.
  - Hepsinde sınırsız kullanıcı ve oda var. Aylık gerçekleşen rezervasyon cirosu belirli bir eşiği aşarsa yüzde ücreti devreye giriyor.
- **Üçüncü taraf fiyat kaynakları:**
  - Capterra, Plus planı için 9,95 USD/ay başlangıç gösteriyor (~92 gün önceki sayfa). Bu, resmi sayfadaki güncel yapıyla örtüşmüyor, bu yüzden güvenilirliği düşük.
  - HotelTechReport başlangıcı "100 USD/ay'dan" olarak veriyor (~39 gün önceki sayfa).
- **Kullanıcı memnuniyeti ikiye bölünmüş durumda:**
  - HotelTechReport'ta 115 yorumla 4,8/5 (hoteltechreport.com, tarihsiz sayfa).
  - HotelMinder'da 154 yorumdan 3,3 ortalama. Yorumlarda gizli maliyet, her ay değişen yüksek fatura ve mobil uygulama sorunları geçiyor (hotelminder.com, ~279 gün önceki sayfa). Bunlar kullanıcı yorumları, doğrulanmış bulgu değil.
- **AI özelliği (ürün):** Review Center, Booking.com, Expedia ve Airbnb yorumlarını tek yerde topluyor. AI saniyeler içinde kişiselleştirilmiş yanıt üretiyor ve 133'ten fazla dile çeviri sağlıyor (hotelrunner.com haber sayfası, ~238 gün önceki sayfa). Entegrasyonlar sayfasında "Automation & AI" kategorisi var, ama içeriğini görüntüleyemedim (~9 gün önceki sayfa).
- **AI mesajlaşma (üçüncü taraf):** Heyhotel AI, WhatsApp, Instagram, Facebook, web sitesi ve telefon üzerinden misafire yanıt veriyor. HotelRunner'daki canlı müsaitliği okuyup rezervasyonu doğrudan HotelRunner'a yazıyor (heyhotel.ai/integrations/hotelrunner, tarihsiz). Bu, HotelRunner'ın kendi ürünü değil.
- **VillaRunner:** villarunner.com, Türkiye'de villa kiralama listeleyen bir site. HotelRunner ile bağını kaynaklarda doğrulayamadım. Sadece adının benzerliğini not ediyorum, ilişki kaynakla doğrulanmadı.

### 3) Elektraweb

- Ön büro, kanal yöneticisi, online rezervasyon, e-fatura muhasebe modülü, fiyat yönetimi ve temassız misafir uygulaması (online check-in/out, folyo, ödeme) sunuyor (phd.com.tr/markalarimiz/elektraweb/, tarihsiz).
- **Fiyat:** Resmi sayfada "teklif alın" deniyor. Eski bir sayfada kanal yönetimi ve online rezervasyon sayfasının ücretsiz olduğu yazıyor (elektraweb.com, ~1.694 gün önceki sayfa, eski). Bir yetkili bayiye göre fiyat oda sayısı, modüller ve entegrasyon sayısına bağlı. Mini, Midi ve Standart paketler var (elektrawebsatis.com, ~385 gün önceki sayfa). **TL/USD olarak sayısal liste fiyatı: kaynak bulunamadı.**
- **AI:** Elektraweb'in kendi AI mesajlaşma özelliği için kaynak bulunamadı.

### 4) Reseliva

- Kanal başı ücret yok, komisyon yok, rezervasyon sayısı sınırı yok. Entegrasyon ve kurulum ücretsiz, vergiler dahil, bağlayıcı sözleşme yok, 7/24 destek ücretsiz (reseliva.com/ns/channel_manager_pricing.php, tarihsiz).
- **Fiyat:** 46 USD/ay veya yıllık 460 USD (%16 indirimli). Sayfadaki fiyat bölge ve oda sayısı seçimine göre değişiyor olabilir. Sayfada "United States" notu var, bu yüzden Türkiye fiyatı farklı olabilir.
- Capterra'da başlangıç fiyatı 19 €/ay (capterra.com/p/253479, ~1.457 gün önceki sayfa, eski olabilir).
- Özelliklerde fiyat kuralı tanımlama var. Örneğin Booking fiyatını Expedia'ya göre yüzdeyle bağlamak mümkün (reseliva.com SSS sayfası, tarihsiz).
- **AI mesajlaşma:** kaynak bulunamadı.

### 5) Odamax, Sirius ve diğer yerli yazılımlar

- **Odamax:** Arama sonuçları tüketiciye dönük bir rezervasyon sitesini gösteriyor. Sayfalarda şehir bazlı otel/pansiyon listeleri, Kültür ve Turizm Bakanlığı belge bilgisi ve "Odamax Uygulaması" var (odamax.com, tarihsiz). Ev sahibine yazılım veya kanal yöneticisi sunduğuna dair kaynak bulunamadı. Tesislerin Odamax'a kanal yöneticisiyle bağlanıp bağlanmadığı da doğrulanamadı.
- **Sirius:** İlgili bir yerli ürün için **kaynak bulunamadı**. Arama kotası dolduğu için ürün adını başka yazımlarla deneyemedim.
- **Diğer yerli otel yazılımları:**
  - **Sistem Otel:** PMS ile entegre kanal yöneticisi ve rezervasyon motoru var. Kanal listesinde Booking, Hotelbeds, Expedia ve Agoda anılıyor (sistemotel.com, tarihsiz).
  - **HMS Otel:** "Türkiye'nin bulut tabanlı ilk otel programı ve kanal yöneticisi" iddiasında. 2010'dan beri Pamukkale Üniversitesi Teknokent'te geliştiriliyor. Sayfa kendini "Türkiye'nin 1 numaralı" olarak tanımlıyor, ama bu bir pazarlama iddiası ve veriyle desteklenmemiş (hmsotel.com, ~185 gün önceki sayfa).
  - Bir AI iletişim şirketinin blogu Elektraweb, HMS Otel, Amonra, Opera Cloud ve Protel'i PMS örnekleri olarak, HotelRunner'ı kanal yöneticisi ve rezervasyon motoru olarak sayıyor (elvador.com, ~132 gün önceki sayfa). Bu, satıcı içeriği, pazar payı kanıtı değil.

### 6) Kısa dönem kiralama ev sahibi tarafı

- **Kullanılan araçlar:** Bir Türkçe blog, Türkiye'de yaygın kanal yöneticilerini şöyle listeliyor (kepguide.com, ~10 gün önceki sayfa). Fiyatlar blogun beyanı, ben doğrulamadım:

  | Araç | Fiyat |
  |---|---|
  | Lodgify | 30–80 USD/ay |
  | Hostaway | 100 USD+/ay |
  | Smoobu | 25–60 USD/ay |
  | Guesty Lite | 27 USD/ay |
  | iGMS | 20–50 USD/ay |

  Aynı yazı, ilan sayısı 3'ü geçmeden Airbnb ve Booking arasında ücretsiz iCal senkronuyla başlanabileceğini öneriyor. iCal'in 2–6 saat gecikme yaratabileceğini de belirtiyor.
- **Yönetim şirketleri (yazılım değil, hizmet):**
  - **Dodo:** Komisyon bazlı çalışıyor. Sayfasında 67+ yönetilen ev, ortalama %78 doluluk ve "36.000+ ev verisi" iddiası var. Hizmetleri arasında dinamik fiyatlandırma ve 7/24 rezervasyon/misafir iletişimi sayılıyor (evinidodola.com, tarihsiz). Bunlar şirketin kendi beyanı.
  - **Hanemo:** Airbnb, Booking.com ve Vrbo'da eşzamanlı yayın, dinamik fiyatlandırma ve misafir iletişimi sunuyor (hanemo.com, ~485 gün önceki sayfa).
  - **PeraHomes:** Hukuki uyum süreçlerini de kapsayan yönetim hizmeti veriyor (perahomes.com.tr, ~20 gün önceki sayfa).
- **Yasal çerçeve (talep sürücüsü):** 7464 sayılı Kanun, 100 gün veya daha kısa süreli turizm amaçlı konut kiralamasında Kültür ve Turizm Bakanlığı izin belgesi şartı getirdi (hukukihaber.net, ~12 gün önceki sayfa). Kanunun yayımlandığı dönemdeki bir hukuk bürosu yazısına göre izinsiz kiralamada ilk ihlalde 100.000 TL, devamında 500.000 TL ceza öngörülüyor (guleryuz.av.tr, ~1.071 gün önceki sayfa). Ceza tutarları sonradan yeniden değerlenmiş olabilir, güncelini doğrulayın. Bu düzenleme, izin ve plaket takibi, vergi ve çift rezervasyon yönetimini ev sahipleri için daha kritik hale getiriyor.
- **İzinli konut ve Airbnb ilan sayıları:** Kaynak bulunamadı. Bu veriler pazar büyüklüğü hesabı için gerekli.

### 7) Pazar payı

- Türkiye'de HotelRunner, Elektraweb, Reseliva ve diğerlerinin müşteri sayısı ya da pazar payı için **kaynak bulunamadı**. Satıcıların "1 numara" iddiaları (örneğin HMS) veriyle desteklenmiyor.
- Dolaylı bir gösterge: HotelTechReport'ta HotelRunner'ın 115, SiteMinder'ın 2.863 doğrulanmış yorumu var (hoteltechreport.com, ~39 gün önceki sayfa). Bu küresel bir yorum sayısı, Türkiye payına dönüştürülemez.
- **TAHMİN (yalnızca niteliksel):** Dayanak, HotelRunner'ın ürün genişliği, Airbnb/Booking ortaklık rozetleri ve ayrı KDK sayfası. HotelRunner'ın bu listede KDK ev sahiplerine en doğrudan hitap eden yerli oyuncu olduğunu düşünüyorum. Elektraweb, HMS ve Sistem Otel ise otel/PMS ağırlıklı görünüyor. Bunu sayısal bir paya çevirmedim. Gerçek pay için şirketlerle görüşme, Booking/Airbnb bağlantı ortağı listeleri veya TÜRSAB/TÜROFED anketleri gerekir.

## Sonraki adım önerisi

Arama kotası yenilendiğinde şu başlıklara bakılabilir:
- Sirius'u farklı yazımlarla aramak.
- Elektraweb ve Reseliva'nın AI/WhatsApp özelliklerini doğrulamak.
- HotelRunner'ın "Automation & AI" entegrasyonlarını incelemek.
- Bakanlığın izinli konut sayısı ve Airbnb Türkiye ilan sayısı verilerine ulaşmak.

## Kaynaklar

1. HotelRunner fiyatlar: https://hotelrunner.com/en/pricing/ (~8 gün önceki sayfa)
2. HotelRunner kanal yöneticisi: https://hotelrunner.com/en/products/channel-manager/ (~36 gün önce)
3. HotelRunner Vacation Rentals: https://hotelrunner.com/en/solutions/vacation-rentals/ (~412 gün önce)
4. HotelRunner Review Center haberi: https://hotelrunner.com/en/news/product/hotelrunner-introduces-ai-powered-review-center-for-enhanced-reputation-management-in-the-travel-and-hospitality-industry/ (~238 gün önce)
5. HotelRunner entegrasyonlar: https://hotelrunner.com/en/integrations/ (~9 gün önce)
6. Heyhotel AI × HotelRunner: https://heyhotel.ai/integrations/hotelrunner (tarihsiz)
7. Capterra HotelRunner: https://www.capterra.com/p/158882/HotelRunner/ (~92 gün önce)
8. HotelTechReport HotelRunner: https://hoteltechreport.com/revenue-management/channel-managers/hotelrunner (tarihsiz)
9. HotelTechReport HotelRunner vs SiteMinder: https://hoteltechreport.com/compare/hotelrunner-vs-siteminder-channel-manager (~39 gün önce)
10. HotelMinder HotelRunner: https://www.hotelminder.com/partner=HotelRunner (~279 gün önce)
11. VillaRunner: https://villarunner.com/en (tarihsiz)
12. Elektraweb (PHD): https://www.phd.com.tr/markalarimiz/elektraweb/ (tarihsiz)
13. Elektraweb bayi: https://elektrawebsatis.com/elektraweb-otel-yonetim-yazilimi-pms-ve-channel-manager-alanyada-yetkili-bayi-goktas-bilgisayar/ (~385 gün önce)
14. Elektraweb resmi sayfa: https://www.elektraweb.com/elektraweb-otel-yonetim-sistemi/ (~1.694 gün önce, eski)
15. Reseliva fiyat: https://www.reseliva.com/ns/channel_manager_pricing.php?lang=tr (tarihsiz)
16. Reseliva özellikler/SSS: https://www.reseliva.com/ns/channel_manager_feature.php?lang=tr ve https://www.reseliva.com/ns/channel_manager_faq.php?lang=tr (tarihsiz)
17. Capterra Reseliva: https://www.capterra.com/p/253479/Reseliva-Booking-Engine/ (~1.457 gün önce)
18. Odamax: https://www.odamax.com/kural-pansiyon-276640 ve https://www.odamax.com/istanbul-otelleri-795 (tarihsiz)
19. Sistem Otel: https://www.sistemotel.com/kanal-yonetimi (tarihsiz)
20. HMS Otel: https://www.hmsotel.com/turkiyenin-1-numarali-otel-yonetim-yazilimi-neden-hms/ (~185 gün önce)
21. Elvador blog (satıcı içeriği): https://elvador.com/blog/otel-programlari/ (~132 gün önce)
22. Kepguide kanal yöneticisi karşılaştırması: https://kepguide.com/blog/cift-rezervasyon (~10 gün önce)
23. Dodo: https://evinidodola.com/ (tarihsiz)
24. Hanemo: https://hanemo.com/ (~485 gün önce)
25. PeraHomes: https://perahomes.com.tr/airbnb-yonetimi-nedir (~20 gün önce)
26. 7464 sayılı Kanun, hukukihaber: https://www.hukukihaber.net/airbnb-duzenlemesi-turizm-amacli-kisa-sureli-konut-kiralamalari (~12 gün önce)
27. 7464 sayılı Kanun cezalar, Güleryüz Hukuk: https://www.guleryuz.av.tr/tr/news-publications/detail/new-rules-on-short-term-leases (~1.071 gün önce)
