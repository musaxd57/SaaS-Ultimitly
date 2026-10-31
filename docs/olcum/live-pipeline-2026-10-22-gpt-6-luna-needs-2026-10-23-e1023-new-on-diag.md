# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-22)

Durum: **GEÇERLİ** · commit `974a1f46` · satır 8/8 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/needs-2026-10-23.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=low`

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
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/4 (0%) |
| dil uyumu misafire giden (TR dışı) | 2/2 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 1 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/8 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 10.6 sn / 11.8 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0241**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 9 | 1069 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 14 | 27734 | 24448 | 1160 | 0 |
| gpt-6-luna | 20 | 178125 | 160973 | 3935 | 1026 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| conditional | any | 0 | 2 | 0 | 0/0 | 0 | 0 |
| source_question | any | 0 | 1 | 0 | 0/0 | 0 | 0 |
| two_kinds | any | 3 | 0 | 0 | 0/0 | 0 | 0 |
| negative_kb | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| value_trap | any | 0 | 1 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · items_nothing_answered: 4

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 4/11 (36%) |
| açık kalması gereken ihtiyaç: açık kaldı | 1/1 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 5/12 (42%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 4/8 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| n-tr-kahvalti | amenities:answered✖ | amenities=open | R1=rejected(value_bound_elsewhere,condition_added) |
| n-tr-wifi-kaynak | wifi:answered✖ about_assistant:open✔ | wifi=open about_assistant=pending_host | R1=rejected(value_bound_elsewhere) |
| n-tr-otopark-eczane | parking:answered✖ local_recommendations:answered✔ | parking=open local_recommendations=answered | R1=rejected(value_bound_elsewhere) R2=verified |
| n-tr-cop-camasir | trash:answered✖ amenities:answered✔ | trash=open amenities=answered | R1=rejected(unsupported_content) R2=verified |
| n-en-pool-saturday | amenities:answered✖ | amenities=open | R1=rejected(condition_dropped,condition_added) |
| n-en-breakfast-included | amenities:answered✔ | amenities=answered | R1=verified |
| n-ru-vyezd-parkovka | checkout_time:answered✔ parking:answered✖ | parking=open checkout_time=answered | R1=verified R2=rejected(value_not_in_evidence,value_bound_elsewhere) |
| n-tr-havuz-22-tuzak | amenities:answered✖ | amenities=open | R1=rejected(condition_added) |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **n-tr-otopark-eczane** (two_kinds/tr): "Merhaba Alex,\n\nEn yakın eczane binanın 300 metre ilerisinde, köşededir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-cop-camasir** (two_kinds/tr): "Merhaba Alex,\n\nÇamaşır makinesi banyodadır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-en-breakfast-included** (negative_kb/en): "Hello Alex,\n\nBreakfast is not included in the price.\n\n(This reply was prepared by an automated assistant.)"
- **n-ru-vyezd-parkovka** (two_kinds/ru): "Здравствуйте, Alex!\n\nВыезд до 11:00.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `974a1f46`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=1` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=1` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ITEM_ORDINAL_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1e56c2312243` (öğe + yabancı dil örneği `5f64e1fa7c8a`) · anlama `dbf61aecd3d8` (kip: items+rules+cfu+prv)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
