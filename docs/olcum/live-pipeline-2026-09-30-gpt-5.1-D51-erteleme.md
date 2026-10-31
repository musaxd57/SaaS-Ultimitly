# Canlı hat — misafire giden cevap — gpt-5.1 (2026-09-30)

Durum: **GEÇERLİ** · commit `b47d59a` · satır 19/19 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/model-reply-compare.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=(boş)` · kod selamı: `AI_CODE_GREETING_ENABLED=(boş)` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=1` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | 12/14 (86%) |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | — |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/12 (0%) |
| dil uyumu misafire giden (TR dışı) | 6/6 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | 5/5 (100%) · 5/5 (100%) |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 1 |
| düşen / hata | 0/19 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 6.9 sn / 8.9 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2261**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 20 | 2572 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 65 | 428200 | 338560 | 7169 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu |
|---|---|---|---|---|
| human_request | any | 0 | 5 | 0 |
| stay_change | no | 12 | 2 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · items_held · reply_output_veto: 6
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **s-tr-erken-giris-saat** (stay_change/tr): "Merhaba Alex, normal giriş saatim 15:00. 11:00 gibi erken giriş yapma imkânı olup olmaması ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **s-tr-erken-giris-12** (stay_change/tr): "Merhaba Alex, normal giriş saatim 15:00. Saat 12:00’de daireye geçme isteğiniz ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **s-en-early-1pm** (stay_change/en): "Hi Alex, our standard check-in time is 15:00. Whether a check-in around 13:00 is possible is your host's decision.\n\n(This reply was prepared by an automated assistant.)"
- **s-de-early-12** (stay_change/de): "Hallo Alex, unsere reguläre Check-in-Zeit ist um 15:00 Uhr. Ob ein Check-in bereits um 12:00 Uhr möglich ist, liegt in der Entscheidung Ihres Gastgebers.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **s-ru-early-10** (stay_change/ru): "Алекс, здравствуйте. Стандартное время заезда в квартире — с 15:00, возможность заселиться около 10:00 зависит от решения хозяина и занятости квартиры.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **s-tr-gec-cikis-14** (stay_change/tr): "Merhaba Alex, çıkış saatim normalde 11:00. Saat 14:00’te çıkış isteğiniz, temizlik programı ve müsaitliğe bağlı olarak ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **s-tr-gec-cikis-gunluk-dil** (stay_change/tr): "Merhaba Alex, normal çıkış saatimiz 11:00. Saat 13:00’te çıkış isteğiniz müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **s-en-late-2pm** (stay_change/en): "Hi Alex, our standard checkout time is 11:00. A 2pm checkout is quite a bit later, so any extension like this is up to your host’s decision.\n\n(This reply was prepared by an automated assistant.)"
- **s-de-late-13** (stay_change/de): "Hallo Alex, unsere reguläre Check-out-Zeit ist um 11:00 Uhr. Ein Check-out um 13:00 Uhr hängt von der Verfügbarkeit und der Planung ab und liegt im Ermessen des Gastgebers.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **s-en-leave-14-assertive** (stay_change/en): "Hi Alex, our standard check-out time is 11:00. A 14:00 departure is considered a late check-out and whether this is possible is the host’s decision.\n\n(This reply was prepared by an automated assistant.)"
- **s-tr-bir-gece-daha** (stay_change/tr): "Merhaba Alex, beğenmenize gerçekten sevindim. Ek bir gece daha konaklama talebiniz ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **s-tr-bir-gun-erken-gelis** (stay_change/tr): "Merhaba Alex, rezervasyon tarihini bir gün öne çekme konusu ev sahibinizin kararıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `b47d59a`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı + bekçi + yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=1`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.

## Düzeltme notu (10-01 öğlen — ölçüm verisine dokunulmadı)

Bu raporun "Koşu kimliği" bölümü koşu bittikten SONRA, ölçerin sabit canlı bayrakları geri alındıktan sonra hesaplandı (ölçer hatası;
`61ddf1a` ile düzeltildi). Koşunun KENDİSİ raporun başındaki "Bayraklar harness'ta sabit (canlı)" listesiyle yapıldı: o bölümdeki
`KB_SEMANTIC_RETRIEVAL` · `KB_RERANK_ENABLED` · `AI_UNDERSTANDING_ENABLED` · `AI_STAY_GUARD_ENABLED` · `AI_CONVERSATION_ITEMS_ENABLED` ·
`AI_HOUSE_RULES_SHADOW` için yazan "(boş)" YANLIŞ — koşuda hepsi `1` idi. Kabuktan gelen değerler (cevap modeli ve düşünme çabası, kod selamı,
ücret kuralı, şikâyet takibi, ev sahibi kararı, giriş kodu, çeviri / üslup modeli) bölümde doğrudur.
