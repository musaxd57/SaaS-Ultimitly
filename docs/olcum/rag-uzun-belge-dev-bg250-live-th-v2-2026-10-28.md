# Uzun belge RAG ölçümü — dev (opus (geliştirme seti))

Belgeler: D1 13746 kr → 25 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9590 kr → 22 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `live`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 125 · 0 · 0 · 0 |
| yalnız "Giriş Talimatı"nda kalan alıntı (QR ve rezervasyon öncesi görmez) | 13 alıntı · 10 soru |
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 47/92 (%51) |
| çok alıntılı soruda hepsi aynı parçada | 44/92 (%48) |
| **bağlam tam (bütün alıntılar modelde)** | **107/113 (%95)** |
| en az bir alıntı modelde | 112/113 (%99) |
| cevapsız soruda ortalama seçilen parça | 11.7 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 11/12 (%92) | 11/12 (%92) | 11/12 (%92) |
| coklu_soru | 10 | 9/10 (%90) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 7/8 (%88) | 8/8 (%100) | 0/8 (%0) |
| komsu_parca | 15 | 14/15 (%93) | 15/15 (%100) | 9/15 (%60) |
| olumsuzluk | 10 | 10/10 (%100) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |
| uzak_istisna | 20 | 18/20 (%90) | 20/20 (%100) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 8/8 (%100) | 8/8 (%100) | 8/8 (%100) |
| yakin_konu | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |

Eksik bağlamlı ilk 6 soru (eksik alıntı):

- D2-Q11 [uzak_istisna] 1/2 — eksik: «In July and August the garden lights switch off at 23:00 instead of 01:00, at the request »
- D3-Q13 [komsu_parca] 1/2 — eksik: «Daha büyük alışveriş için ilçe merkezine gitmeniz gerekir; ilçedeki iki zincir market her »
- D3-Q15 [uzak_istisna] 1/2 — eksik: «Cuma günleri köy meydanında pazar kurulur; perşembe akşamı 18:00'den cuma 16:00'ya kadar m»
- D4-Q03 [gonderme] 1/2 — eksik: «Ayrılmadan önce bulaşıkları makineye yerleştirin, çöpleri Bölüm 9'da anlatıldığı gibi ayır»
- D5-Q13 [coklu_soru] 1/3 — eksik: «Ev en fazla 6 kişiliktir: üst katta iki yatak odası (birinde çift kişilik yatak, diğerinde» · «Giriş saati 15:00, çıkış saati 11:00'dir.»
- D5-Q16 [baska_dil] 0/1 — eksik: «Cevap: Yaylada küçük bir bakkal vardır, yalnız Haziran–Eylül arasında 09:00–19:00 açıktır;»
