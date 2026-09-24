# Konaklama değişikliği anlam katmanı — eval (2026-09-24)

Durum: **MODEL KOŞMADI (yalnız deterministik yedek)** · veri sürümü 1 · istek 599 · cevap 747

Genelleme ölçüsü YALNIZ `holdout` satırlarıdır; `dev` bölümü deterministik yedeğin düzeltilmesinde görüldü.

## Deterministik yedek (kelime ağı)

| bölüm · sınıf | doğru |
|---|---|
| dev|claim | 31/57 (54%) |
| dev|deferral | 61/76 (80%) |
| dev|grant | 19/60 (32%) |
| dev|istek(doğru=var) | 77/125 (62%) |
| dev|neutral | 117/118 (99%) |
| dev|none(doğru=yok) | 133/143 (93%) |
| dev|offer | 11/15 (73%) |
| holdout|claim | 26/73 (36%) |
| holdout|deferral | 41/77 (53%) |
| holdout|grant | 13/95 (14%) |
| holdout|istek(doğru=var) | 77/170 (45%) |
| holdout|neutral | 124/127 (98%) |
| holdout|none(doğru=yok) | 133/161 (83%) |
| holdout|offer | 13/19 (68%) |
| holdout|refusal | 30/30 (100%) |
