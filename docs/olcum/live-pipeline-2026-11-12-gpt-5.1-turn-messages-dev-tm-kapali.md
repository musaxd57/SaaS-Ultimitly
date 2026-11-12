# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `a8eec7bf` · satır 15/15 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/turn-messages-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 11/11 (100%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/13 (0%) |
| dil uyumu misafire giden (TR dışı) | 7/7 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/15 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 8.3 sn / 12.6 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.1387**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 14 | 1032 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 53 | 384620 | 354048 | 5620 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| two_known | yes | 4 | 0 | 0 | 0/0 | 0 | 0 |
| three_known | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| known_then_thanks | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| unknown_then_known | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| sensitive_then_known | any | 0 | 2 | 0 | 0/0 | 0 | 0 |
| same_twice | yes | 1 | 0 | 0 | 0/0 | 0 | 0 |
| control_single | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_pet_policy: 1
- low_confidence_or_risky · availability_unconfirmed: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 15/23 (65%) |
| açık kalması gereken ihtiyaç: açık kaldı | 4/4 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 8 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 18/26 (69%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 13/15 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 1/1 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 0/1 (0%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 1 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| tm-tr-iki-bilinen | parking:answered✔ checkout_time:answered✔ | parking=answered checkout_time=answered | — |
| tm-en-two-known | parking:answered✖ trash:answered✔ | parking=open trash=answered | — |
| tm-de-zwei-bekannt | parking:answered✖ amenities:answered✔ | parking=open amenities=answered | — |
| tm-fr-deux-connues | parking:answered✔ trash:answered✔ | parking=answered trash=answered | — |
| tm-tr-uc-bilinen | parking:answered✖ trash:answered✖ amenities:answered✔ | parking=open trash=open amenities=answered | — |
| tm-en-three-known | parking:answered✖ wifi:answered✖ checkout_time:answered✔ | checkout_time=answered parking=open wifi=open | — |
| tm-tr-soru-sonra-tesekkur | parking:answered✔ | parking=answered | — |
| tm-en-question-then-thanks | trash:answered✔ | trash=answered | — |
| tm-en-unknown-then-known | amenities:open✔ trash:answered✔ | amenities=open trash=answered | — |
| tm-tr-bilinmeyen-sonra-bilinen | local_recommendations:open✔ parking:answered✔ | local_recommendations=open parking=answered | — |
| tm-tr-evcil-sonra-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| tm-en-latecheckout-then-trash | late_checkout:open✔ trash:answered✖ | late_checkout=open trash=open | — |
| tm-tr-ayni-soru-iki-kez | wifi:answered✔ | wifi=superseded wifi=answered | — |
| tm-tr-tek-mesaj | parking:answered✔ | parking=answered | — |
| tm-en-single | checkout_time:answered✔ | checkout_time=answered | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **tm-tr-iki-bilinen** (two_known/tr): "Çıkış saatimiz 11:00. Otopark ücretsizdir, binanın arkasında park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-two-known** (two_known/en): "You can throw the trash into the container on the right side of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **tm-de-zwei-bekannt** (two_known/de): "Der Pool ist täglich von 09:00 bis 20:00 geöffnet.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **tm-fr-deux-connues** (two_known/fr): "Vous pouvez déposer vos poubelles dans le conteneur à droite de l’entrée de l’immeuble. Pour le stationnement, le parking gratuit se trouve derrière le bâtiment.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **tm-tr-uc-bilinen** (three_known/tr): "Havuz her gün 09:00 ile 20:00 arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-three-known** (three_known/en): "Check-out is at 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **tm-tr-soru-sonra-tesekkur** (known_then_thanks/tr): "Otopark ücretsizdir; binanın arkasında park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-question-then-thanks** (known_then_thanks/en): "You can throw the trash into the container located to the right of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **tm-en-unknown-then-known** (unknown_then_known/en): "You can leave your trash in the container on the right side of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **tm-tr-bilinmeyen-sonra-bilinen** (unknown_then_known/tr): "Otopark ücretsizdir, binanın arkasında yer alıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-tr-ayni-soru-iki-kez** (same_twice/tr): "Wi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-tr-tek-mesaj** (control_single/tr): "Ücretsiz otoparkımız var, binanın arkasında park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-single** (control_single/en): "Check-out time is 11:00.\n\n(This reply was prepared by an automated assistant.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `a8eec7bf`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=(boş)` · `AI_TURN_MESSAGES_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
