# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `b81b6618` · satır 15/15 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/held-pet-unknown-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | — |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/1 (0%) |
| dil uyumu misafire giden (TR dışı) | — |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/15 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 5.8 sn / 9.3 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.1202**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 11 | 836 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 38 | 366908 | 342656 | 4701 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| pet_unknown | any | 0 | 5 | 0 | 0/0 | 0 | 0 |
| wifi_unknown | any | 1 | 4 | 0 | 0/0 | 0 | 0 |
| alone_unknown | any | 0 | 5 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 6
- low_confidence_or_risky · handoff_notice · reply_output_veto: 3
- low_confidence_or_risky · low_confidence_or_risky · items_answer_ungrounded: 2
- low_confidence_or_risky · low_confidence_or_risky · reply_internal_source: 1
- low_confidence_or_risky · low_confidence_or_risky · reply_host_voice: 1
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 1/5 (20%) |
| açık kalması gereken ihtiyaç: açık kaldı | 19/20 (95%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 1 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 4 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 20/25 (80%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 1/15 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 5/5 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | — |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 0 |
| S3 · aynı mesajdaki öteki soru: yanlış değer giden (evcil hayvanla ilgisiz) | 0 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| u-pet-eczane | pets:open✔ local_recommendations:open✔ | local_recommendations=open pets=pending_host | — |
| u-wifi-eczane | wifi:answered✖ local_recommendations:open✔ | wifi=open local_recommendations=open | — |
| u-alone-eczane | local_recommendations:open✔ | local_recommendations=open | — |
| u-pet-bebek | pets:open✔ amenities:open✔ | amenities=open pets=pending_host | — |
| u-wifi-bebek | wifi:answered✖ amenities:open✔ | wifi=open amenities=open | — |
| u-alone-bebek | amenities:open✔ | amenities=open | — |
| u-pet-utu | pets:open✔ amenities:open✔ | amenities=open pets=pending_host | — |
| u-wifi-utu | wifi:answered✖ amenities:open✔ | wifi=open amenities=open | — |
| u-alone-utu | amenities:open✔ | amenities=open | — |
| u-pet-transfer | pets:open✔ directions_transport:open✔ | directions_transport=open pets=pending_host | — |
| u-wifi-transfer | wifi:answered✖ directions_transport:open✔ | wifi=open directions_transport=open | — |
| u-alone-transfer | directions_transport:open✔ | directions_transport=open | — |
| u-pet-kahvalti | pets:open✔ amenities:open✔ | pets=pending_host amenities=open | — |
| u-wifi-kahvalti | wifi:answered✔ amenities:open✖ | wifi=answered amenities=answered | — |
| u-alone-kahvalti | amenities:open✔ | amenities=open | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **u-wifi-kahvalti** (wifi_unknown/tr): "Merhaba Alex,\n\nWi-Fi ağ adı Lale_Home, şifresi Lale2024. Kahvaltı hizmeti sunmuyoruz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

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
