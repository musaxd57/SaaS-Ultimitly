# 11-airbnb-partner-yolu

> Soru: 2026'da Airbnb Software Partner / API erişimi için güncel başvuru yolu: başvuru formu, kabul şartları (ilan sayısı, müşteri sayısı), süre, mesajlaşma API'sinin kapsamı, Türkiye'den başvuran küçük girişim örnekleri. Booking.com Connectivity Partner için aynısı. Adım adım bir başvuru planı çıkar.

# Airbnb ve Booking.com API ortaklığı: 2026 başvuru yolu ve adım adım plan

**Not:** Airbnb ve Booking.com'un resmî sayfalarının tamamına ulaşamadım. Aşağıdaki iddiaların bir kısmı üçüncü taraf (satıcı) bloglarına dayanıyor ve bunu ayrıca belirttim. Tarihleri arama motorunun verdiği "sayfa yaşı" olarak yazdım. Bu sayfa yaşlarına göre bugünün tarihi yaklaşık Ekim 2026. Bu tarih bir çıkarımdır, doğrulanmış bir veri değil.

## Özet

- **Airbnb'de herkese açık API yok.** Erişim şirket düzeyindeki "API Program" ortaklığıyla veriliyor. Resmî API Şartları'na göre her programda dört koşul var: karşılıklı NDA, API Şartları'nın kabulü, ortağa özel şartlar ve veri güvenliği incelemesi. Ayrıca zorunlu API özelliklerinin yayınlanmasından sonra 6 ay içinde uygulanması gerekiyor ([Airbnb API Terms](https://www.airbnb.com/help/article/3418), sayfa yaşı ~371 gün).
- **Airbnb'nin resmî bir ilan/müşteri eşiği bulamadım.** Üçüncü taraf bloglar "büyük kullanıcı tabanı", binlerce ilan ve güvenlik/uptime olgunluğu gibi şeyler yazıyor ([Realtevoos](https://realtevoos.com/blog/airbnb-api-access), ~45 gün önce; [Hostex](https://hostex.io/blog/how-to-get-the-airbnb-api/), ~31 gün önce). Bunlar sayısal ve resmî değil, bu yüzden rakam üretmiyorum.
- **Airbnb başvuru formu ve süre belirsiz.** Resmî bir form bağlantısını doğrulayamadım. Bir Airbnb topluluk yanıtı [airbnb.com/partner](https://www.airbnb.com/partner) sayfasına işaret ediyor ([Airbnb Community](https://communitycenter.airbnb.com/forum/7498ebe6-5107-4e20-9ef8-b9a063c663c6/post/bGVnYWN5X2Nj_2184078), ~327 gün önce). Başka bir topluluk yazısında bir kullanıcı, geliştirici portalının artık erişilebilir olmadığını söylüyor ([Airbnb Community](https://community.withairbnb.com/t5/Help-with-your-business/How-to-enable-API-access-to-your-Airbnb-account/td-p/2002083), ~245 gün önce). Bu bir kullanıcı beyanı, resmî teyit değil. Resmî bir süre yok. Tek ipucu bir satıcı blogunda: onay "ay" mertebesinde ve reddedilme ihtimali var ([Repull](https://repull.dev/airbnb-api), tarih yok).
- **Airbnb mesajlaşma API'si kapsamı.** Bir kaynağa göre Airbnb, Homes ve Activities API'lerinde ilan yönetimi, müsaitlik, rezervasyon yönetimi ve mesajlaşmayı belgeliyor. Kapsamları (scope) Airbnb atıyor ve değiştirebiliyor ([Vorp Labs](https://vorplabs.com/agent-tools/airbnb-cli), 24 Temmuz 2026 tarihli inceleme). Kapsam başvuruda talep ettiğin ürün alanına göre belirleniyor (örneğin yalnızca mesajlaşma). Bu bilgi tek bir ikincil kaynaktan geliyor.
- **Booking.com'da yeni sağlayıcı alımı durmuş olabilir.** Resmî connect.booking.com sayfası, yeni bağlantı sağlayıcılarla entegrasyonları "until further notice" duraklattığını yazıyor ([Booking.com Connectivity Portal](https://connect.booking.com/), sayfa yaşı ~1431 gün, yani yaklaşık 2022 sonu). Güncel olup olmadığını doğrulayamadım.
- **Booking.com'un 2026 durumu için dolaylı kaynaklar var.** Elfsight, yeni kayıtların şartlar güncellenene kadar kapalı olduğunu yazıyor ([Elfsight](https://elfsight.com/blog/how-to-get-and-use-booking-com-api-partnership-and-integration/), ~153 gün önce). Rentals United, Booking.com'un onboarding'i periyodik olarak kapattığını ve sıfırdan sertifikalı entegrasyonun 12–18 ay sürdüğünü söylüyor ([Rentals United](https://rentalsunited.com/blog/how-the-api-for-booking-com-works/), ~96 gün önce). Rentals United white-label ürün sattığı için çıkar çatışması var.
- **Türkiye'den küçük girişim örneği bulamadım.** Bulduğum Türk kanal yöneticisi/PMS sayfaları (OtelAPS, HotelPilot, OTELYONET, Roomnix) Airbnb ve Booking.com'u listeliyor. Hiçbiri doğrudan "resmî API ortağı" olduğunu kanıtlamıyor. Örneğin HotelPilot'un Airbnb/Booking akışı iCal tabanlı ([HotelPilot](https://www.hotelpilot.net/cozumler/kanal-yoneticisi-turkiye), ~128 gün önce).

---

## 1. Airbnb Software Partner / API

| Konu | Bulgu | Kaynak (sayfa yaşı) |
|---|---|---|
| Erişim modeli | Herkese açık API yok. Onaylı ortaklara açık. | [WP Social Ninja](https://wpsocialninja.com/airbnb-api/) (~21 gün) |
| Resmî program koşulları | NDA, API Şartları, ortağa özel şartlar, veri güvenliği incelemesi, zorunlu özellikler için 6 ay | [Airbnb API Terms](https://www.airbnb.com/help/article/3418) (~371 gün) |
| Başvuru formu | Resmî form URL'sini doğrulayamadım. Bir topluluk yanıtı [airbnb.com/partner](https://www.airbnb.com/partner) sayfasını gösteriyor. | [Airbnb Community](https://communitycenter.airbnb.com/forum/7498ebe6-5107-4e20-9ef8-b9a063c663c6/post/bGVnYWN5X2Nj_2184078) (~327 gün) |
| Başvuruda istenenler | Üçüncü taraf blog: iş modeli, mevcut arz/işlem hacmi, kullanım senaryosu, teknik ekip kapasitesi. Onay sonrası güvenlik anketi. | [Realtevoos](https://realtevoos.com/blog/airbnb-api-access) (~45 gün) |
| Ölçüt (ilan/müşteri sayısı) | Resmî sayı bulunamadı. Üçüncü taraf bloglar "ölçek" ve "bin ölçeğinde mülk" diyor, rakam vermiyor. | Realtevoos (yukarıda) |
| Süre | Resmî süre yok. Bir blog "ay mertebesinde" diyor. | [Repull](https://repull.dev/airbnb-api) (tarih yok) |
| Kademeler | "Preferred Software Partner" daha üst kademe. Hızlı ve özel teknik destek ve API geri bildirimi gibi avantajlar sağlıyor. | [HotelRunner](https://hotelrunner.com/en/news/corporate/hotelrunner-is-once-again-titled-as-preferred-software-partner-by-airbnb/) (~399 gün) |
| Mesajlaşma API'si | Mesajlaşma, Homes API kapsamında ilan, müsaitlik ve rezervasyonla birlikte sayılıyor. Kapsamı Airbnb atıyor. | [Vorp Labs](https://vorplabs.com/agent-tools/airbnb-cli) (~89 gün) |

**Bulamadıklarım:**
- Resmî ilan veya müşteri eşiği.
- Resmî başvuru süresi.
- Mesajlaşma kapsamının uç nokta düzeyinde resmî belgesi.
- Güncel, doğrulanmış bir başvuru formu bağlantısı.

Cloudbeds'in "Airbnb API minimum requirements" yazısı da çıktı. Bu yazı, Cloudbeds'in kendi PMS bağlantısına dair kısıtlarını anlatıyor, Airbnb'nin ortaklık eşiğini değil ([Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360009781474-Airbnb-API-Minimum-Requirements), ~677 gün).

## 2. Booking.com Connectivity Partner

| Konu | Bulgu | Kaynak (sayfa yaşı) |
|---|---|---|
| Teknik şartlar | PCI ve PII uyumu, bulut/merkezi sunucu tabanlı yazılım, fiyat/müsaitlik ve rezervasyon yönetimi, gerçek zamanlı güncelleme, anlık onay, içerik yönetimi | [Booking.com Provider Help](https://connectivity.booking.com/s/article/Requirements-for-becoming-a-Booking-com-Connectivity-Partner?language=en_US) (~1430 gün, ~2022 sonu) |
| Ölçek şartı | Minimum mülk/birim sayısı isteniyor. Rakam segmente ve bölgeye göre değişiyor ve yayımlanmamış. | Aynı sayfa |
| Başvuru kanalı | Profil [connect.booking.com](https://connect.booking.com/) üzerinden gönderiliyor. | Aynı sayfa |
| Alım durumu | Resmî portalda yeni sağlayıcı entegrasyonları "duraklatıldı" notu var. Güncelliği doğrulanamadı. | [connect.booking.com](https://connect.booking.com/) (~1431 gün) |
| Süre | 12–18 ay iddiası bir satıcıdan geliyor, resmî değil. | [Rentals United](https://rentalsunited.com/blog/how-the-api-for-booking-com-works/) (~96 gün) |
| Sürekli yükümlülükler | Tüm API fonksiyonlarını desteklemek, her mülk için en az 1 yıllık fiyat/müsaitlik yüklemek, e-postaya düşen rezervasyonları en aza indirmek | [Booking.com Developers](https://developers.booking.com/connectivity/docs) (~58 gün) |
| Program kademeleri | Standard, Advanced, Premier (ayrıca "Premier Plus" duyurulmuş) | [Booking.com Partner Help](https://partner.booking.com/en-us/help/channel-manager/partner-program/understanding-connectivity-partner-program) (~1617 gün); [Hostaway](https://www.hostaway.com/blog/booking-com-premier-plus-2026/) (~168 gün) |
| Bireysel mülk | Doğrudan bağlantı yok, kanal yöneticisi üzerinden gidiliyor. | Provider Help (yukarıda) |

**Mesajlaşma API'si kapsamı** ([Booking.com Developers](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api), ~47 gün):
- Bu API mevcut Connectivity Partner'lar için. Sertifikasyon, öğretici tamamlanıp provider ID ve kanıtla Connectivity Support'a e-posta gönderilerek yapılıyor.
- Beds24'ün tanıtımına göre API serbest metin mesajı gönderme/alma, konuşma ve geçmiş mesaj çekme, görsel ekleme ve "okundu/yanıt gerekmiyor" etiketlerini destekliyor ([Beds24 / Booking.com](https://connectivity.booking.com/en-gb/our-solutions/messaging-api-1), ~1980 gün).
- Ekler yalnızca görsel tipinde (jpeg/png) ([Booking.com Developers](https://developers.booking.com/connectivity/docs/messaging-api/uploading-and-downloading-attachments), ~121 gün).
- Her yeni rezervasyon boş bir konuşma oluşturuyor ([Managing conversations](https://developers.booking.com/connectivity/docs/messaging-api/managing-conversations), ~47 gün).
- Ayrı bir "Demand API Messaging (Beta)" belgesi de var. Bunu Connectivity mesajlaşmasıyla karıştırma, farklı program.

## 3. Türkiye'den örnekler

- **Küçük girişim örneği bulamadım.** Aramalarda "Türkiye'den küçük bir girişim doğrudan Airbnb/Booking API ortağı oldu" diyen bir kaynak çıkmadı.
- **Büyük örnek:** HotelRunner kendini Booking.com Premier Plus Connectivity Partner ve Airbnb Preferred Software Partner olarak tanıtıyor ([Hospitality Net](https://www.hospitalitynet.org/news/4132739/hotelrunner-reappointed-to-bookingcoms-connectivity-commercial-advisory-board-for-the-2026-2028-term), ~141 gün). Bu, küçük girişim ölçeğinde değil. Şirketin merkez ülkesini bu kaynaklardan doğrulamadım.
- **Doğrudan ortaklığı kanıtlanmayan yerel ürünler:** OtelAPS, OTELYONET, HotelPilot ve Roomnix Booking/Airbnb entegrasyonu sunuyor. OTELYONET sayfası Booking.com ve Airbnb'yi "Resmî İş Ortaklığı" başlığı altında gösteriyor ama ortaklık türünü belirtmiyor ([OTELYONET](https://otelyonet.com.tr/kanal-yoneticisi), tarih yok).

## 4. Adım adım başvuru planı

Her adımın ne kadar süreceğine dair resmî veri yok. Süre tahmini yazmıyorum.

**Faz 0: Koşulları netleştir (1. hafta)**
1. Airbnb için [airbnb.com/partner](https://www.airbnb.com/partner) ve developer.airbnb.com sayfalarını kendin aç. Aktif bir başvuru girişi var mı kontrol et. Yoksa Airbnb'nin ortak/API destek kanalına yazılı olarak sor.
2. Booking.com için [connect.booking.com](https://connect.booking.com/) sayfasına bak. "Duraklatıldı" notu hâlâ duruyor mu? Varsa Connectivity Support formu ([Contact Us](https://connectivity.booking.com/s/contactsupport?language=en_US)) üzerinden yeniden açılış zamanını ve minimum mülk sayısını yazılı sor.
3. Cevaplara göre doğrudan başvurunun mu yoksa Faz 3'ün (aracı kullanma) mı mantıklı olduğuna karar ver.

**Faz 1: Başvuruya hazır hale gel**
4. Çalışan bir ürün (PMS veya kanal yöneticisi) hazırla. Airbnb tarafında topluluk yanıtı önce işleyen bir yazılım ürününü şart koşuyor. Bu, resmî değil, bir topluluk üyesinin yorumu.
5. Tüzel kişilik ve yetkili imza hazır olsun. Airbnb API Şartları, organizasyonun yasal adıyla kayıt ve bağlayıcı yetki istiyor.
6. Güvenlik dosyası hazırla: PCI/PII uyumu (Booking.com'un yazılı şartı), KVKK/GDPR, erişim kontrolü, loglama, uptime izleme.
7. Elindeki gerçek müşteri ve mülk sayısını belgele. Eşikler yayımlanmadığı için en dürüst sayılarla başvur.

**Faz 2: Başvuru**
8. Airbnb: iş modeli, mevcut arz/hacim, kullanım senaryosu ve teknik kapasite anlatan bir başvuru hazırla. Hedef kapsamı baştan belirt (örneğin önce mesajlaşma + rezervasyon). Onay sonrası NDA, API Şartları, güvenlik incelemesi ve 6 aylık zorunlu özellik takvimine hazır ol.
9. Booking.com: portal açıksa profili connect.booking.com üzerinden gönder. Sertifikasyon sırası olarak Rates & Availability ve Reservations API'lerini, sonra Messaging API'yi hedefle. Mesajlaşma için Booking.com'un öğreticisini tamamla ve kanıtı Connectivity Support'a gönder.

**Faz 3: Yedek plan (başvuru kapalı veya reddedilirse)**
10. Mevcut bir bağlantı sağlayıcıyla ilerle. Rentals United gibi white-label kanal yöneticileri tek API ile sertifikalı bağlantı sunduğunu söylüyor, ancak bu satıcı beyanı. Fiyat, SLA ve mesajlaşma kapsamını sözleşmeden önce yazılı doğrula. Airbnb tarafında sağlayıcının hangi kapsamlara (içerik, fiyat, rezervasyon, mesajlaşma) onaylı olduğunu mutlaka sor ([SendSquared](https://sendsquared.com/blog/best-channel-manager-for-airbnb/), ~29 gün önce).
11. iCal yalnızca takvim eşitler. Mesajlaşma ve rezervasyon verisi sağlamaz.

**Faz 4: Onay sonrası**
12. Booking.com'da tam API desteği ve her mülk için 1 yıllık fiyat/müsaitlik yüklemesi gibi sürekli yükümlülükleri takvime bağla. Airbnb'de zorunlu özellikler için 6 aylık takvimi izle.

---

## Kaynaklar

- Airbnb API Terms of Service. https://www.airbnb.com/help/article/3418 (sayfa yaşı ~371 gün)
- Airbnb Community, "How do I become an Airbnb partner?". https://communitycenter.airbnb.com/forum/7498ebe6-5107-4e20-9ef8-b9a063c663c6/post/bGVnYWN5X2Nj_2184078 (~327 gün)
- Airbnb Community, "How to enable API access…". https://community.withairbnb.com/t5/Help-with-your-business/How-to-enable-API-access-to-your-Airbnb-account/td-p/2002083 (~245 gün)
- Vorp Labs. https://vorplabs.com/agent-tools/airbnb-cli (inceleme tarihi 24.07.2026; ~89 gün)
- Realtevoos. https://realtevoos.com/blog/airbnb-api-access (~45 gün)
- WP Social Ninja. https://wpsocialninja.com/airbnb-api/ (~21 gün)
- Hostex. https://hostex.io/blog/how-to-get-the-airbnb-api/ (~31 gün)
- Repull. https://repull.dev/airbnb-api (tarih yok)
- SendSquared. https://sendsquared.com/blog/best-channel-manager-for-airbnb/ (~29 gün)
- Cloudbeds. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360009781474-Airbnb-API-Minimum-Requirements (~677 gün)
- HotelRunner (Airbnb Preferred Partner). https://hotelrunner.com/en/news/corporate/hotelrunner-is-once-again-titled-as-preferred-software-partner-by-airbnb/ (~399 gün)
- Hospitality Net (HotelRunner). https://www.hospitalitynet.org/news/4132739/hotelrunner-reappointed-to-bookingcoms-connectivity-commercial-advisory-board-for-the-2026-2028-term (~141 gün)
- Booking.com Provider Help, Requirements. https://connectivity.booking.com/s/article/Requirements-for-becoming-a-Booking-com-Connectivity-Partner?language=en_US (~1430 gün)
- Booking.com Connectivity Portal. https://connect.booking.com/ (~1431 gün)
- Booking.com Connectivity Support. https://connectivity.booking.com/s/contactsupport?language=en_US (tarih yok)
- Booking.com Developers, Connectivity APIs. https://developers.booking.com/connectivity/docs (~58 gün)
- Booking.com Developers, Messaging API. https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api (~47 gün); https://developers.booking.com/connectivity/docs/messaging-api/managing-conversations (~47 gün); https://developers.booking.com/connectivity/docs/messaging-api/uploading-and-downloading-attachments (~121 gün)
- Booking.com, Messaging API (Beds24 tanıtımı). https://connectivity.booking.com/en-gb/our-solutions/messaging-api-1 (~1980 gün)
- Booking.com Partner Help, program kademeleri. https://partner.booking.com/en-us/help/channel-manager/partner-program/understanding-connectivity-partner-program (~1617 gün)
- Hostaway (Premier Plus). https://www.hostaway.com/blog/booking-com-premier-plus-2026/ (~168 gün)
- Rentals United. https://rentalsunited.com/blog/how-the-api-for-booking-com-works/ (~96 gün)
- Elfsight. https://elfsight.com/blog/how-to-get-and-use-booking-com-api-partnership-and-integration/ (~153 gün)
- OTELYONET. https://otelyonet.com.tr/kanal-yoneticisi (tarih yok)
- HotelPilot. https://www.hotelpilot.net/cozumler/kanal-yoneticisi-turkiye (~128 gün)
