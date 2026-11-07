# 04-fiyat-kiyas

> Soru: Kısa dönem kiralama yazılımlarında ilan başına aylık fiyatlar (USD) ve Türkiye'deki ev sahiplerinin ödeme istekliliği; yerel SaaS fiyat örnekleri (TL). Karşılaştırma için: Lixus AI fiyatları Başlangıç ₺449/ay (1-2 daire), Pro ₺899/ay (3-7 daire), İşletme ₺1.699/ay (8-25 daire), USD/TRY ≈ 46. Bu fiyatların konumu ve önerilen fiyat deneyleri.

# Kısa dönem kiralama yazılımı fiyatları (USD/ilan) ve Türkiye'de ödeme istekliliği: Lixus AI fiyat konumu

**Veri notu.** Arama aracı oturum sırasında kota sınırına ulaştı. İlk arama turu tamamlandı, ikinci tur (Türkiye'ye özel SaaS fiyatları ve ilan sahibi dağılımı) yapılamadı. Bu yüzden Türkiye tarafında birkaç boşluk var ve bunları "kaynak bulunamadı" diye işaretledim. Kaynak sayfalarının tarihleri arama çıktısında "X gün önce" olarak geldi. Kesin yayın tarihi olmayanlarda bunu "sayfa yaşı" diye yazdım.

## Özet

- **Kur varsayımı güncel değil.** Wise sayfasında 1 USD = 49,57 TRY, Foreks'te yaklaşık 49,60 görünüyor. Sizin 46 varsayımınız yaklaşık %7 düşük kalıyor. 49,5 kuruyla Başlangıç ≈ $9,07, Pro ≈ $18,16, İşletme ≈ $34,32 ediyor. 46 kuruyla bunlar $9,76, $19,54 ve $36,93.
- **Lixus listing başına çok ucuz.** Ayrıntı bölümündeki hesaba göre listing başına tutar Başlangıç'ta yaklaşık $4,5–9,1, Pro'da $2,6–6,1, İşletme'de $1,4–4,3. Küresel rakiplerin listelenen girişleri tek ilanda $9 (Guesty Lite) ile $40 (OwnerRez) arasında. Lixus yalnızca Guesty Lite'ın listelenen tabanıyla aynı düzeyde, diğerlerinin altında kalıyor.
- **Hostaway'in resmi fiyatı yok.** Kaynaklar listing başına $15–50 aralığında dağılıyor ve çelişiyor. Düşük güvenilirlikle ele almak gerekir.
- **Yerel ödeme istekliliği için doğrudan anket kaynağı bulunamadı.** Dolaylı göstergeler var. Türkiye'de Airbnb yönetim komisyonu net gelirin %15–25'i, co-hosting'de %8–15. Küçük apartman yönetim yazılımı için bir blog 0–300 / 300–800 / 800+ TL bantlarını "tahmini" olarak veriyor. Bu blog zayıf bir kaynak.
- **Pazar küçülmüş ama hâlâ büyük.** Homesberg'e göre Ağustos 2025'te 85.169 aktif tüm-mülk ilanı var. Bunların 49.042'si minimum konaklama süresini 100 günün altında tutuyor.
- **Kademe sınırlarında fiyat sıçraması var.** 2. daireden 3. daireye geçişte toplam fiyat 449'dan 899 TL'ye çıkıyor (+%100). 7'den 8'e geçişte 899'dan 1.699 TL'ye çıkıyor (+%89). Bu, test edilmesi gereken bir kırılma noktası.
- **Önerilen deneyler:** Van Westendorp ve Gabor-Granger anketi, Başlangıç için canlı A/B testi, kademe sıçramasını yumuşatan hibrit (taban + listing başı) model, yıllık ön ödeme indirimi ve AI eklenti testi. Ayrıntılar aşağıda.

## 1) Küresel kısa dönem kiralama yazılımı fiyatları (USD/ilan/ay)

| Ürün | Listelenen fiyat | Notlar ve güvenilirlik | Kaynak (sayfa yaşı) |
|---|---|---|---|
| **Guesty Lite** | $9/ilan/ay'dan başlar, 14 gün deneme | Resmi sayfa. Pro planı ilan sayısına göre fiyatlanıyor ve rakam açıkça yazılmamış | guesty.com/pricing (8 gün önce) |
| Guesty (eski veri) | Lite $16/ilan/ay'dan | Üçüncü taraf, eski. Resmi sayfayla çelişiyor, onu esas almayın | stayfi.com Guesty fiyat yazısı (248 gün önce) |
| **Hostaway** | Resmi fiyat yok. Topluluk verisi 1–4 ilanda toplam ~$125–175/ay, 10+ ilanda ilan başı $15–25 | Bir kaynak, dolaşan rakamların $15–50/ay aralığında olduğunu ve hiçbirinin Hostaway sayfasına dayanmadığını söylüyor. Bir başka blog "$55/ay, 20 ilana kadar" diyor. Bu çelişkili ve güvenilmez | roommaster.com/blog/hostaway-pricing (82 gün önce); magicbnb.io (0 gün önce); rentalduel.com (49 gün önce) |
| **OwnerRez** | 1 ilan $40/ay, 5 ilan $88, 10 ilan $127, 50 ilan $378, 100 ilan $570. Rezervasyon komisyonu yok | Üçüncü taraf tablo. Capterra da $40'dan başlıyor diyor | truvi.com/blog/ownerrez-reviews (75 gün önce); capterra.com/p/100831 (22 gün önce) |
| **Hospitable** | Essentials $0 (sınırsız mülk). Ücretli planlar yaklaşık Host $29 (1 mülk), Professional $59 (2), Mogul $99 (3). Dinamik fiyatlama eklentisi $15/mülk/ay | Eklenti ve Legacy plan ($40 taban, 2 mülk dahil) resmi yardım sayfasında. Plan fiyatları üçüncü taraf | help.hospitable.com (34 gün önce); roommaster.com/blog/hospitable-pricing (82 gün önce) |
| **Smoobu** | Professional Pre-Paid: ilk mülk €35/ay, ek mülk €12/ay. Yıllıkta %10, 2 yıllıkta %20 indirim | Resmi destek sayfası, EUR cinsinden. Benim hesabım: 5 mülk = €83, 10 mülk = €143 | support.smoobu.com (tarih yok) |
| **Uplisting** | 5 ilana kadar ~$100/ay (£72), 6–40 ilanda ~$20/ilan (£16) | Üçüncü taraf | roommaster.com/blog/uplisting-pricing (82 gün önce) |
| **Lodgify** | Bir kaynak $16 / $35 / $59 (ilan başı, üç plan) diyor. Başka bir kaynak tüm planlar için $73 gösteriyor | İki kaynak çelişiyor, güven düşük. Kullanmadan önce resmi sayfadan doğrulayın | rentalduel.com (231 gün önce); costbench.com (46 gün önce) |

**Sonuç.** Resmi olarak doğrulanabilen tek net rakamlar Guesty Lite $9, Hospitable'ın eklenti ve Legacy planı, Smoobu ve OwnerRez'in başlangıç fiyatı. Diğerleri üçüncü taraf bloglara dayanıyor ve kesin sayılmamalı.

## 2) Lixus AI fiyatının konumu

Lixus fiyatları sizin verdiğiniz rakamlar, bağımsız doğrulama yapmadım. Hesaplar benim, kaynak rakamlar yukarıda.

| Plan | TL/ay | USD @46 | USD @49,5 | TL/ilan | USD/ilan @49,5 |
|---|---|---|---|---|---|
| Başlangıç (1–2) | 449 | 9,76 | 9,07 | 224,5–449 | 4,54–9,07 |
| Pro (3–7) | 899 | 19,54 | 18,16 | 128,4–299,7 | 2,59–6,05 |
| İşletme (8–25) | 1.699 | 36,93 | 34,32 | 68,0–212,4 | 1,37–4,29 |

**Yan yana (aynı portföy büyüklüğünde, USD @49,5):**

- **1 ilan.** Lixus $9,07. Guesty Lite $9. Hospitable Host ~$29. OwnerRez $40. Smoobu €35.
- **5 ilan.** Lixus Pro $18,16 (~$3,6/ilan). OwnerRez $88 (~$17,6/ilan). Smoobu €83. Uplisting ~$100. Guesty Lite 5×$9 = $45 (liste fiyatından benim hesabım).
- **10 ilan.** Lixus İşletme $34,32 (~$3,4/ilan). OwnerRez $127. Smoobu €143. Guesty Lite 10×$9 = $90.

**Yorum.**
- Lixus tek ilanda Guesty Lite ile aynı hizada. 5 ve 10 ilanda küresel rakiplerin kabaca beşte biri ile yarısı arasında kalıyor. Bu, TL maliyet yapısına uygun, kesin agresif bir konum.
- Karşılaştırma yalnızca fiyat üzerinden. Lixus'un özelliklerini (kanal yöneticisi kapsamı, AI işlevleri, Türkiye'ye özel yasal belge desteği) bilmiyorum. Aynı kalemleri karşılaştırdığımızı varsaymayın.
- **Kur riski.** 449 TL, 46 kurunda $9,76 ediyordu, 49,5 kurunda $9,07. USD karşılığı yaklaşık %7 erimiş durumda. TL fiyatı sabit tutarsanız dolar geliri düşer. Kur kaynakları: Wise (tarih yok), Foreks (43 gün önce), autr.tr (29 gün önce, 49,22–49,29).

## 3) Türkiye'de ödeme istekliliği: bulunan dolaylı göstergeler

- **Doğrudan ödeme istekliliği anketi veya Türkiye'deki STR yazılımı TL fiyat listesi: kaynak bulunamadı.** Paraşüt, Logo ve benzeri yerel SaaS fiyatlarını da aramam kota nedeniyle yapılamadı, bunlar için de kaynak bulunamadı.
- **Yönetim hizmeti komisyonu.** Pera Homes'a göre tam kapsamlı Airbnb yönetimi net gelirin %15–25'i, co-hosting %8–15 (perahomes.com.tr, 20 gün önce). Hanemo'nun dilimli tarifesinde "Profil Yönetimi" %10, "Tam Yönetim" %20'ye kadar iniyor. Aylık 2.500 EUR ciroda örnek komisyon 310 EUR ve 620 EUR (hanemo.com/fiyatlar, 485 gün önce, eski). Bu rakamlar, ev sahiplerinin yönetim hizmetine gelirin yüzde onlarını ödemeye alışık olduğunu gösteriyor. Yazılım için ödeme eşiği bundan çok daha düşük olabilir. Bu bir **TAHMİN**, dayanağı bu iki komisyon rakamı ve yazılımın hizmetten daha ucuz bir ikame olması.
- **Yerel yazılım fiyat bandı (zayıf kaynak).** Bir blog küçük apartman yönetim yazılımı için "tahmini" olarak 0–300 TL (giriş), 300–800 TL (orta), 800 TL+ (üst) bantlarını veriyor (siteyonetimi.org, 107 gün önce). Bu STR yazılımı değil, apartman aidat yazılımı. Kaynak da SEO blogu. **TAHMİN:** Lixus Başlangıç (449 TL) bu ölçekte orta banda, Pro (899 TL) üst banda, İşletme (1.699 TL) üst bandın da üstüne denk geliyor. Tek ilan sahipleri için fiyat sürtünmesi en çok Başlangıç'ta olabilir.
- **Pazar büyüklüğü.** Homesberg'e göre Ağustos 2025'te Türkiye'de 85.169 aktif tüm-mülk ilanı var. Bunların 49.042'si 100 günün altı konaklamaya açık, 36.127'si 100 gün üstü (homesberg.com/airbnb-yasasi-7464-turkiye-2025, 391 gün önce). En çok ilan Antalya'da (25.121), sonra İstanbul (20.908) ve Muğla (18.133). Aynı sitenin başka bir yazısına göre 1 Ocak 2024'te yaklaşık 110.000 aktif ilan vardı (homesberg.com/airbnb-turkiye-kapaniyor-mu, 390 gün önce). Yani 7464 sayılı yasa sonrası pazar küçüldü.
- **Ev sahibi başına ilan sayısı dağılımı: kaynak bulunamadı.** 1–2, 3–7 ve 8–25 kademe sınırlarının pazara uyup uymadığını bu veriyle doğrulayamıyorum. Önce kendi müşteri verinizden çıkarın.
- **KDV oranı ve fiyatların KDV dahil/hariç gösterimi için kaynak bulunamadı.** Yayın fiyatınız KDV dahil mi, değil mi, netleştirin. Bu hem algıyı hem marjı etkiler.

## 4) Önerilen fiyat deneyleri

**Deney 1: Ödeme istekliliği anketi (Van Westendorp + Gabor-Granger).**
- Hedef: Türkiye'de 1–2, 3–7 ve 8–25 ilanlı ev sahipleri, segment başına en az 100 yanıt.
- Fiyatları TL ve KDV dahil gösterin. Plan özelliklerini kısa ve sabit tutun.
- Sonuç: kabul edilebilir fiyat aralığı ve gelir-maksimize noktası. Küresel rakip fiyatlarını anket dışında bir referans olarak tutun.

**Deney 2: Başlangıç planı için canlı A/B/C testi (yeni ziyaretçiler, rastgele).**
- Kollar: ₺349 / ₺449 / ₺599 (**TAHMİN**, aralık bu raporun karşılaştırmalarından türetildi: Guesty Lite ≈ ₺445 civarı ve yerel "orta segment" tavanı 800 TL).
- Ölçütler: denemeden ücretliye geçiş, ARPA, 90 gün elde tutma, brüt marj.
- Örneklem hesabı (benim, standart yaklaşım): temel dönüşüm %5 ve +1 puanlık farkı yakalamak için kol başına yaklaşık 7.600 ziyaretçi gerekir. Fark 2 puansa yaklaşık 1.900. Trafik düşükse Bayesçi veya ardışık test kullanın, ya da yalnızca büyük farkları test edin.

**Deney 3: Kademe sıçramasını test edin (hibrit fiyatlama).**
- Mevcut yapıda 3. ilan eklemek toplamı +%100 artırıyor, ilan başı fiyat 224,5 TL'den 299,7 TL'ye çıkıyor. 8. ilanda ilan başı 128,4 TL'den 212,4 TL'ye çıkıyor.
- Alternatif kol: taban ücret + ilan başı ücret (örneğin Smoobu modeli: ilk mülk + ek mülk başına daha düşük ücret). Ölçüt: 2→3 ve 7→8 ilan geçişinde plan yükseltme veya kayıp oranı, ilan başı gelir.

**Deney 4: Yıllık ön ödeme indirimi.**
- Smoobu yıllıkta %10, 2 yıllıkta %20 indirim veriyor. Kolları: indirimsiz / %10 / %15 yıllık.
- Amaç, kur erimesine ve TL enflasyonuna karşı gelir kilitlemek. Ölçüt: yıllık planı seçme oranı ve nakit akışı etkisi.

**Deney 5: Deneme ve ücretsiz plan.**
- Hospitable ücretsiz bir Essentials planı sunuyor. Guesty ve Smoobu'nun ise 14 günlük denemesi var.
- Kollar: 14 gün deneme / sınırlı ücretsiz plan (1 ilan, temel özellik). Ölçüt: ücretliye geçiş, destek maliyeti, ücretsiz kullanıcıların yükseltme oranı.

**Deney 6: AI özelliğini eklenti olarak fiyatlayın.**
- Rakip örneği: Hospitable dinamik fiyatlamayı $15/mülk/ay eklenti olarak satıyor. Hostaway için de eklenti ücretleri raporlanmış (kaynak güvenilirliği düşük).
- Kollar: pakete dahil / ayrı eklenti (**TAHMİN** başlangıç aralığı ₺99–249/ilan/ay, dayanağı Hospitable'ın $15 eklentisi ve yerel ödeme istekliliğinin daha düşük olması varsayımı). Ölçüt: eklenti benimseme oranı ve bu eklentinin planlar arası yükseltmeyi etkileyip etkilemediği.

**Deney 7: Kur koruma.**
- Seçenekler: (a) TL fiyatı sabit, çeyreklik gözden geçirme; (b) USD'ye endeksli, TL olarak gösterim; (c) yıllık sabit fiyat. Önce müşteri tepkisini küçük bir yeni müşteri grubunda ölçün. Kur yaklaşık 49,5, 46 varsayımına göre %7 farklı. Bu fark her çeyrek büyürse marjınızı etkiler.

**Önerilen sıra:** (1) kur varsayımını güncelleyin, (2) kendi müşteri verinizle kademe dağılımını çıkarın, (3) Deney 1 anketi, (4) Deney 3 ve 2'yi paralel yürütün, (5) 4–6'yı sonraki çeyreğe bırakın.

## Kaynaklar

- Guesty fiyatlandırma (resmi): https://www.guesty.com/pricing/ (8 gün önce)
- Guesty eski fiyat yazısı (StayFi): https://stayfi.com/vrm-insider/2025/04/03/guesty-pricing-is-it-worth-the-investment/ (248 gün önce)
- Hostaway fiyat, Roommaster: https://www.roommaster.com/blog/hostaway-pricing (82 gün önce)
- Hostaway fiyat, MagicBnB: https://magicbnb.io/blog/hostaway-pricing-2026 (0 gün önce)
- Hostaway fiyat, RentalDuel: https://rentalduel.com/blog/hostaway-pricing-review (49 gün önce)
- OwnerRez, Truvi: https://truvi.com/blog/ownerrez-reviews/ (75 gün önce)
- OwnerRez, Capterra: https://www.capterra.com/p/100831/OwnerRez/ (22 gün önce)
- Hospitable resmi yardım: https://help.hospitable.com/en/articles/4596748-hospitable-pricing-subscription-costs (34 gün önce)
- Hospitable plan fiyatları, Roommaster: https://www.roommaster.com/blog/hospitable-pricing (82 gün önce)
- Smoobu resmi destek: https://support.smoobu.com/hc/en-us/articles/360003170680-How-much-does-Smoobu-cost-Plans-and-pricing-explained (tarih yok)
- Uplisting, Roommaster: https://www.roommaster.com/blog/uplisting-pricing (82 gün önce)
- Lodgify, RentalDuel: https://rentalduel.com/blog/lodgify-pricing-breakdown (231 gün önce)
- Lodgify, Costbench: https://costbench.com/software/vacation-rental-software/lodgify/ (46 gün önce)
- USD/TRY, Wise: https://wise.com/tr/currency-converter/dolar-kuru (tarih yok)
- USD/TRY, Foreks: https://www.foreks.com/dolar/ (43 gün önce)
- USD/TRY, autr.tr: https://autr.tr/doviz/anlik-dolar-kuru (29 gün önce)
- Pera Homes, yönetim komisyonu: https://perahomes.com.tr/airbnb-yonetimi-nedir (20 gün önce)
- Hanemo fiyatlar: https://hanemo.com/fiyatlar/ (485 gün önce)
- Apartman yönetim yazılımı bantları (zayıf kaynak): https://siteyonetimi.org/blog/kucuk-apartmanlar-icin-uygun-fiyatli-yazilim (107 gün önce)
- Homesberg, ilan sayıları (Ağustos 2025): https://www.homesberg.com/airbnb-yasasi-7464-turkiye-2025/ (391 gün önce)
- Homesberg, yasa sonrası kapanmalar: https://www.homesberg.com/airbnb-turkiye-kapaniyor-mu/ (390 gün önce)

**Bulunamayan kaynaklar:**
- Türkiye'ye özel STR yazılımı TL fiyat listesi
- Yerel SaaS TL fiyat örnekleri (Paraşüt, Logo vb.)
- Ev sahibi başına ilan sayısı dağılımı
- Doğrudan ödeme istekliliği anketi
- KDV oranı doğrulaması
