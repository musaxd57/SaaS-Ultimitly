# 03-kanal-erisimi

> Soru: 2026 itibarıyla Airbnb API erişimi (Software Partner programı şartları, yeni partner kabulü, mesajlaşma API'si), Booking.com Connectivity Partner programı şartları ve mesajlaşma API'si, iCal'in sınırları. Küçük bir girişimin doğrudan entegrasyona ulaşma yolu, süreleri, maliyetleri, alternatif (Channex, Rentals United gibi ara katman) seçenekleri.

# Airbnb ve Booking.com doğrudan API entegrasyonu ile Channex / Rentals United seçenekleri (2026)

**Rapor tarihi:** Yaklaşık Ekim 2026. Bunu kaynakların "X gün önce" bilgisinden ve 24 Temmuz 2026 tarihli bir incelemeden çıkardım. Kaynak yaşlarını "~" ile yazdım, çünkü arama aracı kesin tarih yerine göreli yaş verdi.

**Araştırma sınırı:** Arama kotam doldu. Airbnb'nin kendi `airbnb.com/partner` sayfasını, Airbnb API Terms'in tam metnini ve `connect.booking.com` sayfasının güncel durumunu doğrudan doğrulayamadım. Bu konulardaki bilgiler ikincil kaynaklara dayanıyor ve ilgili yerde belirttim.

## Özet

1. **Airbnb, başvuruya kapalı ve davetle çalışıyor.** Birkaç ikincil kaynak, yeni API erişim taleplerinin kabul edilmediğini ve Airbnb'nin partner yöneticilerinin uygun gördüğü şirketlere kendisinin ulaştığını yazıyor. Airbnb'nin kendi sayfasındaki ifade bir topluluk gönderisinde alıntılanmış, ben resmî sayfayı doğrulayamadım.
2. **Airbnb'de erişim yükümlülükle geliyor.** Bir 2026 incelemesine göre erişim NDA, API Terms kabulü, veri güvenliği incelemesi ve **6 ay içinde zorunlu özelliklerin uygulanmasını** gerektiriyor. Kapsamları Airbnb belirliyor ve değiştirebiliyor.
3. **Booking.com'da API ücretsiz ama kapı sık sık kapanıyor.** İkincil kaynaklar yeni bağlantı sağlayıcı alımının durdurulduğunu söylüyor. Bu bilginin en yeni kaynağı zayıf (bir GitHub issue'su). Rentals United'a göre sıfırdan sertifikalı entegrasyon **12–18 ay** sürüyor ve bu süre programın açık olduğunu varsayıyor.
4. **iCal yalnızca geçici bir çözüm.** Güncelleme gecikmesi 30 dakikadan 12 saate kadar değişiyor. Fiyat, mesaj ve rezervasyon ayrıntısı taşımıyor.
5. **Küçük girişim için gerçekçi yol ara katman.** Channex'in white-label planı **$130/ay + kiralık birim başına $0.50** ve asgari mülk sayısı, sertifikasyon ücreti, komisyon yok. Rentals United'da PMS için API entegrasyonu ücretsiz.
6. **Mesajlaşma iki ara katmanda da var.** Channex'in dokümantasyonu Booking.com ve Airbnb mesajlaşmasını kapsıyor. Bu özellik isteğe bağlı ek paket.
7. **Önerim:** Önce ara katmanla (Channex veya Rentals United) çıkın. Doğrudan başvuruyu yeterli ölçeğe ulaşınca açın. Bu süreyi MVP/pilot için iCal ile kısaltabilirsiniz.

---

## 1. Airbnb

### Erişim ve program şartları
- **Airbnb'nin geliştirici portalı** Homes ve Activities API'lerini listeliyor: Manage Listings, Sync Availability Checks, Reservations, Messages API ve sandbox. (developer.withairbnb.com, ~Ekim 2026'da erişilen sayfa)
- **Yeni partner kabulü:** Hospitable (~177 gün önce) şunu yazıyor: "At this time, Airbnb is not accepting new requests for API access." Partner yöneticileri aday arıyor ve davet ediyor. Seçim ölçütleri tedarik fırsatı, teknoloji gücü ve ortak müşterilere destek verme yeteneği. (https://hospitable.com/airbnb-partnerships)
- Aynı ifade bir Airbnb topluluk gönderisinde doğrudan alıntılanıyor (~328 gün önce): https://community.withairbnb.com/t5/Help-with-your-business/Request-for-Direct-API-Access-for-AI-Enhanced-Guest/m-p/2183100/highlight/true
- **2026 durumu:** Vorp Labs'ın 24 Temmuz 2026 tarihli incelemesi şunları söylüyor (https://vorplabs.com/agent-tools/airbnb-cli):
  - API Programları organizasyon düzeyinde işliyor.
  - NDA, API Terms, veri güvenliği incelemesi ve 6 ay içinde zorunlu özelliklerin uygulanması gerekiyor.
  - Gözden geçirilen API Terms sürümü 15 Ekim 2025 tarihli.
  - Kamuya açık bir başvuru yolu belgelenmemiş.
- **Ölçek beklentisi:** Smoobu (~174 gün önce) adayların belirgin ölçek, yüksek operasyonel olgunluk ve 7/24 destek kapasitesi göstermesi gerektiğini yazıyor. Veri doğruluğu kötüyse erişim hızla iptal ediliyor. Bu, rakip bir PMS'in blog yazısı, resmî şart değil. (https://www.smoobu.com/en/blog/airbnb-api/)
- **Partner kademeleri:** Airbnb Preferred ve Preferred+ statüsü için entegrasyon, teknik ve performans standartlarının yanında veri güvenliği ve API kalite incelemesi de gerekiyor. Yararları arasında hızlı destek ve API ekibine geri bildirim verme imkânı var. (https://news.airbnb.com/announcing-our-2024-preferred-software-partners/)
- **2024 listesinde** Channex Preferred+ düzeyinde, Rentals United ise Preferred düzeyinde. Bu liste 2024 tarihli. 2026 listesini bulamadım, bu yüzden **güncel statü için kaynak bulunamadı**.

### Mesajlaşma API'si
- Airbnb geliştirici portalında "Messages API" bölümü var. (developer.withairbnb.com) Ayrıntılı uç noktaları, limitleri ve kapsam şartlarını görmedim: **kaynak bulunamadı**.
- İkincil kaynaklar onaylı partnerlerin listeleme senkronu, rezervasyon, **misafir mesajı alıp gönderme** ve yorum paylaşımı yapabildiğini söylüyor. (https://www.airroi.com/api)
- Kapsamlar Airbnb tarafından atanıyor ve değiştirilebiliyor. Mesajlaşma kapsamının her partnere verileceği garanti değil. (Vorp Labs, 24.07.2026)

### Maliyet ve süre
- **Airbnb API'sinin lisans ücreti, komisyonu ve onay süresi için kaynak bulunamadı.**
- Bildiğimiz tek süre verisi, onay sonrası zorunlu özellikler için tanınan 6 ay.

---

## 2. Booking.com

### Connectivity Partner şartları
Booking.com'un Provider Help Center sayfası (~1430 gün önce, yani eski olabilir) yeni partnerler için şu şartları sayıyor (https://connectivity.booking.com/s/article/Requirements-for-becoming-a-Booking-com-Connectivity-Partner?language=en_US):
- PCI ve PII uyumu.
- Bulut veya merkezi sunucu tabanlı yazılım.
- Fiyat ve müsaitlik yönetimi.
- Rezervasyon yönetimi.
- Gerçek zamanlı fiyat/müsaitlik güncellemesi.
- Gelen rezervasyonlarda anında onay.
- Mülk içeriği yönetimi.
- **Minimum mülk/birim sayısı.** Sayı segmente ve bölgeye göre değişiyor, rakam kaynakta yok: **kaynak bulunamadı**.
- Tekil mülklerden doğrudan bağlantı kabul edilmiyor, channel manager üzerinden bağlanmak gerekiyor. Başvuru `connect.booking.com` üzerinden yapılıyor.

Geliştirici dokümantasyonu (~58 gün önce) ek beklentileri listeliyor (https://developers.booking.com/connectivity/docs):
- Tüm API fonksiyonlarını desteklemek.
- Her mülk için en az 1 yıllık fiyat/müsaitlik yüklemek.
- E-postaya düşen rezervasyonları en aza indirmek.

**Kademeler:** Lodgify'ın 2026 duyurusu Certified, Premier ve Premier Plus kademelerinden söz ediyor. Puanlar iş hacmi, ürün özelliklerinin uygulanması ve bağlantı kalitesinden geliyor. (https://www.lodgify.com/blog/booking-premier-partner-status/, ~195 gün önce) Eski Booking.com sayfaları Standard/Advanced/Premier adlarını kullanıyor.

### Yeni partner kabulü
- Elfsight (~153 gün önce) yeni kayıtların durduğunu, nedenin yeni partner şartlarının güncellenmesi olduğunu yazıyor. (https://elfsight.com/blog/how-to-get-and-use-booking-com-api-partnership-and-integration/)
- Bir GitHub issue'su (~13 gün önce) `connect.booking.com` için şunu söylüyor: "currently PAUSES onboarding of new connectivity providers". Bu **zayıf bir kaynak**: bir geliştiricinin kendi notu, Booking.com'un resmî açıklaması değil. (https://github.com/anuruddha96/hotelcare/issues/556)
- Rentals United (~96 gün önce) Booking.com'un onboarding'i dönem dönem kapattığını ve sertifikalı entegrasyonun **en iyi koşullarda 12–18 ay** sürdüğünü söylüyor. Bu, rakip bir satıcının iddiası. (https://rentalsunited.com/blog/how-the-api-for-booking-com-works/)
- **Güncel resmî durum doğrulanamadı.** Başvuru yapmadan önce `connect.booking.com`'u doğrudan kontrol edin.

### Mesajlaşma API'si
- **Zaman pencereleri:** Mülk, rezervasyondan checkout sonrası 7 güne kadar (iptalde iptalden sonra 7 gün) mesaj gönderebiliyor. Misafir mesaj yazarsa ek 14 günlük yanıt süresi doğuyor. Misafir, checkout'tan sonra 66 güne kadar mesaj yazabiliyor. (https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api, ~47 gün önce)
- **Özellikler:** Misafirin self-servis talepleri de var (check-in/out saati, tarih değişikliği, otopark, ekstra yatak vb.).
- **Sertifikasyon:** Eğitim (tutorial) tamamlanıyor ve Connectivity ekibine e-posta gönderiliyor. Sürenin uzunluğu için **kaynak bulunamadı**.
- **Pre-reservation mesajlaşma:** Request-to-Book akışında Provider Portal'dan "Enable Messaging API RTB" açılarak kullanılıyor. (https://developers.booking.com/connectivity/docs/request-to-book/pre-reservation-messaging, ~121 gün önce)
- **Uyarı:** `developers.booking.com/demand/docs/messaging` altındaki "Messaging API Beta" farklı bir şey. Demand/affiliate tarafında ve yalnızca seçilmiş pilot ortaklara açık. Mülk yönetimi entegrasyonu için bu değil, Connectivity Messaging API geçerli. (https://developers.booking.com/demand/docs/messaging/about-messaging, ~86 gün önce)

### Maliyet
- Booking.com API için komisyon almıyor, API erişimi ücretsiz ama yalnızca onaylı partnerlere veriliyor (Elfsight; StayAPI ~21 gün önce: https://stayapi.com/blog/booking-com-api). Asıl maliyet geliştirme, sertifikasyon, PCI uyumu ve işletme maliyeti.

---

## 3. iCal'in sınırları

| Konu | Bulgu | Kaynak (yaş) |
|---|---|---|
| Güncelleme sıklığı | 30 dk–2 saat; bazı anlatımlarda 20 dk–birkaç saat | blog.tokeet.com/prevent-double-bookings/ (~359 gün) |
| | Tipik 1–6 saat | airroi.com/glossary/ical-sync (~146 gün) |
| | Tipik 1–4 saat | guesty.com/blog/reducing-double-bookings-on-airbnb-and-other-channels/ (~311 gün) |
| | 12 saate kadar | rentalsunited.com/blog/airbnb-calendar-sync/ (20.05.2026) |
| Taşınan veri | Yalnızca müsaitlik/dolu tarih. Fiyat, misafir sayısı, mesaj ve rezervasyon değişiklikleri taşınmıyor. | hotelub.fr/en/ical-the-key-to-synchronized-calendar-management-for-vacation-rentals/ (~307 gün) |
| Ölçeklenme | 3 kanal için 6 feed, 6 kanal için 30 feed gerekiyor | Rentals United (aynı blog) |
| Hata uyarısı | Feed bozulursa platformlar uyarı vermiyor | Rentals United (aynı blog) |
| Zorlama | Güncelleme sıklığını zorlayamazsınız | guesty.com/blog/how-to-choose-between-ical-and-api-sync-for-your-listings/ (~239 gün) |

**Önemli not:** Bu kaynakların hepsi API satan şirketlerden geliyor, yani çıkar çatışması var. Gecikme aralıkları kaynaktan kaynağa tutarsız. Platformların gerçek polling aralığı için resmî Airbnb/Booking.com yardım sayfasını bulamadım: **kaynak bulunamadı**.

**Sonuç:** iCal, 1–2 ilan ve düşük hacimde MVP veya pilot için makul. Mesajlaşma, fiyat senkronu veya otomasyon gerektiren bir ürün için yetersiz.

---

## 4. Ara katman seçenekleri

### Channex (white-label channel manager API)
- **Fiyat:** Tek plan, aylık **$130 platform ücreti + otel başına $7 veya kiralık birim başına $0.50**. Hacim indirimi var, KDV hariç. (https://channex.io/pricing ve https://channex.io/connect-first-property, tarih belirtilmemiş; bu sayfalar güncel görünüyor)
- **Şartlar:** Asgari mülk sayısı, sertifikasyon ücreti, komisyon ve kurulum ücreti yok. Tek mülkle başlasanız bile platform ücreti ödenir. (aynı sayfalar)
- **Mesajlaşma:** "Messaging & Reviews App" isteğe bağlı ek paket. Fiyat listesinde otelde $7/mülk, kiralıkta $0.50/birim görünüyor. Bunun ana ücrete ek mi, ona dahil mi olduğu sayfadan net çıkmıyor. Dokümantasyon Booking.com ve Airbnb mesajlaşmasını kapsıyor.
- **Kapsam:** 77+ OTA. İçerik/listeleme oluşturma (Booking.com ve Airbnb) **2027 yol haritasında** ve garanti edilmiş değil. (https://channex.io/start-integration)
- **Süre:** Channex "yapay zekâ destekli geliştiriciler saatler içinde çalışan entegrasyon kurabilir" diyor. Ancak canlıya çıkış için test, Channex sertifikasyonu ve OTA hesap yetkilendirmesi gerekiyor. Bu adımların süresi için **kaynak bulunamadı**.
- **Kısıt:** Sitede "Wholesale only — never direct to hotels" yazıyor. Yani kendi PMS'iniz, ürününüz veya rezervasyon motorunuz olmalı. Tek tek mülk sahiplerine doğrudan satış hedeflenmiyor. (https://channex.io/)
- **Tutarsız veriler:** Capterra'da $30/ay, apaleo mağazasında $80/ay, hotelminder'da (~852 gün önce) "Standard $30" görünüyor. Bunlar eski ya da farklı paketlere ait olabilir. Güncel resmî fiyat olarak Channex'in kendi sayfasını esas aldım.
- **Airbnb statüsü:** 2024 Preferred+ listesinde. (news.airbnb.com)

### Rentals United
- **PMS entegrasyonu:** "Integrating our API has no cost." Müşteri başına ücret kalemleri sayfada var ama rakamı görmedim. (https://rentalsunited.com/info-for-pms/, ~789 gün önce, eski olabilir)
- **White label:** PMS ayda tek fatura ödüyor, son kullanıcıya fatura kesilmiyor. Tutar için **kaynak bulunamadı**. Sitede "Airbnb, Vrbo ve Booking.com'da Preferred Partner" yazıyor. (https://rentalsunited.com/white-label-channel-manager/, ~71 gün önce)
- **Entegrasyon şartı:** Yalnızca fiyat ve müsaitlik göndermek yetmeyebilir. Çoğu kanal PMS'in fiyat, müsaitlik, fotoğraf, açıklama ve olanakları da göndermesini ve saklamasını istiyor. Yani içerik tarafı Channex'ten daha kapsamlı olabilir. (aynı sayfa)
- **Doğrudan kullanıcı fiyatı:** Pro plan 10–50 ilan için **$330/ay**'dan başlıyor. Bu, sitede ürünü kendisi kullanan mülk yöneticisi içindir, white-label tarifesi değil. (https://www.itechguides.com/products/rentals-united/, ~22 gün önce)
- **Süre:** Entegrasyon süresi için **kaynak bulunamadı**.

### Diğer
- NOBEDS, Booking.com, Airbnb, Expedia, Trip.com ve Agoda ile sertifikalı olduğunu ve tek API üzerinden rezervasyon, müsaitlik ve mesajlaşma sunduğunu iddia ediyor. Fiyatını doğrulamadım. (https://nobeds.com/api/, ~33 gün önce)
- Smoobu, Hostaway, Guesty gibi hazır PMS'ler kendi API'lerini genelde dışarı açmıyor. Bir topluluk gönderisinde Smoobu API anahtarlarıyla test yapılmış ve doğrudan Airbnb erişimine geçilemediği yazılmış. (Airbnb Community, yukarıdaki bağlantı)

---

## 5. Karşılaştırma ve girişim için yol haritası

| Yol | Giriş şartı | Süre | Maliyet |
|---|---|---|---|
| iCal | Yok | Gün | Ücretsiz, ama ürün için yetersiz |
| Channex white-label | PMS/ürün olmalı, API'yi uygulamak gerek | **TAHMİN: 1–3 ay** (canlıya çıkış dahil) | $130/ay + $0.50/VR birim |
| Rentals United white-label | PMS/ürün olmalı, içerik verisi gönderebilmeli | Kaynak bulunamadı | API entegrasyonu ücretsiz, aylık fatura tutarı bulunamadı |
| Booking.com doğrudan | PCI/PII, min. mülk sayısı, program açık olmalı | 12–18 ay (RU iddiası) | API ücretsiz, geliştirme/uyum maliyeti yüksek |
| Airbnb doğrudan | Davet, NDA, güvenlik incelemesi, 6 ay uygulama | **TAHMİN: 12+ ay** | Kaynak bulunamadı |

**TAHMİN dayanakları:**
- *Channex 1–3 ay:* Satıcı geliştirmenin saatler sürebileceğini söylüyor, ama sertifikasyon ve OTA yetkilendirmesi için süre yayımlamamış. Test ve sertifikasyon döngüleri için pay bıraktım.
- *Airbnb 12+ ay:* Başvuru kapalı, davet bekleniyor, ardından NDA, güvenlik incelemesi ve 6 aylık zorunlu özellik süresi geliyor.

### Maliyet örneği (Channex, KDV ve hacim indirimi hariç, hesap bana ait)
- 50 kiralık birim: $130 + 50×$0.50 = **$155/ay**.
- 200 kiralık birim: $130 + 200×$0.50 = **$230/ay**.
- Mesajlaşma ek paketi ayrıca ücretlendirilirse bu rakamlar artabilir (yukarıdaki belirsizliğe bakın).

### Önerilen sıra
1. **0–1. ay:** İlk 1–2 ilanla pilot için iCal. Aynı anda Channex sandbox'ında entegrasyonu denemeye başlayın.
2. **1–4. ay:** Channex (veya Rentals United) üzerinden Booking.com + Airbnb bağlantısını canlıya alın. Mesajlaşma ek paketini ekleyin. İki sağlayıcıdan teklif alıp mimarinizi tek sağlayıcıya kilitlemeyin.
3. **Ölçek sonrası:** Yeterli sayıda mülk ve veri güvenliği olgunluğuna ulaşınca (PCI/PII, SOC tarzı kontroller) doğrudan başvuruyu düşünün. `connect.booking.com`'da profil oluşturun. Airbnb için bir ara katman partnerinin ya da Airbnb hesap yöneticinizin kanalını kullanın.
4. **Sorulacaklar (kaynak bulunamadı):** Channex ve Rentals United'ın Airbnb ve Booking.com mesajlaşmasında hangi sınırlarla çalıştığı, canlıya geçiş süreleri ve 2026 partner kademeleri.

---

## Kaynaklar
- Airbnb geliştirici portalı: https://developer.withairbnb.com/
- Airbnb, 2024 Preferred Software Partners: https://news.airbnb.com/announcing-our-2024-preferred-software-partners/
- Hospitable, Airbnb partnerlikleri: https://hospitable.com/airbnb-partnerships
- Airbnb Community, doğrudan API talebi: https://community.withairbnb.com/t5/Help-with-your-business/Request-for-Direct-API-Access-for-AI-Enhanced-Guest/m-p/2183100/highlight/true
- Vorp Labs, Airbnb API Programları (24.07.2026): https://vorplabs.com/agent-tools/airbnb-cli
- Smoobu, Airbnb API: https://www.smoobu.com/en/blog/airbnb-api/
- AirROI, resmî API kapsamı: https://www.airroi.com/api
- Booking.com, Connectivity Partner şartları: https://connectivity.booking.com/s/article/Requirements-for-becoming-a-Booking-com-Connectivity-Partner?language=en_US
- Booking.com, Connectivity API genel bakış: https://developers.booking.com/connectivity/docs
- Booking.com, Messaging API: https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api
- Booking.com, pre-reservation mesajlaşma: https://developers.booking.com/connectivity/docs/request-to-book/pre-reservation-messaging
- Booking.com, Demand Messaging API (Beta): https://developers.booking.com/demand/docs/messaging/about-messaging
- Lodgify, Booking.com Premier 2026: https://www.lodgify.com/blog/booking-premier-partner-status/
- Elfsight, Booking.com API: https://elfsight.com/blog/how-to-get-and-use-booking-com-api-partnership-and-integration/
- StayAPI, Booking.com API: https://stayapi.com/blog/booking-com-api
- GitHub issue (onboarding durdurma notu, zayıf kaynak): https://github.com/anuruddha96/hotelcare/issues/556
- Rentals United, Booking.com API: https://rentalsunited.com/blog/how-the-api-for-booking-com-works/
- Rentals United, takvim senkronu: https://rentalsunited.com/blog/airbnb-calendar-sync/
- Rentals United, PMS entegrasyonu: https://rentalsunited.com/info-for-pms/
- Rentals United, white label: https://rentalsunited.com/white-label-channel-manager/
- Rentals United değerlendirmesi: https://www.itechguides.com/products/rentals-united/
- Channex fiyatlar: https://channex.io/pricing
- Channex ilk mülkü bağlama: https://channex.io/connect-first-property
- Channex entegrasyon: https://channex.io/start-integration
- Channex ana sayfa: https://channex.io/
- NOBEDS: https://nobeds.com/api/
- iCal: https://blog.tokeet.com/prevent-double-bookings/ · https://www.airroi.com/glossary/ical-sync · https://www.guesty.com/blog/reducing-double-bookings-on-airbnb-and-other-channels/ · https://www.guesty.com/blog/how-to-choose-between-ical-and-api-sync-for-your-listings/ · https://hotelub.fr/en/ical-the-key-to-synchronized-calendar-management-for-vacation-rentals/
