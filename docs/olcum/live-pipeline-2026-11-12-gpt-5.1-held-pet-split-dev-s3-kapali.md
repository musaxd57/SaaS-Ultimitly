# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `04d90bca` · satır 27/27 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/held-pet-split-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 3/23 (13%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/3 (0%) |
| dil uyumu misafire giden (TR dışı) | — |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/3 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/27 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 6.3 sn / 7.9 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2584**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 28 | 1579 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 78 | 662045 | 582144 | 8568 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| pet_split | yes | 0 | 18 | 0 | 0/0 | 0 | 0 |
| assist_split | yes | 0 | 2 | 0 | 0/0 | 0 | 0 |
| control_pet_only | no | 0 | 2 | 0 | 0/0 | 0 | 0 |
| control_free | yes | 1 | 0 | 0 | 0/0 | 0 | 0 |
| control_info | yes | 2 | 0 | 0 | 0/0 | 0 | 0 |
| control_other | no/any | 0 | 2 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_pet_policy: 21
- low_confidence_or_risky · items_held · reply_pet_policy: 3

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 4/25 (16%) |
| açık kalması gereken ihtiyaç: açık kaldı | 25/25 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 21 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 29/50 (58%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 3/27 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| ps-tr-kopek-wifi | pets:open✔ wifi:answered✖ | pets=pending_host wifi=open | — |
| ps-tr-kedi-otopark-fee | pets:open✔ parking:answered✖ | parking=open pets=pending_host | — |
| ps-tr-kopek-havuz-ban | pets:open✔ amenities:answered✖ | amenities=open pets=pending_host | — |
| ps-en-dog-wifi | pets:open✔ wifi:answered✖ | pets=pending_host wifi=open | — |
| ps-en-cat-checkin-fee | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | — |
| ps-de-hund-wlan | pets:open✔ wifi:answered✖ | pets=pending_host wifi=open | — |
| ps-fr-chien-parking-fee | pets:open✔ parking:answered✖ | parking=open pets=pending_host | — |
| ps-es-perro-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-ru-sobaka-wifi-ban | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-ar-kalb-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-tr-adiyla-cikis | pets:open✔ checkout_time:answered✖ | checkout_time=open pets=pending_host | — |
| ps-tr-wifi-sonra-ucret | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-en-three-ban | pets:open✔ wifi:answered✖ parking:answered✖ | wifi=open parking=open pets=pending_host | — |
| ps-tr-iki-mesaj | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-tr-beyan-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| ps-tr-evethayir-otopark-ban | pets:open✔ parking:answered✖ | parking=open pets=pending_host | — |
| ps-en-evethayir-pool | pets:open✔ amenities:answered✖ | amenities=open pets=pending_host | — |
| ps-de-katze-parken-fee | pets:open✔ parking:answered✖ | parking=open pets=pending_host | — |
| as-tr-rehber-wifi | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | — |
| as-en-service-checkin | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | — |
| c-tr-yalniz-kopek | pets:open✔ | pets=pending_host | — |
| c-en-pets-allowed-fee | pets:open✔ | pets=pending_host | — |
| c-tr-ucretsiz-kabul | pets:answered✔ wifi:answered✔ | pets=answered wifi=answered | — |
| c-tr-yalniz-wifi | wifi:answered✔ | wifi=answered | — |
| c-tr-otopark-evet | parking:answered✔ | parking=answered | — |
| c-tr-kopek-sikayet | pets:open✔ | pets=pending_host complaint_issue=pending_host appliance_help=pending_host | — |
| c-tr-kopek-bilinmeyen | pets:open✔ local_recommendations:open✔ | local_recommendations=open pets=pending_host | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **c-tr-ucretsiz-kabul** (control_free/tr): "Merhaba Alex,\n\nEvcil hayvanlarınızı, köpeğiniz dahil, ücretsiz olarak getirebilirsiniz. Wi-Fi ağ adı \"Lale_Home\", şifre ise Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-yalniz-wifi** (control_info/tr): "Merhaba Alex,\n\nWi-Fi ağımızın adı \"Lale_Home\", şifresi Lale2024.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-otopark-evet** (control_info/tr): "Merhaba Alex,\n\nOtopark mevcut ve ücretsiz, binanın arkasında yer alıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `04d90bca`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
