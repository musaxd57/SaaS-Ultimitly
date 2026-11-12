# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `8ee48c57` · satır 43/43 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/grounding-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 12/12 (100%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/26 (0%) |
| dil uyumu misafire giden (TR dışı) | 6/6 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/43 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 11.3 sn / 15.4 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.5138**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 41 | 1903 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 234 | 1235454 | 1133312 | 24440 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| near_topic_no_answer | any | 3 | 3 | 0 | 0/0 | 0 | 0 |
| explicit_no | any | 3 | 0 | 0 | 0/0 | 0 | 0 |
| conflict | any | 1 | 1 | 0 | 0/0 | 0 | 0 |
| near_entity | any | 1 | 3 | 0 | 0/0 | 0 | 0 |
| value_transfer | any | 0 | 5 | 0 | 0/0 | 0 | 0 |
| held_plus_answer | any | 0 | 4 | 0 | 0/0 | 0 | 0 |
| order | any | 3 | 0 | 0 | 0/0 | 0 | 0 |
| control | yes | 11 | 0 | 0 | 0/0 | 0 | 0 |
| mixed | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| tiny_kb | any/yes | 2 | 1 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · items_nothing_answered: 13
- low_confidence_or_risky · low_confidence_or_risky · reply_pet_policy: 3
- low_confidence_or_risky · availability_unconfirmed: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 30/34 (88%) |
| açık kalması gereken ihtiyaç: açık kaldı | 27/28 (96%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 1 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 4 |
| ↳ bunların içinde: metin GİTTİ ama bu ihtiyacın beklenen değeri yok (atlanmış ihtiyaç ya da ölçerin göremediği yanlış değer — satır incelenir) | 0 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 53/58 (91%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 26/43 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 3/3 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 0/3 (0%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 3 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| a-kahvalti-yalniz | amenities:open✔ | amenities=open | R1=no_info |
| a-wifi-kahvalti | wifi:answered✔ amenities:open✔ | amenities=open wifi=answered | R1=verified R2=no_info |
| a-havuz-bari | amenities:open✖YANLIŞ | amenities=answered | R1=verified |
| a-sarj | parking:open✔ | parking=open | R1=no_info |
| a-de-fruehstueck | amenities:open✔ | amenities=open | R1=rejected(reader_binding) |
| a-en-gym-pool | amenities:answered✔ amenities:open✔ | amenities=open amenities=answered | R1=no_info R2=verified |
| b-kurutma | amenities:answered✔ | amenities=answered | R1=verified |
| b-kahvalti-acik-yok | amenities:answered✔ | amenities=answered | R1=verified |
| b-en-dryer-wifi | amenities:answered✔ wifi:answered✔ | amenities=answered wifi=answered | R1=verified R2=verified |
| c-otopark-celiski | parking:open✔ | parking=open | R1=rejected(reader_binding) |
| c-wifi-otopark-celiski | wifi:answered✔ parking:open✔ | parking=open wifi=answered | R1=verified R2=rejected(reader_binding) |
| d-eczane | local_recommendations:open✔ | local_recommendations=open | R1=no_info |
| d-sauna | amenities:open✔ | amenities=open | R1=no_info |
| d-en-atm-shop | local_recommendations:answered✔ local_recommendations:open✔ | local_recommendations=open local_recommendations=answered | R1=no_info R2=verified |
| d-firin | local_recommendations:open✔ | local_recommendations=open | R1=no_info |
| e-otogar-transfer | directions_transport:open✔ | directions_transport=open | R1=rejected(reader_binding) |
| e-market-saat | local_recommendations:open✔ | local_recommendations=open | R1=no_info |
| e-havuz-ucret | amenities:open✔ | amenities=open | R1=rejected(polarity_mismatch) |
| e-en-pool-heated | amenities:open✔ | amenities=open | R1=rejected(text_missing) |
| e-restoran-mesafe | local_recommendations:open✔ | local_recommendations=open | R1=rejected(reader_binding) |
| f-tr-kedi-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=verified |
| f-de-hund-parken | pets:open✔ parking:answered✖ | parking=open pets=pending_host | R1=verified |
| f-fr-chien-poubelles | pets:open✔ trash:answered✖ | trash=open pets=pending_host | R1=verified |
| f-en-early-wifi | early_checkin:open✔ wifi:answered✖ | early_checkin=open wifi=open | R1=rejected(value_not_in_evidence) R2=verified |
| g-kahvalti-wifi | amenities:open✔ wifi:answered✔ | wifi=answered amenities=open | R1=no_info R2=verified |
| g-havuz-eczane | amenities:answered✔ local_recommendations:open✔ | local_recommendations=open amenities=answered | R1=verified R2=no_info |
| g-eczane-havuz | local_recommendations:open✔ amenities:answered✔ | local_recommendations=open amenities=answered | R1=no_info R2=verified |
| h-wifi | wifi:answered✔ | wifi=answered | R1=verified |
| h-otopark | parking:answered✔ | parking=answered | R1=verified |
| h-havuz-saat | amenities:answered✔ | amenities=answered | R1=verified |
| h-en-trash | trash:answered✔ | trash=answered | R1=verified |
| h-cikis | checkout_time:answered✔ | checkout_time=answered | R1=verified |
| h-de-wlan | wifi:answered✔ | wifi=answered | R1=verified |
| h-market | local_recommendations:answered✔ | local_recommendations=answered | R1=verified |
| h-transfer | directions_transport:answered✔ | directions_transport=answered | R1=verified |
| h-camasir | amenities:answered✔ | amenities=answered | R1=verified |
| h-restoran | local_recommendations:answered✔ | local_recommendations=answered | R1=verified |
| h-uc-soru | wifi:answered✔ parking:answered✔ trash:answered✔ | wifi=answered parking=answered trash=answered | R1=verified R2=verified R3=verified |
| i-uc-soru-bir-bilinmeyen | wifi:answered✔ parking:answered✔ amenities:open✔ | amenities=open wifi=answered parking=answered | R1=verified R2=verified R3=no_info |
| i-en-two-known-one-unknown | wifi:answered✔ trash:answered✔ amenities:open✔ | amenities=open wifi=answered trash=answered | R1=verified R2=verified R3=no_info |
| j-mini-otopark | parking:open✔ | parking=open | R1=no_info |
| j-mini-wifi | wifi:answered✔ | wifi=answered | R1=verified |
| j-mini-wifi-otopark | wifi:answered✔ parking:open✔ | parking=open wifi=answered | R1=verified R2=no_info |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **a-wifi-kahvalti** (near_topic_no_answer/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise \"Lale2024\".\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **a-havuz-bari** (near_topic_no_answer/tr): "Merhaba Alex,\n\nHavuzumuz her gün 09:00–20:00 saatleri arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **a-en-gym-pool** (near_topic_no_answer/en): "Hello Alex,\n\nThe pool is open every day from 09:00 to 20:00.\n\n(This reply was prepared by an automated assistant.)"
- **b-kurutma** (explicit_no/tr): "Merhaba Alex,\n\nKurutma makinesi yoktur.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **b-kahvalti-acik-yok** (explicit_no/tr): "Merhaba Alex,\n\nTesiste kahvaltı servisi bulunmuyor; dairenin mutfağı tam donanımlı olduğu için isterseniz kendi kahvaltınızı hazırlayabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **b-en-dryer-wifi** (explicit_no/en): "Hello Alex,\n\nThere is no tumble dryer in the apartment; only a washing machine in the bathroom and detergent in the cabinet under the sink.\nThe Wi-Fi network is \"Lale_Home\" and the password is \"Lale2024\".\n\n(This reply was prepared by an automated assistant.)"
- **c-wifi-otopark-celiski** (conflict/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifresi Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **d-en-atm-shop** (near_entity/en): "Hello Alex,\n\nThe nearest shop is about 150 meters down the street from the building.\n\n(This reply was prepared by an automated assistant.)"
- **g-kahvalti-wifi** (order/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise \"Lale2024\".\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-havuz-eczane** (order/tr): "Merhaba Alex,\n\nHavuz her gün 09:00–20:00 arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-eczane-havuz** (order/tr): "Merhaba Alex,\n\nHavuzumuz her gün 09:00–20:00 arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-wifi** (control/tr): "Merhaba Alex,\n\nWi-Fi ağımızın adı \"Lale_Home\", şifresi ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-otopark** (control/tr): "Merhaba Alex,\n\nBina arkasındaki açık otoparkı misafirlerimiz ücretsiz olarak kullanabiliyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-havuz-saat** (control/tr): "Merhaba Alex,\n\nHavuz her gün 20:00'de kapanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-en-trash** (control/en): "Hello Alex,\n\nYou can throw the trash into the container located to the right of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **h-cikis** (control/tr): "Merhaba Alex,\n\nÇıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-de-wlan** (control/de): "Hallo Alex,\n\nDas WLAN heißt „Lale_Home“, das Passwort lautet „Lale2024“.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **h-market** (control/tr): "Merhaba Alex,\n\nEn yakın market binanın yaklaşık 150 metre ilerisindedir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-transfer** (control/tr): "Merhaba Alex,\n\nHavalimanı transferini ayarlıyorum, tek yön ücreti 900 TL.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-camasir** (control/tr): "Merhaba Alex,\n\nEvet, banyoda çamaşır makinesi var; deterjan da lavabonun altındaki dolaptadır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-restoran** (control/tr): "Merhaba Alex,\n\nYürüme mesafesinde Deniz Lokantası’nı (balık ağırlıklı) ve Köşe Pide’yi önerebilirim.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-uc-soru** (control/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre \"Lale2024\".\nOtopark bina arkasındaki açık otoparkta ve misafirlerimiz için ücretsiz.\nÇöpleri bina girişinin sağındaki konteynere atabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **i-uc-soru-bir-bilinmeyen** (mixed/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre \"Lale2024\".\nBina arkasındaki açık otoparkı ücretsiz olarak kullanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **i-en-two-known-one-unknown** (mixed/en): "Hello Alex,\n\nThe Wi-Fi network is \"Lale_Home\" and the password is \"Lale2024\".\nYou can leave your trash in the container located to the right of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **j-mini-wifi** (tiny_kb/tr): "Merhaba Alex,\n\nWi-Fi ağımızın adı \"Lale_Home\", şifresi ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **j-mini-wifi-otopark** (tiny_kb/tr): "Merhaba Alex,\n\nWi-Fi ağ adı Lale_Home, şifre Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `8ee48c57`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=(boş)` · `AI_TURN_MESSAGES_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=1` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=1` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
