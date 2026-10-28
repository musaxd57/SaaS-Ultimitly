# Uzun belge RAG ölçümü — dev (opus (geliştirme seti))

Belgeler: D1 13746 kr → 25 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9590 kr → 22 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 0 kalem (tek belge — ürün bu boyutta seçim yapmaz, bilgi tabanının tamamı gider)

## Yapılandırma `lex`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 0 · 0 · 0 · 125 |
| yalnız "Giriş Talimatı"nda kalan alıntı (QR ve rezervasyon öncesi görmez) | 13 alıntı · 10 soru |
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 41/92 (%45) |
| çok alıntılı soruda hepsi aynı parçada | 32/92 (%35) |
| **bağlam tam (bütün alıntılar modelde)** | **113/113 (%100)** |
| en az bir alıntı modelde | 113/113 (%100) |
| cevapsız soruda ortalama seçilen parça | 22.8 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 12/12 (%100) | 12/12 (%100) | 10/12 (%83) |
| coklu_soru | 10 | 10/10 (%100) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 8/8 (%100) | 8/8 (%100) | 0/8 (%0) |
| komsu_parca | 15 | 15/15 (%100) | 15/15 (%100) | 9/15 (%60) |
| olumsuzluk | 10 | 10/10 (%100) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 15/15 (%100) | 15/15 (%100) | 2/15 (%13) |
| uzak_istisna | 20 | 20/20 (%100) | 20/20 (%100) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 8/8 (%100) | 8/8 (%100) | 8/8 (%100) |
| yakin_konu | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |
