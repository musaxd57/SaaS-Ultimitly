# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `65097161` · satır 15/15 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
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
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/12 (0%) |
| dil uyumu misafire giden (TR dışı) | 6/6 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/15 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 13.0 sn / 17.2 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2128**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 14 | 1017 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 97 | 470502 | 427648 | 10577 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| two_known | yes | 4 | 0 | 0 | 0/0 | 0 | 0 |
| three_known | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| known_then_thanks | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| unknown_then_known | any | 1 | 1 | 0 | 0/0 | 0 | 0 |
| sensitive_then_known | any | 0 | 2 | 0 | 0/0 | 0 | 0 |
| same_twice | yes | 1 | 0 | 0 | 0/0 | 0 | 0 |
| control_single | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1
- low_confidence_or_risky · low_confidence_or_risky · reply_pet_policy: 1
- low_confidence_or_risky · availability_unconfirmed: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 20/23 (87%) |
| açık kalması gereken ihtiyaç: açık kaldı | 4/4 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 3 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 23/26 (88%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 12/15 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 1/1 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 0/1 (0%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 1 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| tm-tr-iki-bilinen | parking:answered✔ checkout_time:answered✔ | parking=answered checkout_time=answered | R1=verified R2=verified |
| tm-en-two-known | parking:answered✔ trash:answered✔ | trash=answered parking=answered | R1=verified R2=verified |
| tm-de-zwei-bekannt | parking:answered✔ amenities:answered✔ | parking=answered amenities=answered | R1=verified R2=verified |
| tm-fr-deux-connues | parking:answered✔ trash:answered✔ | parking=answered trash=answered | R1=verified R2=verified |
| tm-tr-uc-bilinen | parking:answered✔ trash:answered✔ amenities:answered✔ | parking=answered trash=answered amenities=answered | R1=verified R2=verified R3=verified |
| tm-en-three-known | parking:answered✔ wifi:answered✔ checkout_time:answered✔ | parking=answered wifi=answered checkout_time=answered | R1=verified R2=verified R3=verified |
| tm-tr-soru-sonra-tesekkur | parking:answered✔ | parking=answered | R1=verified |
| tm-en-question-then-thanks | trash:answered✔ | trash=answered | R1=verified |
| tm-en-unknown-then-known | amenities:open✔ trash:answered✖ | amenities=open trash=open | R1=no_info R2=verified |
| tm-tr-bilinmeyen-sonra-bilinen | local_recommendations:open✔ parking:answered✔ | local_recommendations=open parking=answered | R1=no_info R2=verified |
| tm-tr-evcil-sonra-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=verified |
| tm-en-latecheckout-then-trash | late_checkout:open✔ trash:answered✖ | late_checkout=open trash=open | R1=rejected(value_not_in_evidence) R2=verified |
| tm-tr-ayni-soru-iki-kez | wifi:answered✔ | wifi=superseded wifi=answered | R1=verified |
| tm-tr-tek-mesaj | parking:answered✔ | parking=answered | R1=verified |
| tm-en-single | checkout_time:answered✔ | checkout_time=answered | R1=verified |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **tm-tr-iki-bilinen** (two_known/tr): "Otopark ücretsizdir ve binanın arkasındadır.\nÇıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-two-known** (two_known/en): "Parking is free and located behind the building.\nYou can throw the trash into the container on the right side of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **tm-de-zwei-bekannt** (two_known/de): "Es gibt einen kostenlosen Parkplatz hinter dem Gebäude.\nDer Pool ist täglich von 09:00 bis 20:00 Uhr geöffnet.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **tm-fr-deux-connues** (two_known/fr): "Il y a un parking gratuit derrière l’immeuble.\nVous pouvez déposer les poubelles dans le conteneur à droite de l’entrée de l’immeuble.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **tm-tr-uc-bilinen** (three_known/tr): "Otoparkımız ücretsizdir ve binanın arkasındadır.\nÇöpleri bina girişinin sağındaki konteynere atabilirsiniz.\nHavuz her gün 09:00 ile 20:00 arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-three-known** (three_known/en): "There is free parking at the back of the building.\nThe Wi-Fi network is \"Lale_Home\" and the password is \"Lale2024\".\nCheck-out time is 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **tm-tr-soru-sonra-tesekkur** (known_then_thanks/tr): "Otoparkımız vardır, ücretsizdir ve binanın arkasındadır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-question-then-thanks** (known_then_thanks/en): "You can leave the trash in the container on the right side of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **tm-tr-bilinmeyen-sonra-bilinen** (unknown_then_known/tr): "Otoparkımız ücretsizdir ve binanın arkasındadır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-tr-ayni-soru-iki-kez** (same_twice/tr): "Wi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-tr-tek-mesaj** (control_single/tr): "Evet, otoparkımız ücretsiz ve binanın arkasında bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **tm-en-single** (control_single/en): "Check-out time is 11:00.\n\n(This reply was prepared by an automated assistant.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `65097161`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=1` · `AI_TURN_MESSAGES_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=1` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=1` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `557dc3a41258`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
