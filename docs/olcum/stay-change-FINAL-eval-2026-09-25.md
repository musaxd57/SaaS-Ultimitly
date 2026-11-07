# Konaklama değişikliği anlam katmanı — eval (2026-09-25)

Durum: **GEÇERLİ** · veri sürümü 1 · istek 180 · cevap 180

Dondurulmuş commit: `f584075e15ceeb20146093c0a8d8c966438c01af` · bekçi + anlama katmanı `gpt-5.1` (`AI_SEMANTIC_*` ayarları boş = canlıyla aynı; cevap modeli bu harness'ta koşmaz) · ~540 model çağrısı, düşen 0 · tahmini maliyet ~1 USD. (Bu satır koşudan sonra elle eklendi; harness commit yazmıyor.)

🚨 MÜHÜRLÜ FİNAL KOŞUSU: genelleme ölçüsü bu raporun TAMAMIdır. Koşu bitti → set YANDI (`evals/sealed/SEALS.json` durumu `burned`; sonraki karar için yeni kör set).

## Deterministik yedek (kelime ağı)

| bölüm · sınıf | doğru |
|---|---|
| final|claim | 14/22 (64%) |
| final|deferral | 18/36 (50%) |
| final|grant | 5/45 (11%) |
| final|istek(doğru=var) | 61/117 (52%) |
| final|neutral | 35/36 (97%) |
| final|none(doğru=yok) | 56/63 (89%) |
| final|offer | 8/19 (42%) |
| final|refusal | 22/22 (100%) |

## Bekçi — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| final|istek|ar | 7/7 (100%) |
| final|istek|de | 7/7 (100%) |
| final|istek|en | 35/35 (100%) |
| final|istek|es | 7/7 (100%) |
| final|istek|fr | 7/7 (100%) |
| final|istek|ru | 7/7 (100%) |
| final|istek|tr | 47/47 (100%) |
| final|none|ar | 3/3 (100%) |
| final|none|de | 4/4 (100%) |
| final|none|en | 19/19 (100%) |
| final|none|es | 4/4 (100%) |
| final|none|fr | 4/4 (100%) |
| final|none|ru | 4/4 (100%) |
| final|none|tr | 25/25 (100%) |

## Anlama katmanı — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| final|istek|ar | 7/7 (100%) |
| final|istek|de | 6/7 (86%) |
| final|istek|en | 34/35 (97%) |
| final|istek|es | 6/7 (86%) |
| final|istek|fr | 7/7 (100%) |
| final|istek|ru | 7/7 (100%) |
| final|istek|tr | 46/47 (98%) |
| final|none|ar | 3/3 (100%) |
| final|none|de | 4/4 (100%) |
| final|none|en | 19/19 (100%) |
| final|none|es | 4/4 (100%) |
| final|none|fr | 4/4 (100%) |
| final|none|ru | 4/4 (100%) |
| final|none|tr | 25/25 (100%) |

## BİRLEŞİM — kelime ağı ∨ bekçi ∨ anlama (ürünün tutuşu)

| bölüm · sınıf · dil | doğru |
|---|---|
| final|istek (doğru = tutuldu) | 117/117 (100%) |
| final|none (doğru = gitti; yanlış = GEREKSİZ İNCELEME) | 56/63 (89%) |

`none` satırında yanlış kalan pay = gereksiz insan incelemesi (kurucu: özellikle bakılacak oran). ALT SINIRDIR:
cevap modelinin beyanı ve konu etiketi (`ri`) bu harness'ta koşmaz; canlıda `sc` kanıtıyla ayrıca ölçülür
(`docs/ANLAM-KATMANI-2026-09-24.md` §2.2).

## Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)

| bölüm · sınıf · dil | doğru |
|---|---|
| final|claim|ar | 1/1 (100%) |
| final|claim|de | 1/1 (100%) |
| final|claim|en | 7/7 (100%) |
| final|claim|es | 1/1 (100%) |
| final|claim|fr | 2/2 (100%) |
| final|claim|ru | 1/1 (100%) |
| final|claim|tr | 9/9 (100%) |
| final|deferral|ar | 2/2 (100%) |
| final|deferral|de | 2/2 (100%) |
| final|deferral|en | 11/11 (100%) |
| final|deferral|es | 3/3 (100%) |
| final|deferral|fr | 2/2 (100%) |
| final|deferral|ru | 2/2 (100%) |
| final|deferral|tr | 14/14 (100%) |
| final|grant|ar | 2/2 (100%) |
| final|grant|de | 3/3 (100%) |
| final|grant|en | 14/14 (100%) |
| final|grant|es | 2/2 (100%) |
| final|grant|fr | 3/3 (100%) |
| final|grant|ru | 3/3 (100%) |
| final|grant|tr | 18/18 (100%) |
| final|neutral|ar | 2/2 (100%) |
| final|neutral|de | 2/2 (100%) |
| final|neutral|en | 11/11 (100%) |
| final|neutral|es | 2/2 (100%) |
| final|neutral|fr | 2/2 (100%) |
| final|neutral|ru | 3/3 (100%) |
| final|neutral|tr | 14/14 (100%) |
| final|offer|ar | 2/2 (100%) |
| final|offer|de | 1/1 (100%) |
| final|offer|en | 4/5 (80%) |
| final|offer|es | 1/1 (100%) |
| final|offer|fr | 1/1 (100%) |
| final|offer|ru | 1/1 (100%) |
| final|offer|tr | 8/8 (100%) |
| final|refusal|ar | 1/1 (100%) |
| final|refusal|de | 2/2 (100%) |
| final|refusal|en | 5/6 (83%) |
| final|refusal|es | 1/2 (50%) |
| final|refusal|fr | 1/1 (100%) |
| final|refusal|ru | 1/1 (100%) |
| final|refusal|tr | 9/9 (100%) |

## Karar ölçüleri — final (cevap modeli beyanı / konu etiketi hariç: alt sınır)

| ölçü | değer |
|---|---|
| Tehlikeli kaçak (istek → tutulmadı) | 0/117 (0%) |
| Gereksiz inceleme (istek yok → tutuldu) | 7/63 (11%) |
| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | 3/3 (100%) |
| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | 2/3 (67%) |
| Bilinmiyor (model düştü; satır sayılmadı) | bekçi 0 · anlama 0 · satır 0 |
| Yalnız TEK katmanın yakaladığı istek | kelime ağı 0 · bekçi 4 · anlama 0 |
