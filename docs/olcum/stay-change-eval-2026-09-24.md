# Konaklama değişikliği anlam katmanı — eval (2026-09-24)

Durum: **GEÇERLİ** · veri sürümü 1 · istek 599 · cevap 747

Bu rapordaki `dev` ve `holdout` bölümleri GÖRÜLDÜ (dev: düzeltmelerde; holdout: 09-24 denetimlerinde ölçüldü) — gelişme göstergesidir, son açma kararı yalnız mühürlü final setiyle (`docs/EVAL-MUHURLU-FINAL.md`).

## Deterministik yedek (kelime ağı)

| bölüm · sınıf | doğru |
|---|---|
| dev|claim | 31/57 (54%) |
| dev|deferral | 70/76 (92%) |
| dev|grant | 20/60 (33%) |
| dev|istek(doğru=var) | 77/125 (62%) |
| dev|neutral | 118/118 (100%) |
| dev|none(doğru=yok) | 135/143 (94%) |
| dev|offer | 14/15 (93%) |
| holdout|claim | 27/73 (37%) |
| holdout|deferral | 44/77 (57%) |
| holdout|grant | 13/95 (14%) |
| holdout|istek(doğru=var) | 77/170 (45%) |
| holdout|neutral | 125/127 (98%) |
| holdout|none(doğru=yok) | 135/161 (84%) |
| holdout|offer | 14/19 (74%) |
| holdout|refusal | 30/30 (100%) |

## Bekçi — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev|istek|ar | 10/10 (100%) |
| dev|istek|de | 10/10 (100%) |
| dev|istek|en | 34/34 (100%) |
| dev|istek|es | 9/9 (100%) |
| dev|istek|fr | 9/9 (100%) |
| dev|istek|ru | 9/9 (100%) |
| dev|istek|tr | 44/44 (100%) |
| dev|none|ar | 6/6 (100%) |
| dev|none|de | 5/5 (100%) |
| dev|none|en | 48/49 (98%) |
| dev|none|es | 5/5 (100%) |
| dev|none|fr | 5/5 (100%) |
| dev|none|ru | 6/6 (100%) |
| dev|none|tr | 65/67 (97%) |
| holdout|istek|ar | 10/10 (100%) |
| holdout|istek|de | 10/10 (100%) |
| holdout|istek|en | 54/54 (100%) |
| holdout|istek|es | 10/10 (100%) |
| holdout|istek|fr | 10/10 (100%) |
| holdout|istek|ru | 10/10 (100%) |
| holdout|istek|tr | 66/66 (100%) |
| holdout|none|ar | 9/9 (100%) |
| holdout|none|de | 10/10 (100%) |
| holdout|none|en | 51/52 (98%) |
| holdout|none|es | 9/9 (100%) |
| holdout|none|fr | 9/9 (100%) |
| holdout|none|ru | 9/9 (100%) |
| holdout|none|tr | 62/63 (98%) |

## Anlama katmanı — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev|istek|ar | 10/10 (100%) |
| dev|istek|de | 10/10 (100%) |
| dev|istek|en | 34/34 (100%) |
| dev|istek|es | 9/9 (100%) |
| dev|istek|fr | 9/9 (100%) |
| dev|istek|ru | 9/9 (100%) |
| dev|istek|tr | 44/44 (100%) |
| dev|none|ar | 6/6 (100%) |
| dev|none|de | 5/5 (100%) |
| dev|none|en | 49/49 (100%) |
| dev|none|es | 5/5 (100%) |
| dev|none|fr | 5/5 (100%) |
| dev|none|ru | 6/6 (100%) |
| dev|none|tr | 66/67 (99%) |
| holdout|istek|ar | 10/10 (100%) |
| holdout|istek|de | 10/10 (100%) |
| holdout|istek|en | 53/54 (98%) |
| holdout|istek|es | 10/10 (100%) |
| holdout|istek|fr | 10/10 (100%) |
| holdout|istek|ru | 10/10 (100%) |
| holdout|istek|tr | 65/66 (98%) |
| holdout|none|ar | 9/9 (100%) |
| holdout|none|de | 10/10 (100%) |
| holdout|none|en | 51/52 (98%) |
| holdout|none|es | 8/9 (89%) |
| holdout|none|fr | 9/9 (100%) |
| holdout|none|ru | 9/9 (100%) |
| holdout|none|tr | 62/63 (98%) |

## BİRLEŞİM — kelime ağı ∨ bekçi ∨ anlama (ürünün tutuşu)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev|istek (doğru = tutuldu) | 125/125 (100%) |
| dev|none (doğru = gitti; yanlış = GEREKSİZ İNCELEME) | 132/143 (92%) |
| holdout|istek (doğru = tutuldu) | 170/170 (100%) |
| holdout|none (doğru = gitti; yanlış = GEREKSİZ İNCELEME) | 133/161 (83%) |

`none` satırında yanlış kalan pay = gereksiz insan incelemesi (kurucu: özellikle bakılacak oran). ALT SINIRDIR:
cevap modelinin beyanı ve konu etiketi (`ri`) bu harness'ta koşmaz; canlıda `sc` kanıtıyla ayrıca ölçülür
(`docs/ANLAM-KATMANI-2026-09-24.md` §2.2).

## Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev|claim|ar | 3/3 (100%) |
| dev|claim|de | 3/3 (100%) |
| dev|claim|en | 18/18 (100%) |
| dev|claim|es | 3/3 (100%) |
| dev|claim|fr | 3/3 (100%) |
| dev|claim|ru | 3/3 (100%) |
| dev|claim|tr | 24/24 (100%) |
| dev|deferral|ar | 3/3 (100%) |
| dev|deferral|de | 3/3 (100%) |
| dev|deferral|en | 25/28 (89%) |
| dev|deferral|es | 3/3 (100%) |
| dev|deferral|fr | 3/3 (100%) |
| dev|deferral|ru | 3/3 (100%) |
| dev|deferral|tr | 32/33 (97%) |
| dev|grant|ar | 3/3 (100%) |
| dev|grant|de | 3/3 (100%) |
| dev|grant|en | 22/22 (100%) |
| dev|grant|es | 3/3 (100%) |
| dev|grant|fr | 3/3 (100%) |
| dev|grant|ru | 3/3 (100%) |
| dev|grant|tr | 23/23 (100%) |
| dev|neutral|ar | 3/3 (100%) |
| dev|neutral|de | 3/3 (100%) |
| dev|neutral|en | 44/44 (100%) |
| dev|neutral|es | 3/3 (100%) |
| dev|neutral|fr | 3/3 (100%) |
| dev|neutral|ru | 3/3 (100%) |
| dev|neutral|tr | 57/59 (97%) |
| dev|offer|ar | 1/1 (100%) |
| dev|offer|de | 1/1 (100%) |
| dev|offer|en | 4/4 (100%) |
| dev|offer|es | 1/1 (100%) |
| dev|offer|fr | 1/1 (100%) |
| dev|offer|ru | 1/1 (100%) |
| dev|offer|tr | 6/6 (100%) |
| holdout|claim|ar | 4/4 (100%) |
| holdout|claim|de | 4/4 (100%) |
| holdout|claim|en | 26/26 (100%) |
| holdout|claim|es | 4/4 (100%) |
| holdout|claim|fr | 4/4 (100%) |
| holdout|claim|ru | 4/4 (100%) |
| holdout|claim|tr | 27/27 (100%) |
| holdout|deferral|ar | 4/4 (100%) |
| holdout|deferral|de | 3/4 (75%) |
| holdout|deferral|en | 28/28 (100%) |
| holdout|deferral|es | 4/4 (100%) |
| holdout|deferral|fr | 4/4 (100%) |
| holdout|deferral|ru | 4/4 (100%) |
| holdout|deferral|tr | 29/29 (100%) |
| holdout|grant|ar | 4/5 (80%) |
| holdout|grant|de | 5/5 (100%) |
| holdout|grant|en | 33/34 (97%) |
| holdout|grant|es | 5/5 (100%) |
| holdout|grant|fr | 5/5 (100%) |
| holdout|grant|ru | 5/5 (100%) |
| holdout|grant|tr | 36/36 (100%) |
| holdout|neutral|ar | 6/7 (86%) |
| holdout|neutral|de | 6/7 (86%) |
| holdout|neutral|en | 43/46 (93%) |
| holdout|neutral|es | 5/7 (71%) |
| holdout|neutral|fr | 7/7 (100%) |
| holdout|neutral|ru | 6/7 (86%) |
| holdout|neutral|tr | 43/46 (93%) |
| holdout|offer|ar | 1/1 (100%) |
| holdout|offer|de | 1/1 (100%) |
| holdout|offer|en | 7/7 (100%) |
| holdout|offer|es | 1/1 (100%) |
| holdout|offer|fr | 1/1 (100%) |
| holdout|offer|ru | 1/1 (100%) |
| holdout|offer|tr | 7/7 (100%) |
| holdout|refusal|ar | 2/2 (100%) |
| holdout|refusal|de | 2/2 (100%) |
| holdout|refusal|en | 8/10 (80%) |
| holdout|refusal|es | 2/2 (100%) |
| holdout|refusal|fr | 2/2 (100%) |
| holdout|refusal|ru | 2/2 (100%) |
| holdout|refusal|tr | 8/10 (80%) |

## Karar ölçüleri — dev (cevap modeli beyanı / konu etiketi hariç: alt sınır)

| ölçü | değer |
|---|---|
| Tehlikeli kaçak (istek → tutulmadı) | 0/125 (0%) |
| Gereksiz inceleme (istek yok → tutuldu) | 11/143 (8%) |
| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | 2/2 (100%) |
| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | 0/2 (0%) |
| Bilinmiyor (model düştü; satır sayılmadı) | bekçi 0 · anlama 0 · satır 0 |
| Yalnız TEK katmanın yakaladığı istek | kelime ağı 0 · bekçi 0 · anlama 0 |

## Karar ölçüleri — holdout (cevap modeli beyanı / konu etiketi hariç: alt sınır)

| ölçü | değer |
|---|---|
| Tehlikeli kaçak (istek → tutulmadı) | 0/170 (0%) |
| Gereksiz inceleme (istek yok → tutuldu) | 28/161 (17%) |
| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | 2/2 (100%) |
| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | 0/2 (0%) |
| Bilinmiyor (model düştü; satır sayılmadı) | bekçi 0 · anlama 0 · satır 0 |
| Yalnız TEK katmanın yakaladığı istek | kelime ağı 0 · bekçi 2 · anlama 0 |
