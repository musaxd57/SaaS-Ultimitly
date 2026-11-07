# Uzun belge RAG ölçümü — dev (opus (geliştirme seti))

Belgeler: D1 13746 kr → 25 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9590 kr → 22 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `lex`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 0 · 0 · 0 · 125 |
| yalnız "Giriş Talimatı"nda kalan alıntı (QR ve rezervasyon öncesi görmez) | 13 alıntı · 10 soru |
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 47/92 (%51) |
| çok alıntılı soruda hepsi aynı parçada | 44/92 (%48) |
| **bağlam tam (bütün alıntılar modelde)** | **88/113 (%78)** |
| en az bir alıntı modelde | 100/113 (%88) |
| cevapsız soruda ortalama seçilen parça | 10.5 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 8/12 (%67) | 8/12 (%67) | 11/12 (%92) |
| coklu_soru | 10 | 6/10 (%60) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 6/8 (%75) | 6/8 (%75) | 0/8 (%0) |
| komsu_parca | 15 | 13/15 (%87) | 13/15 (%87) | 9/15 (%60) |
| olumsuzluk | 10 | 8/10 (%80) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 13/15 (%87) | 14/15 (%93) | 13/15 (%87) |
| uzak_istisna | 20 | 13/20 (%65) | 17/20 (%85) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 7/8 (%88) | 7/8 (%88) | 8/8 (%100) |
| yakin_konu | 15 | 14/15 (%93) | 15/15 (%100) | 13/15 (%87) |

Eksik bağlamlı ilk 25 soru (eksik alıntı):

- D1-Q01 [tablo] 2/3 — eksik: «| Geç çıkış (11:00–14:00 arası) | Ücretsiz | 500 TL | Yapılmıyor |»
- D1-Q08 [tablo] 0/2 — eksik: «| Tesis | Yaz dönemi (1 Haziran–15 Eylül) | Kış dönemi (16 Eylül–31 Mayıs) | 16 yaş altı |» · «| Hamam | Kapalı | 16:00–22:00, yalnız cumartesi ve pazar | Giremez |»
- D1-Q13 [uzak_istisna] 3/4 — eksik: «Sezonlar: düşük sezon Kasım–Mart, orta sezon Nisan, Mayıs ve Ekim, yüksek sezon Haziran–Ey»
- D1-Q15 [uzak_istisna] 0/4 — eksik: «Sezonlar: düşük sezon Kasım–Mart, orta sezon Nisan, Mayıs ve Ekim, yüksek sezon Haziran–Ey» · «| Hizmet | Düşük sezon | Orta sezon | Yüksek sezon |» · «| Erken giriş (12:00–15:00 arası) | Ücretsiz | 500 TL | 900 TL |» · «Yüksek sezonda erken giriş yalnız bir önceki gece daire boşsa yapılabilir; uygunluğu giriş»
- D1-Q16 [olumsuzluk] 2/4 — eksik: «| Geç çıkış (11:00–14:00 arası) | Ücretsiz | 500 TL | Yapılmıyor |» · «Geç çıkış yüksek sezonda yapılmasa da, 11:00'den sonra çıkacaksanız eşyalarınızı 18:00'e k»
- D1-Q19 [coklu_soru] 2/3 — eksik: «| Kayıp otopark kartı | 750 TL | 750 TL | 750 TL |»
- D1-Q22 [baska_dil] 0/2 — eksik: «| Atık | Mutfaktaki kutu | Site konteyneri | Toplama günü |» · «| Cam şişe ve kavanoz | Tezgâh altındaki bez torba | Yeşil cam kumbarası | Çarşamba |»
- D2-Q02 [baska_dil] 0/3 — eksik: «Bahçede mangal yapılabilir; mangal, kömür ve maşa depo odasındadır.» · «Mangalı yalnız taş zemin üzerinde, evin duvarından en az 3 metre uzakta kurun.» · «Rüzgâr hızının yüksek olduğu ve belediyenin yangın uyarısı yayımladığı günlerde mangal yak»
- D2-Q10 [uzak_istisna] 0/4 — eksik: «Please do not enter the flat itself before 16:00, as the cleaners may still be working ins» · «erken giriş (13:00'ten itibaren, aynı gün çıkış yoksa) 400 TL» · «Erken giriş Temmuz ve Ağustos aylarında cumartesi günleri yapılmaz.» · «Hafta içi erken giriş için en geç bir gün önce yazın.»
- D2-Q11 [uzak_istisna] 1/2 — eksik: «In July and August the garden lights switch off at 23:00 instead of 01:00, at the request »
- D2-Q16 [olumsuzluk] 1/2 — eksik: «ziyaretçiler 22:00'ye kadar ayrılmalıdır ve aynı anda en fazla 2 ziyaretçi olabilir.»
- D3-Q08 [uzun_paragraf_tek_cumle] 0/1 — eksik: «Köydeki sağlık ocağı yalnız hafta içi 08:00–17:00 arası açıktır; gece ve hafta sonu en yak»
- D3-Q11 [komsu_parca] 0/2 — eksik: «Köyde çöp kamyonu yalnız salı ve cuma sabahları saat 08:00 civarında gelir.» · «Bu yüzden çıkış gününüz salı ya da cuma değilse çöplerinizi yola koymayın; bahçe kapısının»
- D3-Q13 [komsu_parca] 0/2 — eksik: «En yakın alışveriş yeri köy bakkalıdır ve 08:00–21:00 arası açıktır.» · «Daha büyük alışveriş için ilçe merkezine gitmeniz gerekir; ilçedeki iki zincir market her »
- D3-Q15 [uzak_istisna] 1/2 — eksik: «Arabanızı evin önündeki büyük keçiboynuzu ağacının altına bırakabilirsiniz; ağacın altına »
- D3-Q16 [uzak_istisna] 1/2 — eksik: «Son bir not: 10 gece ve üzeri kalan misafirlerimize 5. gün ücretsiz temizlik ve çarşaf değ»
- D4-Q03 [gonderme] 0/2 — eksik: «Ayrılmadan önce bulaşıkları makineye yerleştirin, çöpleri Bölüm 9'da anlatıldığı gibi ayır» · «Cam şişe ve kavanozlar çöp odasına değil, sokağın köşesindeki yeşil cam kumbarasına atılır»
- D4-Q06 [gonderme] 0/4 — eksik: «Giriş saati 15:00'tir.» · «Erken giriş ücretli ve koşullu bir hizmettir; ücret ve koşullar için bkz. Bölüm 11.» · «| Hizmet | 1–6 gece kalışta | 7 gece ve üzeri kalışta | Not |» · «| Erken giriş (11:00'den itibaren) | 400 TL | Ücretsiz | Aynı gün çıkış yoksa |»
- D4-Q12 [uzak_istisna] 0/2 — eksik: «Rezervasyonda kayıtlı olmayan kişiler daireye giremez.» · «Önceden bize yazmanız koşuluyla terasa gündüz en fazla 2 ziyaretçi davet edebilirsiniz; zi»
- D4-Q20 [coklu_soru] 1/4 — eksik: «Belediye çöpleri her akşam 21:00'den sonra toplar.» · «Pazar günleri çöp toplanmaz, ama çöp odası açıktır.» · «Çıkış saati 11:00'dir.»
- D5-Q13 [coklu_soru] 1/3 — eksik: «Ev en fazla 6 kişiliktir: üst katta iki yatak odası (birinde çift kişilik yatak, diğerinde» · «Giriş saati 15:00, çıkış saati 11:00'dir.»
- D5-Q15 [baska_dil] 0/1 — eksik: «Musluk suyu kaynak suyudur ve içilebilir; yine de isterseniz mutfakta 5 litrelik pet şişe »
- D5-Q16 [baska_dil] 0/1 — eksik: «Cevap: Yaylada küçük bir bakkal vardır, yalnız Haziran–Eylül arasında 09:00–19:00 açıktır;»
- D6-Q06 [yakin_konu] 3/4 — eksik: «Ziyaretçileriniz ortak alanları (havuzlar, spa, plaj) kullanamaz; yalnız daireye ve snack »
- D6-Q19 [coklu_soru] 2/3 — eksik: «Site ağı Yelkenkaya-Ortak şifresizdir; havuz, plaj ve lobi alanlarında çeker, daire içinde»
