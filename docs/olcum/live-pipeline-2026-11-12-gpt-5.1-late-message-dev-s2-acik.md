# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `08e61144` · satır 31/31 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/late-message-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | 0/2 (0%) |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 12/12 (100%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/15 (0%) |
| dil uyumu misafire giden (TR dışı) | 7/7 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | 1/1 (100%) · 1/1 (100%) · 1/1 (100%) |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 3/19 (16%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/31 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 7.2 sn / 9.8 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2291**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 26 | 1193 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 83 | 670811 | 617984 | 8583 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| late_new_question | yes | 8 | 0 | 0 | 0/0 | 0 | 0 |
| late_plus_new | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| late_unknown | no | 1 | 2 | 0 | 0/0 | 0 | 0 |
| late_sensitive | no | 0 | 3 | 0 | 0/0 | 0 | 0 |
| late_closing | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| late_duplicate | no | 2 | 3 | 0 | 0/0 | 0 | 0 |
| late_withdraw | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| emergency | no | 0 | 1 | 1 | 0/0 | 0 | 0 |
| complaint | no | 0 | 1 | 0 | 0/0 | 0 | 0 |
| late_out_of_scope | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| control_normal | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 3
- low_confidence_or_risky · availability_unconfirmed: 2
- closing_ack_open · closing_ack: 2
- low_confidence_or_risky · items_held · items_nothing_answered: 2
- already_answered · -: 2
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1
- low_confidence_or_risky · items_held · reply_pet_policy: 1
- low_confidence_or_risky · handoff_notice · reply_output_veto: 1
- escalated_to_human · escalated_to_human · model_intent: 1
- low_confidence_or_risky · items_held · reply_output_veto: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 13/14 (93%) |
| açık kalması gereken ihtiyaç: açık kaldı | 5/6 (83%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 1 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 1 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 18/20 (90%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 15/31 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 1/1 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | — |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 0 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| lm-tr-wifi-otopark | parking:answered✔ | parking=answered | — |
| lm-tr-otopark-havuz | amenities:answered✔ | amenities=answered | — |
| lm-en-wifi-trash | trash:answered✔ | trash=answered | — |
| lm-de-wlan-markt | local_recommendations:answered✔ | local_recommendations=answered | — |
| lm-tr-wifi-cikis | checkout_time:answered✔ | checkout_time=answered | — |
| lm-es-wifi-piscina | amenities:answered✔ | amenities=answered | — |
| lm-en-checkin-parking | parking:answered✔ | parking=answered | — |
| lm-tr-wifi-klima | appliance_help:answered✔ | appliance_help=answered | — |
| lm-tr-gec-ve-yeni | parking:answered✖ checkout_time:answered✔ | parking=open checkout_time=answered | — |
| lm-en-late-and-new | parking:answered✔ amenities:answered✔ | parking=answered amenities=answered | — |
| lm-tr-eczane | local_recommendations:open✔ | local_recommendations=open | — |
| lm-en-iron | amenities:open✔ | amenities=open | — |
| lm-tr-kahvalti | amenities:open✖ | amenities=answered | — |
| lm-tr-kopek | pets:open✔ | pets=pending_host | — |
| lm-en-late-checkout | late_checkout:open✔ | late_checkout=open | — |
| lm-tr-uzatma | extend_stay:open✔ | extend_stay=open | — |
| k-tr-olagan-otopark | parking:answered✔ | parking=answered | — |
| k-en-normal-trash | trash:answered✔ | trash=answered | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **lm-tr-wifi-otopark** (late_new_question/tr): "Ücretsiz otopark mevcut, binanın arkasına aracınızı park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-tr-otopark-havuz** (late_new_question/tr): "Havuz her gün 09:00 ile 20:00 arasında açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-en-wifi-trash** (late_new_question/en): "You can throw the trash into the container located to the right of the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **lm-de-wlan-markt** (late_new_question/de): "Der nächste Supermarkt ist etwa 150 Meter vom Gebäude entfernt.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **lm-tr-wifi-cikis** (late_new_question/tr): "Çıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-es-wifi-piscina** (late_new_question/es): "La piscina está abierta todos los días de 09:00 a 20:00.\n\n(Esta respuesta fue preparada por un asistente automático.)"
- **lm-en-checkin-parking** (late_new_question/en): "Yes, there is free parking behind the building.\n\n(This reply was prepared by an automated assistant.)"
- **lm-tr-wifi-klima** (late_new_question/tr): "Klima kumandası TV ünitesinin çekmecesindedir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-tr-gec-ve-yeni** (late_plus_new/tr): "Çıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-en-late-and-new** (late_plus_new/en): "The parking is free and located behind the building. The pool is open every day from 09:00 to 20:00.\n\n(This reply was prepared by an automated assistant.)"
- **lm-tr-kahvalti** (late_unknown/tr): "Konaklamaya dahil kahvaltı servisi bulunmuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-tr-tekrar-wifi** (late_duplicate/tr): "Wi-Fi ağı Lale_Home, şifresi Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-de-hallo** (late_duplicate/de): "Das WLAN heißt \"Lale_Home\", das Passwort lautet Lale2024.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k-tr-olagan-otopark** (control_normal/tr): "Evet, ücretsiz otoparkımız var; binanın arkasında park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-normal-trash** (control_normal/en): "You can throw the trash into the container located to the right of the building entrance.\n\n(This reply was prepared by an automated assistant.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `08e61144`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
