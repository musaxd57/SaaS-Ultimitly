# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `b81b6618` · satır 29/29 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/held-pet-split-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 21/23 (91%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/21 (0%) |
| dil uyumu misafire giden (TR dışı) | 9/9 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/3 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/29 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 7.0 sn / 9.6 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2643**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 28 | 1605 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 103 | 739980 | 681600 | 10606 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| pet_split | yes | 17 | 1 | 0 | 0/0 | 0 | 0 |
| assist_split | yes | 1 | 1 | 0 | 0/0 | 0 | 0 |
| control_pet_only | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| control_free | yes | 1 | 0 | 0 | 0/0 | 0 | 0 |
| control_info | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| control_other | no/any | 0 | 4 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · availability_unconfirmed: 2
- low_confidence_or_risky · items_held · reply_pet_policy: 2
- low_confidence_or_risky · items_held · reply_output_veto: 1
- low_confidence_or_risky · low_confidence_or_risky · items_answer_ungrounded: 1
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 23/26 (88%) |
| açık kalması gereken ihtiyaç: açık kaldı | 27/27 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 3 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 50/53 (94%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 21/29 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 24/24 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 19/21 (90%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 2 |
| S3 · aynı mesajdaki öteki soru: yanlış değer giden (evcil hayvanla ilgisiz) | 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| ps-tr-kopek-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-tr-kedi-otopark-fee | pets:open✔ parking:answered✔ | parking=answered pets=pending_host | — |
| ps-tr-kopek-havuz-ban | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | — |
| ps-en-dog-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-en-cat-checkin-fee | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | — |
| ps-de-hund-wlan | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-fr-chien-parking-fee | pets:open✔ parking:answered✔ | parking=answered pets=pending_host | — |
| ps-es-perro-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-ru-sobaka-wifi-ban | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-ar-kalb-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-tr-adiyla-cikis | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | — |
| ps-tr-wifi-sonra-ucret | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-en-three-ban | pets:open✔ wifi:answered✔ parking:answered✔ | wifi=answered parking=answered pets=pending_host | — |
| ps-tr-iki-mesaj | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-tr-beyan-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| ps-tr-evethayir-otopark-ban | pets:open✔ parking:answered✔ | parking=answered pets=pending_host | — |
| ps-en-evethayir-pool | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | — |
| ps-de-katze-parken-fee | pets:open✔ parking:answered✔ | parking=answered pets=pending_host | — |
| as-tr-rehber-wifi | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | — |
| as-en-service-checkin | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | — |
| c-tr-yalniz-kopek | pets:open✔ | pets=pending_host | — |
| c-en-pets-allowed-fee | pets:open✔ | pets=pending_host | — |
| c-tr-ucretsiz-kabul | pets:answered✔ wifi:answered✔ | pets=answered wifi=answered | — |
| c-tr-yalniz-wifi | wifi:answered✔ | wifi=answered | — |
| c-tr-otopark-evet | parking:answered✔ | parking=answered | — |
| c-tr-kopek-sikayet | pets:open✔ | pets=pending_host complaint_issue=pending_host appliance_help=pending_host | — |
| c-tr-kopek-bilinmeyen | pets:open✔ local_recommendations:open✔ | local_recommendations=open pets=pending_host | — |
| c-tr-eczane-yalniz | local_recommendations:open✔ | local_recommendations=open | — |
| c-tr-wifi-eczane | wifi:answered✖ local_recommendations:open✔ | wifi=open local_recommendations=open | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **ps-tr-kopek-wifi** (pet_split/tr): "Merhaba Alex,\n\nWi-Fi ağının adı \"Lale_Home\", şifresi Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-kedi-otopark-fee** (pet_split/tr): "Merhaba Alex,\n\nOtopark ücretsiz ve binanın arkasında bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-kopek-havuz-ban** (pet_split/tr): "Merhaba Alex,\n\nHavuz her gün 20:00'de kapanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-en-dog-wifi** (pet_split/en): "Hello Alex,\n\nThe Wi-Fi network name is \"Lale_Home\" and the password is \"Lale2024\".\n\n(This reply was prepared by an automated assistant.)"
- **ps-de-hund-wlan** (pet_split/de): "Hallo Alex,\n\nDas WLAN-Netz heißt „Lale_Home“ und das Passwort lautet Lale2024.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **ps-fr-chien-parking-fee** (pet_split/fr): "Bonjour Alex,\n\nLe parking est gratuit et se trouve à l’arrière de l’immeuble.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **ps-es-perro-wifi** (pet_split/es): "Hola Alex,\n\nLa red Wi‑Fi se llama \"Lale_Home\" y la contraseña es Lale2024.\n\n(Esta respuesta fue preparada por un asistente automático.)"
- **ps-ru-sobaka-wifi-ban** (pet_split/ru): "Здравствуйте, Alex!\n\nПароль от Wi‑Fi: сеть называется \"Lale_Home\", пароль Lale2024.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **ps-ar-kalb-wifi** (pet_split/ar): "مرحباً Alex،\n\nشبكة الواي فاي اسمها Lale_Home وكلمة المرور هي Lale2024. جهاز المودم موجود تحت وحدة التلفاز في الصالة.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **ps-tr-adiyla-cikis** (pet_split/tr): "Merhaba Alex,\n\nÇıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-wifi-sonra-ucret** (pet_split/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-en-three-ban** (pet_split/en): "Hello Alex,\n\nThe Wi-Fi network is \"Lale_Home\" and the password is \"Lale2024\". You can park your car for free in the parking area behind the building.\n\n(This reply was prepared by an automated assistant.)"
- **ps-tr-iki-mesaj** (pet_split/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-beyan-wifi** (pet_split/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-evethayir-otopark-ban** (pet_split/tr): "Merhaba Alex,\n\nOtopark ücretsizdir ve binanın arkasındadır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-en-evethayir-pool** (pet_split/en): "Hello Alex,\n\nThe pool is open every day from 09:00 to 20:00.\n\n(This reply was prepared by an automated assistant.)"
- **ps-de-katze-parken-fee** (pet_split/de): "Hallo Alex,\n\nEs gibt einen kostenlosen Parkplatz hinter dem Gebäude.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **as-tr-rehber-wifi** (assist_split/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-ucretsiz-kabul** (control_free/tr): "Merhaba Alex,\n\nEvcil hayvanlarınızı, köpeğiniz dahil, ücretsiz olarak getirebilirsiniz. Wi-Fi ağ adı \"Lale_Home\", şifre ise \"Lale2024\".\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-yalniz-wifi** (control_info/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-otopark-evet** (control_info/tr): "Merhaba Alex,\n\nBinanın arkasında ücretsiz otopark bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `b81b6618`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
