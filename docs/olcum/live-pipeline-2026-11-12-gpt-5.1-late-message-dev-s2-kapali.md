# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `08e61144` · satır 31/31 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/late-message-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | 0/2 (0%) |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 4/12 (33%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/4 (0%) |
| dil uyumu misafire giden (TR dışı) | 2/2 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | 1/1 (100%) · 0/1 (0%) · 0/1 (0%) |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/19 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/31 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 0.0 sn / 9.3 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0446**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 6 | 748 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 17 | 126717 | 115200 | 1580 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| late_new_question | yes | 0 | 8 | 0 | 0/0 | 0 | 0 |
| late_plus_new | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| late_unknown | no | 0 | 3 | 0 | 0/0 | 0 | 0 |
| late_sensitive | no | 0 | 3 | 0 | 0/0 | 0 | 0 |
| late_closing | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| late_duplicate | no | 0 | 5 | 0 | 0/0 | 0 | 0 |
| late_withdraw | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| emergency | no | 0 | 1 | 0 | 0/0 | 0 | 0 |
| complaint | no | 0 | 1 | 0 | 0/0 | 0 | 0 |
| late_out_of_scope | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| control_normal | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- already_answered · -: 26
- closing_ack_open · closing_ack_semantic · low_confidence: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 4/14 (29%) |
| açık kalması gereken ihtiyaç: açık kaldı | 6/6 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 10 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 4/4 (100%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 4/31 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 1/1 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | — |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 0 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| lm-tr-wifi-otopark | parking:answered✖ |  | — |
| lm-tr-otopark-havuz | amenities:answered✖ |  | — |
| lm-en-wifi-trash | trash:answered✖ |  | — |
| lm-de-wlan-markt | local_recommendations:answered✖ |  | — |
| lm-tr-wifi-cikis | checkout_time:answered✖ |  | — |
| lm-es-wifi-piscina | amenities:answered✖ |  | — |
| lm-en-checkin-parking | parking:answered✖ |  | — |
| lm-tr-wifi-klima | appliance_help:answered✖ |  | — |
| lm-tr-gec-ve-yeni | parking:answered✖ checkout_time:answered✔ | checkout_time=answered | — |
| lm-en-late-and-new | parking:answered✖ amenities:answered✔ | amenities=answered | — |
| lm-tr-eczane | local_recommendations:open✔ |  | — |
| lm-en-iron | amenities:open✔ |  | — |
| lm-tr-kahvalti | amenities:open✔ |  | — |
| lm-tr-kopek | pets:open✔ |  | — |
| lm-en-late-checkout | late_checkout:open✔ |  | — |
| lm-tr-uzatma | extend_stay:open✔ |  | — |
| k-tr-olagan-otopark | parking:answered✔ | parking=answered | — |
| k-en-normal-trash | trash:answered✔ | trash=answered | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **lm-tr-gec-ve-yeni** (late_plus_new/tr): "Çıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **lm-en-late-and-new** (late_plus_new/en): "The pool is open every day from 09:00 to 20:00.\n\n(This reply was prepared by an automated assistant.)"
- **k-tr-olagan-otopark** (control_normal/tr): "Ücretsiz otoparkımız bulunuyor, binanın arka tarafında park edebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-normal-trash** (control_normal/en): "You can throw the trash into the container on the right side of the building entrance.\n\n(This reply was prepared by an automated assistant.)"

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
