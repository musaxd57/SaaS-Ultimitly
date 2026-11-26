# Uzun belge RAG ölçümü — blind (sonnet (kör yazar, sistemi görmedi))

Belgeler: B1 8936 kr → 20 kalem · B2 8916 kr → 24 kalem · B3 9342 kr → 7 kalem · B4 8724 kr → 31 kalem · B5 8515 kr → 24 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `live`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 105 · 0 · 0 · 0 |
| içe aktarmada kaybolmayan alıntı | 192/194 (%99) |
| çok alıntılı soruda hepsi aynı kalemde | 25/64 (%39) |
| çok alıntılı soruda hepsi aynı parçada | 23/64 (%36) |
| **bağlam tam (bütün alıntılar modelde)** | **90/95 (%95)** |
| en az bir alıntı modelde | 94/95 (%99) |
| cevapsız soruda ortalama seçilen parça | 12.0 (10 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 10 | 10/10 (%100) | 10/10 (%100) | 8/10 (%80) |
| coklu_soru | 8 | 4/8 (%50) | 7/8 (%88) | 0/8 (%0) |
| gonderme | 7 | 7/7 (%100) | 7/7 (%100) | 1/7 (%14) |
| komsu_parca | 12 | 12/12 (%100) | 12/12 (%100) | 11/12 (%92) |
| olumsuzluk | 9 | 9/9 (%100) | 9/9 (%100) | 8/9 (%89) |
| tablo | 12 | 12/12 (%100) | 12/12 (%100) | 11/12 (%92) |
| uzak_istisna | 19 | 18/19 (%95) | 19/19 (%100) | 0/19 (%0) |
| uzun_paragraf_tek_cumle | 6 | 6/6 (%100) | 6/6 (%100) | 6/6 (%100) |
| yakin_konu | 12 | 12/12 (%100) | 12/12 (%100) | 9/12 (%75) |

(Kör küme: 5 eksik bağlamlı sorunun ayrıntısı yazılmaz — ayar için okunmaz.)
