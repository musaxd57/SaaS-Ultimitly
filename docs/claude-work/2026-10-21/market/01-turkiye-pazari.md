# 01-turkiye-pazari

> Soru: Türkiye kısa dönem kiralama (Airbnb, Booking) pazarı 2025-2026: aktif ilan sayıları ve şehir dağılımı, 7464 sayılı kanun ve kısa dönem kiralama izin belgesi uygulaması, vergi / belediye yükümlülükleri, kanunun ev sahibi sayısına etkisi, profesyonel işletmeci (5+ daire) oranı. Sayılara kaynak ve tarih ver.

# Türkiye kısa dönem kiralama pazarı (2025-2026)

**Rapor notu:** Kaynak sayfalardaki tarihlerden bugünün Ekim 2026 civarı olduğunu anlıyorum. Web arama kotam doldu, bu yüzden bazı başlıkları (belediye yükümlülükleri, Booking.com'a özgü veri) derinleştiremedim. Bu boşlukları metinde belirttim.

## Özet

- **İlan sayısı düşüyor, ama ölçüm kaynakları birbirini tutmuyor.** Homesberg'e göre Ocak 2024'te yaklaşık 110.000 olan aktif ilan sayısı, Ağustos 2025'te 85.169'a indi. Bu, yaklaşık %23 düşüş demek (düşüşü ben hesapladım).
- **İzin belgesi sayısı 2024'ten 2025'e arttı ama kaynaklar çelişiyor.** Belge sayısı 22.939 ile 42.207 arasında değişen rakamlarla veriliyor. Tek bir resmî güncel seri bulamadım. Belgeli konutların ilanlara oranı kabaca %36-50 aralığında (TAHMİN, hesabımı aşağıda gösterdim).
- **Şehir dağılımında Muğla ve Antalya izin belgesinde öne çıkıyor.** Muğla 6.573, Antalya 4.899, İstanbul 2.250 belge aldı (2024 sonu, Bakanlık verisi, Milliyet, 5 Ocak 2025). İlan sayısında ise İstanbul en büyük pazar.
- **Antalya'da arz yarıya indi.** AirDNA'ya göre Ağustos 2026'da 14.231 aktif ilan var ve yıllık değişim %-48,8.
- **Vergi tartışması Danıştay'a taşındı.** Danıştay, ek otel hizmeti olmayan kısa süreli kiralamayı ticari kazanç saymadı, kira geliri (GMSİ) saydı. Kesinleşme ve Maliye'nin itirazı konusunda kaynak bulunamadı.
- **Ev sahibi sayısına etki doğrudan ölçülmemiş.** Ev sahibi sayısı için kaynak bulunamadı. Elimde yalnızca ilan sayısı ve belge iptal verileri var.
- **5+ daire işletmeci oranı için kaynak bulunamadı.** Yalnızca dolaylı veriler var: İstanbul'da ilk 10 host pazarın %6,3'ünü kontrol ediyor ve AirROI'ye göre profesyonel yönetim oranı %2,1.

---

## 1. Aktif ilan sayıları ve şehir dağılımı

### 1.1 Ülke geneli

| Gösterge | Değer | Kaynak / tarih |
|---|---|---|
| Aktif ilan (yalnızca tüm konut) | 85.169 | Homesberg, Ağustos 2025 verisi: https://www.homesberg.com/airbnb-yasasi-7464-turkiye-2025/ |
| Kanun öncesi aktif ilan | ~110.000 (1 Ocak 2024) | Homesberg: https://www.homesberg.com/airbnb-turkiye-kapaniyor-mu/ (makale tarihi belirsiz, metne göre Ocak 2024'ten ~5 ay sonra) |
| Aynı dönemde kapanan / 100 gün+ minimum konaklamaya geçen | ~28.000 kapandı, ~5.000'i 100 gün üstüne çıktı | Aynı Homesberg makalesi |
| Minimum konaklaması 90 günü aşan ilan (Türkiye) | 32.161 | Homesberg Kasım 2025 raporu: https://www.homesberg.com/kasim-2025-airbnb-turkiye-raporu-pazar-artik-buyumuyor-temizleniyor/ |

**Platform ayrımı:** Booking.com'a özgü ilan sayısı için kaynak bulunamadı. AirDNA'nın sayımı Airbnb, Vrbo ve Booking.com'u birlikte kapsıyor ve aynı evi tekilleştiriyor (https://www.airdna.co/vacation-rental-data/app/tr/default/antalya/overview, Ağustos 2026).

### 1.2 Şehir bazında ilan sayıları (kaynaklar uyuşmuyor)

| Şehir | Rakam | Kaynak / tarih | Not |
|---|---|---|---|
| İstanbul | 20.518 toplam ilan | Homesberg veri portalı, tarih belirtilmemiş: https://data.homesberg.com/app/vacation-rental-data/turkiye/istanbul | Tarihsiz |
| İstanbul | 13.076 aktif ilan (+%31 yıllık) | Airbtics, 12 Mart 2026: https://airbtics.com/annual-airbnb-revenue-in-istanbul-turkey/ | Yalnızca Airbnb |
| İstanbul | 45.000 (kanun öncesi) | Patronlar Dünyası, 11 Ağustos 2023: https://www.patronlardunyasi.com/airbnb-otelleri-zor-duruma-dusurmeye-devam-ediyor-istanbulda-45-bin-konut-airbnbde | Kanun öncesi baz |
| İstanbul (Beyoğlu ilçesi) | 4.280 aktif ilan; Kadıköy 851 | AirROI, ~Nisan 2026: https://www.airroi.com/airbnb-data/turkey | İlçe düzeyi |
| Antalya | 14.231 aktif ilan; yıllık %-48,8 | AirDNA, Ağustos 2026: https://www.airdna.co/vacation-rental-data/app/tr/default/antalya/overview | Üç platform, tekilleştirilmiş |
| Antalya | 2.593 aktif ilan | Airbtics, 3 Ekim 2025: https://airbtics.com/annual-airbnb-revenue-in-antalya-turkey/ | Kapsam farkı nedeniyle AirDNA ile uyumsuz |
| Antalya | 27.619 (kanun öncesi) | Turizm Gazetesi, 15 Ağustos 2023: https://www.turizmgazetesi.com/haber/otellere-rakip-olma-yolundaki-airbnb-vb-sistemler-yayiliyor-nerede-kac-ev-var-fiyatlari-ne/85464 | AirDNA'dan aktarım |
| Bodrum | 6.784 (kanun öncesi) | Aynı Turizm Gazetesi haberi | Kanun öncesi |
| Muğla | 17.215 | Homesberg Ekim 2025 raporu: https://www.homesberg.com/ekim-2025-airbnb-turkiye-raporu-istanbul-direncli-sezonun-son-etkileri-ve-izin-belgesi-iptalleri/ | Tablo başlığı çıkarımla "ilan sayısı" okundu (TAHMİN) |
| İzmir | 4.823 | Aynı rapor | Aynı çıkarım (TAHMİN) |

**Yorum (TAHMİN):** İstanbul için 13 bin ile 20 bin arasındaki fark ve Antalya için 2,6 bin ile 14,2 bin arasındaki fark gerçek bir pazar farkı değil. Kaynakların "aktif ilan" tanımı ve kapsamı farklı (tek platform / çok platform, coğrafi sınır, filtre). İlk kez ölçülen pazar büyüklüğü olarak tek bir rakama güvenmeyin. Yönü gösteren veri, aynı kaynağın zaman serisi.

### 1.3 İzin belgeli konutların il dağılımı (2024 sonu)

Kaynak: Milliyet, Kültür ve Turizm Bakanlığı verileri, 5 Ocak 2025 (https://www.milliyet.com.tr/ekonomi/turizm-izin-belgeli-kiralik-konut-sayisi-22-bin-oldu-7275459). Türkiye toplamı 22.939.

| İl | Belgeli konut |
|---|---|
| Muğla | 6.573 |
| Antalya | 4.899 |
| İstanbul | 2.250 |
| İzmir | 1.959 |
| Edirne | 1.235 |
| Balıkesir | 1.161 |
| Trabzon | 693 |
| Aydın | 660 |
| Çanakkale | 535 |
| Kocaeli | 366 |
| Mersin | 356 |
| Ankara | 203 |
| Bursa | 138 |
| Rize | 69 |

İstanbul ilan sayısında en büyük pazar olsa da belge sayısında Muğla ve Antalya'nın gerisinde. Bu, uyum oranının İstanbul'da düşük olduğuna işaret ediyor olabilir (TAHMİN). Doğrulayan bir kaynak bulamadım.

---

## 2. 7464 sayılı kanun ve izin belgesi uygulaması

**Kanunun çerçevesi**
- Kanun 2 Kasım 2023 tarihli, 32357 sayılı Resmî Gazete'de yayımlandı (https://www.fatiharas.com/konutlarin-turizm-amacli-kiralanmasi-ve-vergilendirme/). 1 Ocak 2024'te yürürlüğe girdi (https://hukukcularevi.com/konutun-kisa-sureli-gunubirlik-kiraya-verilmesi-ve-kat-mulkiyeti/).
- Tek seferde 100 gün veya daha kısa süreli kiralamalar kapsamda; 100 günden uzun kiralamalar kapsam dışı (mevzuat.gov.tr, kanun metni: https://mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=7464&MevzuatTertip=5).
- Üçten fazla bağımsız bölümü olan binalarda, aynı kiraya veren adına en fazla %25 oranında belge düzenlenebiliyor (Bakanlık kılavuzu: https://istanbul.ktb.gov.tr/Eklenti/130313,kilavuzpdf.pdf?0=).
- Başvuruda kat maliklerinin oybirliği kararı isteniyor (https://baf.av.tr/yeni-airbnb-kanunu/). Girişe plaket asılması zorunlu.
- Kimlik bildirme yükümlülüğünde izin belgesi sahibi sorumlu kabul ediliyor (kanun metni, mevzuat.gov.tr).

**Yaptırımlar**
- İzin belgesiz kiralamada konut başına 100.000 TL idari para cezası (Tourism Today, Ocak 2025: https://www.tourismtoday.net/turizm-haberleri/guncel/turizm-amacli-kiralanan-izin-belgeli-konut-sayisi-22-bin-939-oldu).
- Faaliyete devam edenlere her seferinde 1.000.000 TL ceza uygulanıyor (Fatih Aras, 2026 makalesi, yukarıdaki URL). Güncel ceza tutarlarını resmî kaynaktan teyit etmenizi öneririm.

**Uygulama verileri**

| Tarih | Veri | Kaynak |
|---|---|---|
| Ağustos 2024 | 88.730 başvuru, 37.172 belge (başvurunun ~%41,9'u, ben hesapladım) | AA/Yıllık Program aktaran Finanstaksi, 30 Ekim 2024: https://finanstaksi.com/haberler/turizmde-yeni-donem-37-bin-konut-kisa-sureli-kiralama-izni-aldi/22383 |
| 2024 sonu (ilk yıl) | 22.939 belgeli konut | Milliyet, 5 Ocak 2025 (yukarıdaki URL) |
| 1 Ocak 2025 | Geçici belgelerin süresi doldu; tek günde 10.136 belge iptal oldu, yıla 30.938 ile girildi | Homesberg, 2025: https://www.homesberg.com/airbnb-yasasi-7464-turkiye-2025/ |
| ~Eylül 2025 | 42.207 belgeli konut (Bakanlık verisi olarak aktarılıyor, yılbaşından +%36) | Aynı Homesberg makalesi |
| Ağustos-Ekim 2025 | Homesberg tablosunda toplam kayıt 30.747 → 30.888 → 30.988; aylık yeni 844/518/481, iptal 377/381/226 | Homesberg Ekim 2025 raporu |
| Kasım 2025 | Yeni izin kaydı en düşük ay olarak raporlandı (rakam tabloda kesik) | Homesberg Kasım 2025 raporu |

**Çelişki:** 22.939 (2024 sonu), 30.938 (1 Ocak 2025), 37.172 (Ağustos 2024) ve 42.207 (~Eylül 2025) rakamları aynı seriye ait görünmüyor. Ağustos 2024'te belge sayısı (37.172), yıl sonu rakamından (22.939) yüksek. Geçici belgelerin sayılıp sayılmadığı da net değil. Resmî ve güncel bir seri bulunamadı.

**Belge/ilan oranı (TAHMİN, kendi hesabım):** 42.207 ÷ 85.169 ≈ %49,6. Homesberg'in Ekim 2025 tablosundaki ~31.000 kayıtla hesaplarsanız ≈ %36. Paydadaki ilan sayısı Airbnb kaynaklı, paydadaki belgeler tüm platformlar ve doğrudan kiralamalar için de geçerli olabilir. Bu yüzden oranı yalnızca kabaca bir uyum göstergesi olarak okuyun.

**Yönetmelik değişikliği:** Lebib Yalkın Hukuk, 10 Ekim 2025 tarihli, 33043 sayılı Resmî Gazete'de yayımlanan değişikliğin iki yılda bir belge ve konut denetimi getirdiğini aktarıyor (https://lebibyalkin.com.tr/makale/kisa-sureli-kiralamalarda-vergi-rejimi-degisiyor-airbnb-ve-benzeri-platformlara-iliskin-danistay-karari). Birincil metni doğrulamadım.

---

## 3. Vergi ve belediye yükümlülükleri

### 3.1 Vergi

- **Gelir türü tartışması:** GİB, 24 Ocak 2025 tarihli 7877 sayılı genel yazıyla izinli konut sahiplerini ticari organizasyon kurmuş saymayı öngördü (https://www.muhasebetr.com/yazarlarimiz/firatinsel/085/).
- Ticari kazanç sayılırsa yükümlülükler: fatura, %20 KDV, %2 konaklama vergisi, geçici vergi ve yıl sonu gelir vergisi (https://or.av.tr/airbnb-karari-kisa-sureli-konut-kiralamasi/).
- **Danıştay:** Danıştay 3. Dairesi'nin 14.04.2025 tarihli kararı (E.2024/6160, K.2025/1856) bu yaklaşımı reddetti (Lebib Yalkın, yukarıdaki URL). Yeni Şafak'a göre Danıştay 3. ve 7. Daireleri müşterek kararla yürütmeyi durdurdu. Gerekçe: ticari organizasyon için kahvaltı, ütü, günlük temizlik gibi ek hizmet gerekir (https://www.yenisafak.com/galeri/gundem/evini-kisa-sureli-kiraya-verenlere-danistaydan-vergi-karari-4829818).
- Mersin Gazetesi (20 Temmuz 2026) kararı, bu gelirlerin KDV, konaklama vergisi, ticari kazanç ve geçici vergiye tabi olmayıp yalnızca kira geliri (GMSİ) sayılacağı şeklinde aktarıyor (https://mersingazetesi.com/index.php/2026/07/20/danistaydan-airbnb-karari-kdv-ve-konaklama-vergisi-yok/).
- **Belirsizlik:** Or Hukuk, Maliye'nin Danıştay Vergi Dava Daireleri Kurulu'na itiraz etmesinin beklendiğini yazıyor. İtirazın sonucu ve kararın güncel kesinleşme durumu için kaynak bulunamadı. Kararlar ek hizmet bulunmayan bireysel ev sahipleri için geçerli. Otel benzeri hizmet sunan işletmeciler farklı değerlendirilebilir (https://baf.av.tr/airbnb-vergi-incelemesi/).

**Kira geliri (GMSİ) tarafı**
- 2025 gelirleri için konut kira geliri istisnası 47.000 TL (PwC Vergi Bülteni 2026/10, 27 Şubat 2026: https://www.pwc.com.tr/tr/Hizmetlerimiz/vergi/vergi-bultenleri/2026/2025-yili-kira-gelirlerinin-beyani.pdf).
- Diğer gelirleri 2025 için 1.200.000 TL'yi aşanlar istisnadan yararlanamıyor (aynı bülten).
- Kısa süreli konut kiralamalarında tahsilat ve ödemelerin tutardan bağımsız olarak banka veya PTT belgesiyle yapılması gerekiyor (Boğaziçi Denetim, 2024: https://www.bbdas.com.tr/2024-14-konutlarin-turizm-amacli-kiralanmalarinda-vergisel-yukumlulukler-b-2555).
- Turizm payı: kira gelirleri üzerinden on binde beş (%0,05). Aynı kaynak.
- Aynı sitede "bazı konut kira gelirlerinde istisna kaldırılıyor" başlıklı 2025-15 sayılı makale listelenmiş. İçeriğine ulaşamadım. İstisnanın gelecekteki durumu için kaynak bulunamadı.

### 3.2 Belediye ve diğer yükümlülükler

- İzin belgesini Bakanlık veya il kültür ve turizm müdürlüğü düzenliyor (Bakanlık kılavuzu). Belediye ruhsatı, emlak vergisi veya çevre temizlik vergisi konusunda kısa süreli kiralamaya özgü bir kural **kaynak bulunamadı**.
- Konut sitesi ve apartman düzeyinde yönetim planı ve kat maliklerinin oybirliği şartı fiilen en büyük yerel engel. Ayrıca yönetim planı ve kat mülkiyeti belgeleri başvuruya ekleniyor (Bakanlık kılavuzu).
- İlanlarda ve girişte plaket zorunlu.
- Baf Hukuk, VERBİS zorunluluğunu, acentalar dışında aracılık ve komisyon faaliyetinin yasaklanmasını ve alt kiralama yasağını sayıyor (https://baf.av.tr/yeni-airbnb-kanunu/). Birincil metinden doğrulamadım.

---

## 4. Kanunun ev sahibi sayısına etkisi

**Doğrudan ev sahibi sayısı verisi:** kaynak bulunamadı. Aşağıdakiler yalnızca dolaylı göstergeler.

- Ocak 2024'ten ~5 ay sonra yaklaşık 28.000 ilan kapandı, ~5.000 ilan 100 gün üstü minimum konaklamaya geçti (Homesberg, yukarıdaki URL).
- Ocak 2024 ~110.000 → Ağustos 2025 85.169: yaklaşık %-23 (kendi hesabım).
- Antalya'da AirDNA'ya göre Ağustos 2025'ten Ağustos 2026'ya aktif ilan %-48,8, gelir +%141,5, doluluk +%29,5 (AirDNA, Ağustos 2026). Arz azalırken kalan ilanlar daha çok kazanıyor.
- Homesberg'in Kasım 2025 raporu başlığıyla pazarın "artık büyümediğini, temizlendiğini" söylüyor.
- İzin belgelerinde ev sahiplerinin kendi isteğiyle yaptığı iptaller de var (Homesberg Ekim 2025 raporu: Ağustos-Ekim arası aylık 226-381 iptal).
- İstanbul'da ilan sayısı ise Airbtics'e göre Ocak 2026'da yıllık %+31 arttı. Yani etki bölgeye göre farklı.

**Not:** İlanlardaki düşüşün ne kadarı gerçek ev sahibi çıkışı, ne kadarı "hayalet" ilanların temizlenmesi, ayıramıyorum. Homesberg uzun süredir pek çok ilanın fiilen satış üretmediğini söylüyor (Kasım 2025 raporu).

---

## 5. Profesyonel işletmeci (5+ daire) oranı

**5+ daire eşiğinde doğrudan oran: kaynak bulunamadı.**

Dolaylı veriler:
- İstanbul'da ilk 10 host 1.283 ilanı, yani pazarın %6,3'ünü kontrol ediyor. En büyük host 403 ilanla öne çıkıyor (Homesberg veri portalı, tarihsiz). Bu, 5+ oranının **alt sınırı** olamaz; yalnızca ilk 10 host'un payı. Eşiği aşan tüm host'ların toplamı bundan büyüktür (TAHMİN, mantıksal çıkarım).
- AirROI, İstanbul'da ilanların %2,1'inin profesyonel yönetimde olduğunu bildiriyor (https://www.airroi.com/airbnb-data/turkey/istanbul/istanbul, ~Temmuz 2026). Aynı sayfa İstanbul için 1.122 aktif ilan gösteriyor, ki bu diğer kaynaklardan çok düşük. Kapsam sorunlu olduğu için bu oranı zayıf kanıt sayın.
- Düzenleme tarafı: aynı binada %25 sınırı ve aynı kiraya veren adına beşten fazla bağımsız bölümde başvuruda ek şartlar var (https://www.tahanci.av.tr/konutlarin-turizm-amacli-kiralanmasi/). Yani 5+ eşiği kanunda da anlamlı. Ancak bu eşiğe göre bir sayım yayımlanmış görünmüyor.

**Önerim:** 5+ oranı için Bakanlık'tan belge sahibi başına konut dağılımı talep edilebilir (bilgi edinme başvurusu) ya da AirDNA / Homesberg / AirROI gibi ücretli veri kaynaklarından host başına ilan dağılımı satın alınabilir.

---

## Kaynaklar

1. Homesberg, "Airbnb Yasası Piyasaları Ne Kadar Değiştirdi? 2025" (Ağustos 2025 verisi): https://www.homesberg.com/airbnb-yasasi-7464-turkiye-2025/
2. Homesberg, "Airbnb Türkiye Kapanıyor mu?" (2024, tarih belirsiz): https://www.homesberg.com/airbnb-turkiye-kapaniyor-mu/
3. Homesberg, Ekim 2025 raporu: https://www.homesberg.com/ekim-2025-airbnb-turkiye-raporu-istanbul-direncli-sezonun-son-etkileri-ve-izin-belgesi-iptalleri/
4. Homesberg, Kasım 2025 raporu: https://www.homesberg.com/kasim-2025-airbnb-turkiye-raporu-pazar-artik-buyumuyor-temizleniyor/
5. Homesberg veri portalı, İstanbul (tarihsiz): https://data.homesberg.com/app/vacation-rental-data/turkiye/istanbul
6. AirDNA, Antalya (Ağustos 2026): https://www.airdna.co/vacation-rental-data/app/tr/default/antalya/overview
7. Airbtics, İstanbul (12 Mart 2026): https://airbtics.com/annual-airbnb-revenue-in-istanbul-turkey/
8. Airbtics, Antalya (3 Ekim 2025): https://airbtics.com/annual-airbnb-revenue-in-antalya-turkey/
9. AirROI, Türkiye (~Nisan 2026): https://www.airroi.com/airbnb-data/turkey
10. AirROI, İstanbul (~Temmuz 2026): https://www.airroi.com/airbnb-data/turkey/istanbul/istanbul
11. Milliyet, 5 Ocak 2025: https://www.milliyet.com.tr/ekonomi/turizm-izin-belgeli-kiralik-konut-sayisi-22-bin-oldu-7275459
12. Tourism Today (Ocak 2025): https://www.tourismtoday.net/turizm-haberleri/guncel/turizm-amacli-kiralanan-izin-belgeli-konut-sayisi-22-bin-939-oldu
13. Finanstaksi / AA, 30 Ekim 2024: https://finanstaksi.com/haberler/turizmde-yeni-donem-37-bin-konut-kisa-sureli-kiralama-izni-aldi/22383
14. Patronlar Dünyası, 11 Ağustos 2023: https://www.patronlardunyasi.com/airbnb-otelleri-zor-duruma-dusurmeye-devam-ediyor-istanbulda-45-bin-konut-airbnbde
15. Turizm Gazetesi, 15 Ağustos 2023: https://www.turizmgazetesi.com/haber/otellere-rakip-olma-yolundaki-airbnb-vb-sistemler-yayiliyor-nerede-kac-ev-var-fiyatlari-ne/85464
16. 7464 sayılı Kanun metni (mevzuat.gov.tr): https://mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=7464&MevzuatTertip=5
17. Bakanlık başvuru kılavuzu: https://istanbul.ktb.gov.tr/Eklenti/130313,kilavuzpdf.pdf?0=
18. PwC Vergi Bülteni 2026/10 (27 Şubat 2026): https://www.pwc.com.tr/tr/Hizmetlerimiz/vergi/vergi-bultenleri/2026/2025-yili-kira-gelirlerinin-beyani.pdf
19. Boğaziçi Denetim, 2024-14: https://www.bbdas.com.tr/2024-14-konutlarin-turizm-amacli-kiralanmalarinda-vergisel-yukumlulukler-b-2555
20. Lebib Yalkın Hukuk: https://lebibyalkin.com.tr/makale/kisa-sureli-kiralamalarda-vergi-rejimi-degisiyor-airbnb-ve-benzeri-platformlara-iliskin-danistay-karari
21. Yeni Şafak (Danıştay yürütmeyi durdurma): https://www.yenisafak.com/galeri/gundem/evini-kisa-sureli-kiraya-verenlere-danistaydan-vergi-karari-4829818
22. Mersin Gazetesi, 20 Temmuz 2026: https://mersingazetesi.com/index.php/2026/07/20/danistaydan-airbnb-karari-kdv-ve-konaklama-vergisi-yok/
23. Or Hukuk: https://or.av.tr/airbnb-karari-kisa-sureli-konut-kiralamasi/
24. Fırat İnsel, Muhasebetr: https://www.muhasebetr.com/yazarlarimiz/firatinsel/085/
25. Baf Hukuk (vergi ve kanun): https://baf.av.tr/airbnb-vergi-incelemesi/ ve https://baf.av.tr/yeni-airbnb-kanunu/
26. Fatih Aras: https://www.fatiharas.com/konutlarin-turizm-amacli-kiralanmasi-ve-vergilendirme/
27. Tahancı Hukuk: https://www.tahanci.av.tr/konutlarin-turizm-amacli-kiralanmasi/
28. Hukukçu Evi: https://hukukcularevi.com/konutun-kisa-sureli-gunubirlik-kiraya-verilmesi-ve-kat-mulkiyeti/

**Güvenilirlik notu:** Veri sağlayıcılar (Homesberg, AirDNA, Airbtics, AirROI) ticari ve her birinin yöntemi farklı. Hukuk bürosu ve haber siteleri ikincil kaynak. Bakanlığın resmî güncel belge sayısını ve Danıştay kararının son durumunu birincil kaynaktan (Bakanlık, Resmî Gazete, Danıştay) doğrulamanızı öneririm.
