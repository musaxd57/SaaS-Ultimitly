# Lixus AI: strateji notu (Ekim 2026)

**Okuma kılavuzu:** Kaynaklı sayıların yanına rapor kodunu yazdım (R01–R07). **[H]** işareti benim hesabım, **[V]** kurucu girdisi veya varsayım demek. Raporlarda olmayan bir sayıyı kullanmadım. Veri yoksa "yok" yazdım. Emek tahminlerini kod tabanını görmeden yaptım, kaba okuyun.

## Önce beş cümlelik özet

1. **Pazarın kaç ev sahibi olduğunu kimse bilmiyor.** Kaynaklı olan ilan sayısı ve onun eğilimi: yaklaşık 49 bin kısa dönem Airbnb ilanı, %75'i üç şehirde, azalıyor. İlk 100 müşteri için pazar yeter. Bin ve üstü için ev sahibi dağılımı verisi şart.
2. **Asıl engel Lixus'un fiyatı değil, müşterinin toplam maliyeti.** Hospitable üzerinden bağlanan müşteri Hospitable'a da ödüyor. 1 dairede bu, Lixus'un 3 katından fazla.
3. **Türkiye'de yaygın PMS'ler Hospitable değil.** İki Türkçe blogda (zayıf kaynak) Lodgify, Hostaway, Guesty, Smoobu, Beds24 sayılıyor, Hospitable yok (R05, R06). Köprü stratejisi, hedef müşteriye yeni bir araç satın aldırmak anlamına gelebilir.
4. **Düz SSS yanıtlama katmanı platformlara ve PMS'lere taşınıyor.** Airbnb ev sahibi otomatik yanıtı Mayıs 2026'da, Booking Auto-Reply Ekim 2025'te duyuruldu (R07). Hospitable'ın AI önerisi zaten $29'lık Host planında (R02).
5. **İlk iş fiyat deneyi değil.** Önce kanalı Hospitable'dan bağımsızlaştıran bir giriş yolu ve taslak kabul oranı ölçümü kurulmalı.

---

## 1) Pazarın gerçek boyutu ve hedef müşteri

### Kaynaklı veriler

| Gösterge | Değer | Kaynak |
|---|---|---|
| Aktif Airbnb tüm-konut ilanı | 85.169 (Ağu 2025) | R01, R04, Homesberg |
| Bunun 100 günün altı minimum konaklamalısı | 49.042 (kalan 36.127 ≥100 gün) | R04, Homesberg |
| Kanun öncesi (1 Oca 2024) | ~110.000 | R01, Homesberg |
| Düşüş | ≈ %23 | R01 [H] |
| Antalya / İstanbul / Muğla | 25.121 / 20.908 / 18.133 (üçü ≈ %75) | R04, Homesberg; oran [H] |
| Antalya'da aktif ilan, yıllık | %−48,8 (14.231; Ağu 2026; 3 platform, tekilleştirilmiş) | R01, AirDNA |
| Belgeli konut | 22.939 (2024 sonu) · 30.938 (1 Oca 2025) · 42.207 (~Eyl 2025) | R01 |
| Yeni izin akışı (net) | Eylül +137, Ekim +86, Kasım +19 | R06, Homesberg |
| İstanbul'da ilk 10 host payı | %6,3 (1.283 ilan); en büyük host 403 ilan | R01, Homesberg portalı (tarihsiz) |

**Bu verilerin sınırları:**
- Kaynaklar birbirini tutmuyor. İstanbul için 13.076 ile 20.518, Antalya için 2.593 ile 14.231 arasında rakamlar var (R01). Fark gerçek pazar farkı değil, tanım ve kapsam farkı. Yön için tek kaynağın zaman serisine bakın.
- En güncel Homesberg verisi Ağustos–Kasım 2025'e ait, yaklaşık bir yıllık. Antalya'daki %−48,8, ilan sayılarının bugün çok daha düşük olabileceğini gösteriyor.
- Belge sayısı serisi tutarsız (22.939 → 37.172 → 42.207, ayrıca Homesberg tablosunda ~31.000). Resmi güncel seri yok (R01).
- **Yok:** ev sahibi sayısı, 3–25 daire işletmeci sayısı, Booking.com ilan sayısı, Türkiye'de Hospitable kullanıcı sayısı (R01, R04, R05, R06).

### Bunu karara çeviren hesaplar [H]

**100 müşteri ne kadar ilan eder?** Bir daireyi bir ilan sayıyorum. Paydada 49.042 var.

| 100 müşteri hepsi... | İlan | Pazarın payı |
|---|---|---|
| Başlangıç (1–2 daire) | 100–200 | %0,2–0,4 |
| Pro (3–7) | 300–700 | %0,6–1,4 |
| İşletme (8–25) | 800–2.500 | %1,6–5,1 |

Sonuç: İlk 100 müşteri için pazar büyüklüğü kısıt değil. Kısıt erişim ve ödeme isteği.

**Uzun vade için ölçü birimi:** 49.042 ilanın %1'i yaklaşık 490 ilan eder. Pro bandındaki ilan başı fiyatla (₺128,4–299,7, R04 [H]) bu ayda yaklaşık ₺63–147 bin gelir demek. "Tüm pazar" rakamı yerine, "her pazar payı puanı ne eder" diye düşünmenizi öneririm.

### Hedef müşteri (öneri)

**Birincil: 3–25 daireli, izinli operatör, İstanbul, Antalya veya Muğla.**
- **Neden:** Kurucunun kendi işletmesi bu profilde. Müşterinin toplam maliyeti yüzdesi 5 ve 10 dairede 1 daireye göre daha düşük (Bölüm 3). İzinsiz kiralamada konut başı ₺100.000 ceza var (R01, Tourism Today, Ocak 2025), bu yüzden izinli operatör düzenli çalışıyor. Cezanın güncel tutarı için kaynaklar çelişiyor (R01'de ₺1.000.000, R05'te ₺500.000 ikinci ihlal). Pazarlamada kullanmadan önce resmi kaynaktan teyit edin.
- **Tahmin:** Aynı binada belge sınırı olduğu için çok daireli operatörler daireleri farklı binalara yayıyor olabilir. Kaynakla doğrulanmadı.
- **Nasıl ölçülür:** Lead CRM'de ilan sayısı, şehir ve izin durumu alanları. 30 günde ilk 50 lead'in kademe dağılımı.

**İkincil: yönetim şirketleri ve co-host'lar.** Pera Homes'a göre tam yönetim komisyonu net gelirin %15–25'i, co-hosting %8–15'i (R04, R06). Dodo (67+ ev, kendi beyanı), Hanemo, PeraHomes, TFC Türkiye adı geçenler (R05, R06). Tek anlaşma, çok ilan. Ancak Hospitable'ın "tek ana hesap → çoklu host" modeli tenant izolasyonunda yeniden tasarım ve sizin onayınızı gerektiriyor.

**Segment verisini kendiniz üretin:**
- Bakanlıktan belge sahibi başına konut dağılımı için bilgi edinme başvurusu (R01 önerisi).
- AirDNA, Homesberg veya AirROI'den host başına ilan dağılımı (R01 önerisi, ücretli).
- Kendi Lead CRM'iniz.
- Ölçü: "3+ daireli host oranı" tek bir sayı olarak elinizde olmalı.

---

## 2) Rakip konumu

### Kim ne veriyor

| Rakip | Fiyat | AI davranışı | Riskli mesaj | Türkçe |
|---|---|---|---|---|
| **Hospitable** | Host $29 (1 mülk, +$10), Pro $59 (2, +$15), Mogul $99 (3, +$30). Fiyat sayfası eski, Guesty blogu "$39'dan" diyor (R02) | AI öneri Host'tan itibaren, onaysız otomatik yanıt yalnız Mogul'da | En açık belgelenmiş yasaklı konu listesi: müsaitlik, erken giriş/geç çıkış, iade, ödeme, kilit kodu | Belge yok, misafir dilini eşliyor |
| **Guesty** | Lite $9'dan, 1–3 ilan (resmi). Pro 4–199 ilan, teklifle (R02) | ReplyAI taslak, Autopilot güven eşikli | Eşik, kategori, duygu filtresi | "Tüm diller" diyor, sayılan dillerde Türkçe yok |
| **Hostaway** | Resmi fiyat yok, dolaşan $15–50 tutarsız (R02, R04) | Varsayılan taslak, kural bazlı auto-reply | Kural ve duygu bazlı | Kaynak yok |
| **HostBuddy** | $7/mülk'ten (R02) | Hem otomatik hem onay modu | "Human-in-the-loop" var | "Global" (ikincil) |
| **Hostfully, Jurny, Akia** | Fiyat bulunamadı | Hostfully taslak, Jurny otonom | — | Hostfully çok dilli |
| **Airbnb** | Ücretsiz | Otomatik yanıt, önerilen eylem, öncelikli mesaj; kademeli açılış (20 May 2026) | Ev sahibi yanıtı silebiliyor | Türkiye rollout verisi yok (R07) |
| **Booking.com** | Ücretsiz | Auto-Reply küresel (Eki 2025). Smart Messenger yalnız ABD, İngiltere, Yeni Zelanda, Avustralya ve İngilizce tercihli (R07) | — | Auto-Reply için belirtilmemiş |
| **Yerli yazılım** (HotelRunner, Elektraweb, Reseliva) | HotelRunner min. $19,95–39,95 + %0,75–1,25; Reseliva $46/ay; Elektraweb teklifle (R05) | HotelRunner'da yorum yanıtı AI'ı var. Misafir mesajı için üçüncü taraf Heyhotel AI, otel odaklı | — | — |
| **Yönetim şirketleri** | Komisyon %8–25 (R04) | İnsan hizmeti | — | Yerli |

### Lixus'un konumu

**Farklı olduğu yerler:**
- **Türkçe öncelik ve TL fiyat.** Hiçbir rakip için Türkçe kalitesi belgelenmemiş (R02). Ama bu sizin kanıtlamanız gereken bir iddia, hazır bir avantaj değil.
- **Yerli uyum:** KVKK araçları, kayıt onayı, VDP, yasal kişi bilgisi.
- **"AI yardımcıdır, riskli mesaj insana kalır" ilkesi.** Hospitable'ın en güçlü yanı da bu alan. Fark yaratması için Lixus'un politikası görünür ve ayarlanabilir olmalı (Bölüm 5, madde 2).
- **Operasyon paketi:** görevler, takvim, iptaller, QR sohbet. Aynı seviyede karşılığı HotelRunner'da AI mesajlaşma olarak yok.
- **Kurucunun kendi 10 dairesi:** gerçek Türkçe misafir verisi ve bir referans. Henüz bir kanıta dönüşmemiş.

**Geride olduğu yerler:**
- **Kanal erişimi.** Airbnb doğrudan API başvuruya kapalı, davetle çalışıyor. Booking.com'un yeni bağlantı sağlayıcı alımı durmuş görünüyor ama bu bilgi zayıf kaynaktan (R03). Lixus Hospitable'a bağımlı.
- **Müşteri maliyeti.** Lixus müşterisi Hospitable'ın AI önerisini zaten $29'da alıyor. Lixus'un "neden ekstra ödeyeyim" sorusuna cevabı olmalı.
- **Otomatik gönderim yok.** İlke gereği bilinçli, ama Hostaway, Guesty ve HostBuddy'de seçenek olarak var.
- **Ses, WhatsApp ve çok kanal yok.** Conduit'e göre telefon ürünü boşluğu var (R07, satıcı kaynağı). Bu zayıf bir kanıt.
- **Kullanıcı kanıtı yok:** yorum, vaka çalışması, referans.

**Dürüst okuma:** Yerli rakiplerde misafir mesaj AI'ı doğrulanamadı. Boşluk var gibi görünüyor, ama bu "kaynak bulunamadı"dan çıkan bir sonuç, kanıt değil. Heyhotel AI'nın KDK ev sahibine hitap edip etmediğini doğrulayın.

---

## 3) Fiyat önerileri ve deneyler

### Önce üç tespit

**a) Kur varsayımı eskimiş.** ₺46 yerine R04'te Wise ~49,57, Foreks ~49,60, autr.tr 49,22–49,29 görünüyor. 49,5 ile Başlangıç $9,07, Pro $18,16, İşletme $34,32 (R04 [H]). Kaynaklar tarihsiz veya 29–43 gün eski, güncel kuru kendiniz teyit edin.

**b) Müşterinin toplam maliyeti (Hospitable Host planıyla, kur 49,5) [H]:**

| Daire | Hospitable Host | Lixus | Toplam | Lixus'un eklediği |
|---|---|---|---|---|
| 1 | $29 = ₺1.435,5 | ₺449 | ₺1.884,5 | %31 |
| 5 | $69 = ₺3.415,5 | ₺899 | ₺4.314,5 | %26 |
| 10 | $119 = ₺5.890,5 | ₺1.699 | ₺7.589,5 | %29 |
| 25 | $269 = ₺13.315,5 | ₺1.699 | ₺15.014,5 | %13 |

Müşteri Lixus'a ödediğinin yaklaşık 3 katını Hospitable'a ödüyor. Üstelik Hospitable ücretli plan zaten AI önerisi içeriyor. Bu hesap Host planıyla yapıldı, plan özelliklerinin farkını bilmiyorum.

Kurucunun hedefi olan ~$7/daire "sadece-API" paketi gerçekleşirse [V, Hospitable'dan teyit yok] 1 dairede toplam maliyet Hospitable tek başına olanın yaklaşık %45, 5 dairede yaklaşık %23 altına iner [H]. Ama Patrick white-label'ı "trafik gösterince pilot" demişti. Yani o paketin gelmesi sizin getireceğiniz müşteriye bağlı.

**c) Kademe sıçramaları:** 2→3 dairede +%100 (₺449 → ₺899), 7→8'de +%89 (₺899 → ₺1.699) (R04 [H]). İlan başı fiyat 3'te ₺224,5'ten ₺299,7'ye, 8'de ₺128,4'ten ₺212,4'e çıkıyor.

### Öneriler ve deneyler

**P1. Fiyat listesini ilk ücretli müşteri grubuna kadar değiştirmeyin.**
- **Neden:** R04'ün önerdiği A/B testi (₺349/449/599) için kol başına 7.600 ziyaretçi gerekiyor [H, standart yaklaşım], yani üç kolda 22.800. R06'ya göre ₺25.000/ay reklam bütçesi 1.250–4.170 tıklama getirir [H]. Bu, sadece reklam trafiğiyle 5,5 ile 18 ay demek. Bu trafikle istatistiksel A/B anlamsız.
- **Yerine:** Fiyat kabulünü 1:1 teklif görüşmelerinde ölçün (P2).
- **Ölçü:** Görüşme başına "fiyat itirazı" kaydı. Her görüşmede kabul veya ret ve neden.

**P2. Küçük örneklemli Gabor-Granger ve teklif testi (15–25 görüşme).**
- **Neden:** R04 segment başı 100 yanıt öneriyor, ama ulaşabileceğiniz örneklem küçük. Yön vermek yeter. R04 yerel ödeme istekliliği anketi bulamadı. Tek dolaylı veri yönetim komisyonları (%8–25) ve zayıf bir SEO blogu.
- **Nasıl:** Aynı müşteriye önce Lixus fiyatını, sonra Hospitable dahil toplamı gösterin. Hangi noktada "pahalı" dediğini kaydedin.
- **Ölçü:** Toplam maliyette ret noktası ile yalnız Lixus fiyatındaki ret noktası farkı.

**P3. Toplam maliyet hesaplayıcısı (fiyat sayfası deneyi).**
- **Neden:** Gizli maliyet algısı HotelRunner yorumlarında ana şikayet (R05, HotelMinder, kullanıcı yorumu). Önceden söylemek bunu önler.
- **Kollar:** Hesaplayıcılı sayfa ve hesaplayıcısız sayfa.
- **Ölçü:** Deneme kaydı oranı ve Hospitable bağlantısı tamamlanma oranı. Trafik düşükse yalnızca bağlantı tamamlama oranına bakın.

**P4. Kademe sıçraması için önce veri, sonra hibrit test.**
- **Neden:** Kademe altında yığılma varsa (çok sayıda müşteri 2 veya 7 dairede duruyorsa) sıçrama sizi cezalandırıyordur.
- **Nasıl:** İlk 30 müşteride daire sayısı histogramı çıkarın. 2 ve 7'de belirgin tepe varsa 3 daireli müşterilere iki teklif verin: Pro ₺899 veya "Başlangıç + ek daire başı ₺224,5" (₺673,5, mevcut fiyattan türetilmiş [H]).
- **Ölçü:** 3 daireli müşterinin kabul ettiği teklif ve ilan başı gelir. Marj kontrolü zorunlu: LLM maliyetini bilmiyorum.

**P5. Deneme süresini kullanıma bağlayın.**
- **Neden:** 14 gün "kart yok" deneme Lixus tarafında. Ama API yalnız Hospitable'ın ücretli planlarında, yani müşteri denemeye girmeden Hospitable'a ödeme yapıyor olabilir. Hospitable'ın deneme sunup sunmadığı raporlarda yok.
- **Nasıl:** Süre yerine "ilk 20 AI taslağı onaylanana kadar" gibi bir hedef (sayı örnek, kendi verinizle belirleyin). Kış ve düşük sezonda 14 günde yeterli mesaj gelmeyebilir.
- **Ölçü:** Aktivasyon (ilk yanıt gönderildi) oranı, deneme→ücretli oranı.

**P6. Yıllık fiyat vurgusu.**
- **Neden:** Yıllık ×10 zaten %16,7 indirim [H]. Reseliva %16 yıllık indirim veriyor, Smoobu %10 ve %20 (R04, R05). Yıllık peşin nakit ve kur riskinden korunma sağlar.
- **Ölçü:** Yıllık plan payı, ilk 90 gün sonrası iptal. TL'de peşin ödemenin müşteri için maliyetine dair veri yok, görüşmelerde sorun.

**P7. Sezon duraklatma seçeneği (küçük deney).**
- **Neden:** Muğla ve Antalya mevsimlik (Homesberg Ekim 2025 başlığı "sezonun son etkileri", R01; içeriğini görmedim). İlk 100 müşteri planı kış dönemine denk geliyor. Duraklatma kayıp yerine geri dönüş sağlayabilir.
- **Ölçü:** Duraklatan müşterilerin yeniden aktivasyon oranı. İptal vs duraklatma karşılaştırması.

**P8. 25+ daire fiyat tabanı.**
- İşletme'nin 25. dairede ilan başı fiyatı ₺68 [H]. 25+ için ek daire başı ₺68'in altına inmeyin. LLM maliyeti ve Hospitable ücreti bilinmeden daha düşük teklif vermeyin.

**P9. USD/TRY revizyon kuralı.** Çeyreklik gözden geçirin. Tetik: brüt marjın sizin belirleyeceğiniz eşiğin altına inmesi. Enflasyon rakamı kullanmıyorum, raporlarda yok.

**Katılmadığım öneri (R04 Deney 6):** AI'ı eklenti olarak ayrı fiyatlamak. Lixus'ta AI çekirdek ürün ve özellik kilidi yok. Ayırmak ürünü bozar, ayrıca ₺99–249 aralığı R04'ün kendi tahmini, kaynaksız.

---

## 4) İlk 100 müşteriye ulaşma planı

### Önkoşul: kanal akışının sürtünmesi

Müşteri deneme başlatmak için şunları yapmalı: Hospitable ücretli plan açmak ($29 veya üstü), Lixus'a PAT (Read+Write) vermek ya da OAuth'u beklemek. **Bu zincirin tamamlanma oranı ilk 100'ün en büyük belirleyicisi olacak.** Bunu doğrulayan veri yok, bu benim tahminim. İlk 10 müşteride adım adım düşüşü ölçün. Hospitable'ın Türkiye'deki payı için kaynak yok, yaygın araçlar listesinde yok (R05, R06). Bu yüzden "Hospitable'sız giriş yolu" Bölüm 5'te 3. sırada.

### Kanallar

| Sıra | Kanal | Rol | Maliyet (kaynaklı) | Ölçü |
|---|---|---|---|---|
| 1 | **Kurucunun ağı + Lead CRM + 1:1 onboarding** | İlk 10–30 müşteri, geri bildirim | Zaman | Lead→deneme→bağlantı→ücretli. Her aşamada düşüş nedeni |
| 2 | **Yönetim şirketleri ve çok daireli operatörler** (Pera, Hanemo, Dodo, TFC) | Tek anlaşma, çok ilan | Satış zamanı. Hanemo verisi 485 gün eski (R05) | Görüşme→pilot→ücretli, pilot başına ilan |
| 3 | **İçerik** | Düşük maliyetli lead | Zaman. Organik CAC için Türkiye verisi yok (212 Medya'nın $205'i küresel) | Organik trafikten deneme kaydı |
| 4 | **Küçük ücretli arama testi** | Anahtar kelime hacmi ve dönüşüm öğrenmek | CPC ₺6–20, CPA ₺100–280 (R06, Mizemedia, Oca–May 2026). Bozbay: CPC ₺11,20, %3,1 dönüşüm, ₺361 | CPA, deneme kaydı, ücretli |
| 5 | **Temizlik ve akıllı kilit ortakları** (Armut, Nuki Türkiye) | Dolaylı yönlendirme | Yönlendirme komisyonu verisi yok (R06) | Ortaktan gelen lead |
| 6 | **Facebook, WhatsApp, Telegram grupları** | Düşük maliyet, kural bilinmiyor | Envanter yok (R06) | Önce envanter çıkarın, sonra bir grupta pilot |
| 7 | **Hospitable'ın Türk kullanıcıları** | Köprü ekosistemi | Dürtme yok kararınıza uygun: kendiniz veri biriktirin | Lixus'a bağlanan Hospitable hesabı sayısı |
| 8 | **Referans** | İlk müşterilerden | Ödül maliyeti sizin kararınız | Referans oranı |

**İçerik kanalı notu:** İzin, vergi ve yasa içeriği çok kalabalık (Konaak, Homesberg, Kadim Hukuk vb., R06). R06'nın tahmini, operasyon ve otomasyon konularının az doldurulduğu yönünde, ama sistematik bir boşluk analizi yapılmadı. Öneri: Homesberg'in aylık rapor formatı gibi, kendi 10 dairenizden anonimleştirilmiş bir "Türkçe misafir mesajları: en sık sorular ve yanıt süreleri" yayını. Misafir verisinde KVKK'yı gözetin.

**Ücretli arama:** Önce küçük bir bütçeyle 2–4 hafta hacim öğrenin. R06'nın ₺25.000/ay önerisi bir ajans minimumu, kanıtlanmış bir gereklilik değil. Hesaplarına göre bu bütçe 90–250 dönüşüm getirir, ama dönüşüm form veya kayıt demek, ücretli müşteri değil.

**Ücretli arama için başa baş hesabı [H].** Kural: edinme maliyeti ilk 3 aylık gelirle geri dönsün (bu kural sizin kararınız, ben öneriyorum). Gerekli minimum lead→ücretli oranı:

| CPA | Başlangıç (3 ay = ₺1.347) | Pro (3 ay = ₺2.697) |
|---|---|---|
| ₺100 | %7,4 | %3,7 |
| ₺280 | %20,8 | %10,4 |
| ₺361 | %26,8 | %13,4 |

Oranlar yüksek. Ücretli arama ancak Pro ve İşletme müşterisini hedefliyorsa mantıklı. Başlangıç için organik ve doğrudan kanal öne geçmeli. CPA'daki "dönüşüm"ün tanımı kaynaktan kaynağa değişiyor, bu hesap yaklaşık.

### Zaman çizelgesi

Türkiye'de KDK SaaS'ları için edinim hızı verisi yok (R06). Bu yüzden "X ayda 100" diyemem. Aşamalar öneririm, hedef sayıları siz koyun:
- **Faz 0 (ilk 4 hafta):** Ölçüm altyapısı (aşama bazlı huni), kanal envanteri, PAT bağlantı sihirbazı, ilk 10 pilot.
- **Faz 1:** Çok daireli operatör ve yönetim şirketi pilotları. Yönetim şirketinde sözleşme öncesi tenant izolasyonu kararı (Bölüm 7).
- **Faz 2:** En iyi çalışan iki kanala yatırım. Ücretli arama yalnız CPA başa baş eşiğinin altındaysa.

**Aşama bazlı ölçüler:** ziyaret→kayıt→Hospitable hesabı→bağlantı tamamlandı→ilk taslak onaylandı→ücretli→90. gün aktif. Kohort başına haftalık izleyin.

---

## 5) Ürün yol planı: en çok değer katacak 10 geliştirme

Mevcut özellikleri tekrar önermedim. Emek: S ≈ 1 haftaya kadar, M ≈ 2–4 hafta, L ≈ 1 ay üstü (kaba, kod tabanını görmeden).

**1. Taslak kabul oranı ölçümü + Türkçe değerlendirme seti (S–M)**
- **Neden:** Hiçbir rakip için Türkçe kalitesi belgelenmemiş (R02), "Türkçe öncelik" iddiasını kanıtlamanın yolu bu. Yönetim ve fiyat kararlarının hepsi buna bağlı.
- **Ölçü:** Taslakların oranı: olduğu gibi gönderilen / düzenlenen / reddedilen. Haftalık, müşteri ve konu bazında.

**2. Konu bazlı ayarlanabilir risk politikası (M)**
- **İçerik:** Konu kategorisi başına "her zaman insana / taslak / (ev sahibi açarsa) otomatik", tek rezervasyonu duraklatma. Hospitable'ın yasaklı listesi (müsaitlik, erken giriş/geç çıkış, iade, ödeme, kilit kodu; R02) iyi bir başlangıç.
- **Neden:** Mevcut durumda risk rozeti var, politikanın kendisi kullanıcıya görünür mü bilmiyorum. Bu en savunulabilir farkınız.
- **Sınır:** Otomatik gönderim ilkenize aykırı olabilir. Karar sorusu (Bölüm 7).
- **Ölçü:** Riskli konuların insana düşme oranı. Müşteri şikâyeti ve "yanlış yanıt" bildirimi sayısı.

**3. Kanal bağlantısız kullanım modu (M)**
- **İçerik:** Gelen mesajı yapıştır → öneri al, Mülk Hafızası ve Bilgi Tabanı doldurma, iCal ile takvim, QR sohbet.
- **Neden:** Hospitable ücreti deneme öncesi bariyer. iCal yalnız müsaitlik taşıyor, mesaj taşımıyor, gecikmesi 30 dakikadan 12 saate (R03). Bu mod aktivasyonu bariyerden ayırır.
- **Risk:** Misafiri platform dışına taşımak Airbnb ve Booking kurallarına aykırı olabilir. Raporlarda bu konuda kaynak yok, yazılı olarak doğrulayın.
- **Ölçü:** Bağlantısız modda aktivasyon, bağlantılıya geçiş oranı.

**4. Hospitable bağlantı sihirbazı ve sağlık izleme (S–M)**
- **İçerik:** Adım adım PAT akışı (my.hospitable.com → Apps → API access), Read+Write kontrolü, token geçerlilik ve son senkron uyarısı. Kanal katmanını OAuth veya Channex'e geçişe hazır soyut tutun.
- **Neden:** Bağlantı aşaması en büyük düşüş noktası (Bölüm 4). OAuth Hospitable'ın tarafında bekliyor.
- **Ölçü:** Bağlantı tamamlama oranı, ortalama süre, token hatalı müşteri sayısı.

**5. Platform otomatik yanıtıyla çakışma koruması (S–M)**
- **Neden:** Airbnb otomatik yanıtı gönderici olarak Airbnb görünüyor, kademeli açılıyor (R07). Booking Auto-Reply küresel. İki gönderici müşteriye çelişkili cevap verebilir (Morphic'in "duplicate senders" uyarısı, satıcı kaynağı).
- **Belirsizlik:** Hospitable üzerinden hangi mesajın platform tarafından gönderildiğini ayırt edebiliyor muyuz bilmiyorum.
- **Ölçü:** Çakışan yanıt sayısı, ev sahibi şikâyeti.

**6. Düzenlemeden Mülk Hafızası'na geri besleme (M)**
- **İçerik:** Ev sahibi taslağı düzelttiğinde "bunu hafızaya ekleyelim mi" önerisi.
- **Neden:** Düzeltmenin kalıcı hale gelmesi satıcılar tarafından fark olarak sunuluyor (Morphic, satıcı iddiası). Mülk Hafızası V1'de.
- **Ölçü:** Aynı konuda tekrar düzeltilme oranı düşüşü, taslak kabul oranı eğilimi.

**7. Aylık değer özeti (S)**
- **İçerik:** E-posta veya dashboard: kaç mesaj, ortalama yanıt süresi, kabul edilen taslak sayısı.
- **Neden:** Müşteri Lixus'a ek olarak Hospitable'a da ödüyor, Lixus'un değerini görünür kılmak gerek. Dashboard'da AI özeti zaten var, bu ondan farklı olarak ücret gerekçesini gösteren bir çıktı.
- **Ölçü:** İlk 90 gün sonrası iptal oranı, özet açılma oranı.

**8. Müşteri başı AI ve API maliyet görünürlüğü, operatör paneli (S)**
- **Neden:** Gelir TL, maliyet USD (Hospitable $29, olası Channex $130 + $0,50/birim, LLM). Marjı bilmeden fiyat kararı verilemez. Raporlarda LLM maliyeti yok.
- **Ölçü:** Müşteri başı brüt marj. Kur duyarlılığı: 46 ve 49,5 ile.

**9. Mesajdan görev veya temizlik aksiyonu (M)**
- **Neden:** Platform mesajlaşması çoğunlukla yanıt odaklı, PMS bağlamı ve operasyon farklılaşma yolu (R07, ama TAHMİN). Görevler Kanban var. Mesaj→görev bağlantısı zaten varsa tekrar etmeyin.
- **Ölçü:** Mesajdan oluşturulan görev sayısı, görev tamamlanma süresi.

**10. Yönetim şirketi (çok sahipli) modu (L, sizin onayınız ve Hospitable ile netleşme gerek)**
- **Neden:** Çok ilan, tek anlaşma. Hospitable'ın "tek ana hesap → çoklu host" modeli mümkün (Patrick 07-02). Tenant izolasyonu yeniden tasarım gerektiriyor.
- **Ölçü:** Pilot sayısı, pilot başına ilan, izolasyon denetimi.
- **Sıra:** Kod yazmadan önce manuel pilot (tek tenant, ayrı mülk gruplaması) deneyin.

**Listeye almadıklarım:**
- **İzin belgesi takip kartı:** Düşük emek, ama değer kanıtı zayıf. 2 yılda bir denetim bilgisi birincil kaynaktan doğrulanmadı (R01).
- **Vergi veya kira geliri beyanı:** Danıştay/Maliye durumu kesinleşmemiş (R01), sorumluluk riski.
- **WhatsApp ve sesli kanal:** Kanıt zayıf, Türkiye kullanım verisi yok.

---

## 6) En büyük 5 risk

**R1. Kanal bağımlılığı.**
- **Neden:** Hospitable tek ana yol, OAuth bekleniyor, white-label yok. Airbnb doğrudan API davetle, 6 ay zorunlu özellik süresi var (R03). Booking onboarding duraklamış olabilir (zayıf kaynak). Hospitable'ın Lixus'a ihtiyacı olduğuna dair bir işaret yok, "dürtme yok" politikanız da bekleme süresini uzatır.
- **Önlem:** PAT yolunu sağlamlaştırın. Kanal katmanını soyutlayın. Channex sandbox'ına bakın ($130/ay + $0,50/birim; 50 birimde $155, 200 birimde $230 [H], mesajlaşma paketinin ücreti belirsiz). Tek sağlayıcıya kilitlenmeyin (R03).
- **Ölçü:** Hospitable'a bağlı müşteri payı, API hata oranı, OAuth durum tarihi.

**R2. İkame: platformlar ve PMS'ler.**
- **Neden:** Airbnb ve Booking otomatik yanıtı ücretsiz sunuyor, Hospitable'da AI zaten dahil (R02, R07). Düz SSS katmanı metalaşıyor. Bu çıkarım benim, ölçülmüş churn verisi yok (R07).
- **Önlem:** Türkçe kalitesini kanıtlayın, risk politikası ve operasyon bağlamıyla ayrışın (madde 1, 2, 9).
- **Ölçü:** Müşteri kaybında "platform kendi özelliğini kullanıyor" nedeni, deneme→ücretli oranı.

**R3. Toplam maliyet ve ödeme isteği.**
- **Neden:** Müşteri Lixus'un yaklaşık 3 katını Hospitable'a veriyor (Bölüm 3), Türkiye'de ödeme istekliliği verisi yok (R04). Hospitable yaygın değil (R05, R06).
- **Önlem:** Hospitable'sız giriş yolu, TCO şeffaflığı, $7/daire paketi için kanıt biriktirin.
- **Ölçü:** Bağlantı aşamasında düşüş oranı, 1:1 görüşmelerde toplam maliyetle ret noktası.

**R4. Kur ve marj.**
- **Neden:** Gelir TL sabit, maliyet USD. 46 varsayımı ile yaklaşık 49,5 arasında %7 fark var (R04). Gelir tarafında USD karşılığı Başlangıç'ta $9,76 → $9,07'ye düştü.
- **Önlem:** Maliyet görünürlüğü (madde 8), çeyreklik fiyat kuralı, yıllık plan vurgusu.
- **Ölçü:** Plan bazında brüt marj, kur duyarlılık tablosu.

**R5. Pazar daralması ve veri belirsizliği.**
- **Neden:** İlan sayısı yaklaşık %23 düştü, Antalya'da yıllık %−48,8, yeni izin akışı durmuş (R01, R06). İstanbul'da kaynaklar çelişiyor (Homesberg düşüş, Airbtics +%31). Veriler yaklaşık bir yıllık. Ev sahibi sayısı bilinmiyor.
- **Önlem:** İstanbul ve yıl boyu çalışan operatörlere öncelik. Kendi funnel'ınızdan segment verisi. Bakanlık başvurusu.
- **Ölçü:** Müşteri dağılımı şehir bazında, sezonluk iptal ve duraklatma oranı.

**Listenin dışında ama izleyin:** AI'ın yanlış yanıtı (ilkeniz bunu azaltıyor), KVKK, ve bir şey: `security@lixusai.com` posta kutusunun açılması bekleyen bir iş (ürün notu).

---

## 7) Kurucunun karar vermesi gereken sorular

**1. Hospitable'a mı bağlı kalacaksınız, Channex paralel mi çalışacak?**
- Neden önemli: R1'in doğrudan sonucu. Channex mesajlaşma paketi, Airbnb ve Booking mesajlaşma sınırları ve canlıya geçiş süresi için kaynak bulunamadı (R03).
- Ölçüt: İki hafta içinde Channex ve Rentals United'dan yazılı teklif ve kapsam cevabı.

**2. Toplam maliyeti (Hospitable dahil) fiyat sayfasında açıkça gösterecek misiniz?**
- Neden: Gizli maliyet algısını önler, ama ilk bakışta fiyatı yüksek gösterir.
- Ölçüt: P3 deneyi.

**3. Hospitable "sadece-API" paketi için ne zaman ve ne ile başvuracaksınız?**
- Neden: Patrick "trafik gösterince pilot" dedi, "trafik"in tanımını bilmiyoruz. "Dürtme yok" kararınızı koruyarak, bağlı müşteri verisini hazır tutup ne zaman paylaşacağınızı belirleyin.
- Ölçüt: Bağlı Hospitable hesabı sayısı için eşik (örn. kendi koyacağınız bir sayı).

**4. Hospitable bir deneme sunuyor mu?**
- Neden: "Kart yok 14 gün" deneme sözünüz, müşterinin Hospitable'a önceden ödemesi gerekiyorsa yanıltıcı olabilir.
- Ölçüt: Hospitable'dan yazılı teyit.

**5. Düşük riskli konularda otomatik gönderime izin verecek misiniz?**
- Neden: Hospitable yalnız en üst planda onaysız yanıt veriyor, Guesty ve Hostaway seçenek sunuyor (R02). R02 önce taslak, sonra düşük riskli konularda (Wi-Fi, check-in adımı) otomatiği öneriyor. İlkenize aykırı olabilir.
- Ölçüt: Kategori bazında taslak kabul oranı eşiği (örn. %95, siz belirleyin) tutarsa o kategoriyi açın.

**6. Önce hangi segment: 1–2