# Uzun belge RAG ölçümü — blind (sonnet (kör yazar, sistemi görmedi))

Belgeler: B1 8936 kr → 20 kalem · B2 8916 kr → 24 kalem · B3 9342 kr → 7 kalem · B4 8724 kr → 31 kalem · B5 8515 kr → 24 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `lex`

| ölçü | sonuç |
|---|---|
| içe aktarmada kaybolmayan alıntı | 192/194 (%99) |
| çok alıntılı soruda hepsi aynı kalemde | 25/64 (%39) |
| çok alıntılı soruda hepsi aynı parçada | 23/64 (%36) |
| **bağlam tam (bütün alıntılar modelde)** | **66/95 (%69)** |
| en az bir alıntı modelde | 84/95 (%88) |
| cevapsız soruda ortalama seçilen parça | 10.8 (10 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 10 | 4/10 (%40) | 5/10 (%50) | 8/10 (%80) |
| coklu_soru | 8 | 3/8 (%38) | 7/8 (%88) | 0/8 (%0) |
| gonderme | 7 | 3/7 (%43) | 7/7 (%100) | 1/7 (%14) |
| komsu_parca | 12 | 11/12 (%92) | 11/12 (%92) | 11/12 (%92) |
| olumsuzluk | 9 | 8/9 (%89) | 8/9 (%89) | 8/9 (%89) |
| tablo | 12 | 10/12 (%83) | 10/12 (%83) | 11/12 (%92) |
| uzak_istisna | 19 | 11/19 (%58) | 19/19 (%100) | 0/19 (%0) |
| uzun_paragraf_tek_cumle | 6 | 6/6 (%100) | 6/6 (%100) | 6/6 (%100) |
| yakin_konu | 12 | 10/12 (%83) | 11/12 (%92) | 9/12 (%75) |

(Kör küme: 29 eksik bağlamlı sorunun ayrıntısı yazılmaz — ayar için okunmaz.)
