# Uzun belge RAG ölçümü — dev (opus (geliştirme seti)) — ⚠️ ANLAMA KATMANI KAPALI koştu (ölçer hatası, 10-28; anahtar verilmemişti) — üretim DEĞİL, anlamasız kıyas (eski dev.json — yazar sonradan tabloları uzattı; yalnız tarihçe)

Belgeler: D1 12156 kr → 23 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9367 kr → 21 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `live`

| ölçü | sonuç |
|---|---|
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 48/92 (%52) |
| çok alıntılı soruda hepsi aynı parçada | 42/92 (%46) |
| **bağlam tam (bütün alıntılar modelde)** | **102/113 (%90)** |
| en az bir alıntı modelde | 110/113 (%97) |
| cevapsız soruda ortalama seçilen parça | 11.3 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 9/12 (%75) | 9/12 (%75) | 11/12 (%92) |
| coklu_soru | 10 | 9/10 (%90) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 7/8 (%88) | 8/8 (%100) | 0/8 (%0) |
| komsu_parca | 15 | 15/15 (%100) | 15/15 (%100) | 9/15 (%60) |
| olumsuzluk | 10 | 10/10 (%100) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 13/15 (%87) | 15/15 (%100) | 11/15 (%73) |
| uzak_istisna | 20 | 16/20 (%80) | 20/20 (%100) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 8/8 (%100) | 8/8 (%100) | 8/8 (%100) |
| yakin_konu | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |

Eksik bağlamlı ilk 11 soru (eksik alıntı):

- D1-Q02 [tablo] 1/3 — eksik: «Sezonlar: düşük sezon Kasım–Mart, orta sezon Nisan, Mayıs ve Ekim, yüksek sezon Haziran–Ey» · «| Hizmet | Düşük sezon | Orta sezon | Yüksek sezon |»
- D2-Q02 [baska_dil] 0/3 — eksik: «Bahçede mangal yapılabilir; mangal, kömür ve maşa depo odasındadır.» · «Mangalı yalnız taş zemin üzerinde, evin duvarından en az 3 metre uzakta kurun.» · «Rüzgâr hızının yüksek olduğu ve belediyenin yangın uyarısı yayımladığı günlerde mangal yak»
- D2-Q10 [uzak_istisna] 1/4 — eksik: «erken giriş (13:00'ten itibaren, aynı gün çıkış yoksa) 400 TL» · «Erken giriş Temmuz ve Ağustos aylarında cumartesi günleri yapılmaz.» · «Hafta içi erken giriş için en geç bir gün önce yazın.»
- D2-Q11 [uzak_istisna] 1/2 — eksik: «In July and August the garden lights switch off at 23:00 instead of 01:00, at the request »
- D4-Q03 [gonderme] 1/2 — eksik: «Ayrılmadan önce bulaşıkları makineye yerleştirin, çöpleri Bölüm 9'da anlatıldığı gibi ayır»
- D4-Q12 [uzak_istisna] 1/2 — eksik: «Rezervasyonda kayıtlı olmayan kişiler daireye giremez.»
- D4-Q17 [tablo] 1/2 — eksik: «| Hizmet | 1–6 gece kalışta | 7 gece ve üzeri kalışta | Not |»
- D5-Q01 [uzak_istisna] 2/3 — eksik: «Giriş saati 15:00, çıkış saati 11:00'dir.»
- D5-Q13 [coklu_soru] 2/3 — eksik: «Ev en fazla 6 kişiliktir: üst katta iki yatak odası (birinde çift kişilik yatak, diğerinde»
- D5-Q15 [baska_dil] 0/1 — eksik: «Musluk suyu kaynak suyudur ve içilebilir; yine de isterseniz mutfakta 5 litrelik pet şişe »
- D5-Q16 [baska_dil] 0/1 — eksik: «Cevap: Yaylada küçük bir bakkal vardır, yalnız Haziran–Eylül arasında 09:00–19:00 açıktır;»
