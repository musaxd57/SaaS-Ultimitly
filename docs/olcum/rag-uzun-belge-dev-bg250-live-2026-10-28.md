# Uzun belge RAG ölçümü — dev (opus (geliştirme seti))

Belgeler: D1 13746 kr → 25 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9590 kr → 22 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `live`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 125 · 0 · 0 · 0 |
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 41/92 (%45) |
| çok alıntılı soruda hepsi aynı parçada | 32/92 (%35) |
| **bağlam tam (bütün alıntılar modelde)** | **106/113 (%94)** |
| en az bir alıntı modelde | 113/113 (%100) |
| cevapsız soruda ortalama seçilen parça | 11.7 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 12/12 (%100) | 12/12 (%100) | 10/12 (%83) |
| coklu_soru | 10 | 9/10 (%90) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 7/8 (%88) | 8/8 (%100) | 0/8 (%0) |
| komsu_parca | 15 | 15/15 (%100) | 15/15 (%100) | 9/15 (%60) |
| olumsuzluk | 10 | 9/10 (%90) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 13/15 (%87) | 15/15 (%100) | 2/15 (%13) |
| uzak_istisna | 20 | 18/20 (%90) | 20/20 (%100) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 8/8 (%100) | 8/8 (%100) | 8/8 (%100) |
| yakin_konu | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |

Eksik bağlamlı ilk 7 soru (eksik alıntı):

- D1-Q08 [tablo] 1/2 — eksik: «| Tesis | Yaz dönemi (1 Haziran–15 Eylül) | Kış dönemi (16 Eylül–31 Mayıs) | 16 yaş altı |»
- D1-Q11 [tablo] 1/2 — eksik: «| Cihaz | Yeri | Nasıl kullanılır | Dikkat |»
- D1-Q16 [olumsuzluk] 3/4 — eksik: «| Geç çıkış (11:00–14:00 arası) | Ücretsiz | 500 TL | Yapılmıyor |»
- D2-Q11 [uzak_istisna] 1/2 — eksik: «In July and August the garden lights switch off at 23:00 instead of 01:00, at the request »
- D4-Q03 [gonderme] 1/2 — eksik: «Ayrılmadan önce bulaşıkları makineye yerleştirin, çöpleri Bölüm 9'da anlatıldığı gibi ayır»
- D5-Q01 [uzak_istisna] 2/3 — eksik: «Giriş saati 15:00, çıkış saati 11:00'dir.»
- D5-Q13 [coklu_soru] 2/3 — eksik: «Ev en fazla 6 kişiliktir: üst katta iki yatak odası (birinde çift kişilik yatak, diğerinde»
