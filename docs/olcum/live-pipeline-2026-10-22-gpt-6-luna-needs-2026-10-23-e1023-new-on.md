# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-22)

Durum: **GEÇERLİ** · commit `974a1f46` · satır 32/32 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
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
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/21 (0%) |
| dil uyumu misafire giden (TR dışı) | 5/5 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 1 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 0 · 0 |
| düşen / hata | 0/32 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 9.5 sn / 14.1 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.1001**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 33 | 1834 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 54 | 109343 | 93696 | 4440 | 0 |
| gpt-6-luna | 106 | 742909 | 655077 | 18159 | 5514 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| unknown_topic | any | 2 | 3 | 0 | 0/0 | 0 | 0 |
| conditional | any | 3 | 2 | 0 | 0/0 | 0 | 0 |
| grounded | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| same_kind_double | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| negative_kb | any | 3 | 2 | 0 | 0/0 | 0 | 0 |
| source_question | any | 0 | 2 | 0 | 0/0 | 0 | 0 |
| two_kinds | any | 6 | 0 | 0 | 0/0 | 0 | 0 |
| reference | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| sensitive_mix | any | 0 | 1 | 0 | 0/0 | 0 | 0 |
| value_trap | any | 2 | 1 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · items_nothing_answered: 6
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 2
- low_confidence_or_risky · items_held · items_nothing_answered: 1
- low_confidence_or_risky · items_held · reply_output_veto: 1
- low_confidence_or_risky · availability_unconfirmed: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 24/38 (63%) |
| açık kalması gereken ihtiyaç: açık kaldı | 8/8 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 27/40 (68%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 21/32 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| n-tr-cikis-hamam | checkout_time:answered✔ amenities:open✔ | amenities=open checkout_time=answered | R1=verified R2=no_info |
| n-tr-havuz-kapanis | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-sauna-kapanis | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-havuz-sauna-ikisi | amenities:answered✔ amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-sauna-yok | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-kahvalti | amenities:answered✖ | amenities=open | R1=rejected(value_bound_elsewhere,condition_added,unsupported_content) |
| n-tr-kopek | pets:answered✖ | pets=pending_host | — |
| n-tr-bisiklet | amenities:answered✔ | local_recommendations=answered | R1=verified |
| n-tr-wifi-kaynak | wifi:answered✖ about_assistant:open✔ | wifi=open about_assistant=pending_host | R1=rejected(value_bound_elsewhere) |
| n-tr-kaynak-tek | about_assistant:open✔ | about_assistant=pending_host | — |
| n-tr-jakuzi | amenities:open✔ | amenities=open | R1=no_info |
| n-tr-otopark-eczane | parking:answered✖ local_recommendations:answered✔ | parking=open local_recommendations=answered | R1=rejected(value_bound_elsewhere) R2=verified |
| n-tr-cop-camasir | trash:answered✖ amenities:answered✔ | trash=open amenities=answered | R1=rejected(unsupported_content) R2=verified |
| n-tr-onceki-havuz | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-giris-erken | checkin_time:answered✖ early_checkin:open✔ | checkin_time=open early_checkin=open | R1=verified R2=no_info |
| n-tr-plaj-sezlong | directions_transport:answered✖ amenities:open✔ | directions_transport=open amenities=open | R1=verified R2=no_info |
| n-en-checkout-sauna | checkout_time:answered✔ amenities:answered✔ | checkout_time=answered amenities=answered | R1=verified R2=verified |
| n-en-pool-saturday | amenities:answered✖ | amenities=open | R1=rejected(condition_dropped,condition_added) |
| n-en-breakfast-included | amenities:answered✖ | amenities=open | R1=rejected(value_bound_elsewhere,polarity_mismatch) |
| n-en-smoke-balcony | house_rules:answered✔ | house_rules=answered | R1=verified |
| n-en-gym-wifi | amenities:open✔ wifi:answered✖ | amenities=open wifi=open | R1=no_info R2=verified |
| n-de-pool-sauna | amenities:answered✔ amenities:answered✖ | amenities=answered | R1=verified |
| n-de-hund | pets:answered✔ | pets=answered | R1=verified |
| n-ru-vyezd-parkovka | checkout_time:answered✔ parking:answered✖ | parking=open checkout_time=answered | R1=verified R2=rejected(value_not_in_evidence,value_bound_elsewhere) |
| n-tr-havuz-22-tuzak | amenities:answered✖ | amenities=open | R1=rejected(condition_added) |
| n-tr-sauna-23-tuzak | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-hafta-sonu-kahvalti | amenities:answered✔ | amenities=answered | R1=verified |
| n-tr-bisiklet-ucret | amenities:answered✔ | parking=answered | R1=verified |
| n-tr-hayvan-sigara | pets:answered✔ house_rules:answered✖ | pets=answered house_rules=pending_host | R1=verified |
| n-tr-klima-utu | appliance_help:answered✔ amenities:answered✔ | appliance_help=answered amenities=answered | R1=verified R2=verified |
| n-tr-anahtar-hamam | access_keys:answered✔ amenities:open✔ | amenities=open access_keys=answered | R1=verified R2=no_info |
| n-tr-havaalani | directions_transport:answered✔ | directions_transport=answered | R1=verified |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **n-tr-cikis-hamam** (unknown_topic/tr): "Merhaba Alex,\n\nÇıkış saati 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-havuz-kapanis** (conditional/tr): "Merhaba Alex,\n\nHavuz her gün 20:00'de kapanıyor; hafta sonları 23:00'e kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-sauna-kapanis** (grounded/tr): "Merhaba Alex,\n\nSauna saat 22:00'de kapanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-havuz-sauna-ikisi** (same_kind_double/tr): "Merhaba Alex,\n\nHavuz her gün 20:00'de kapanıyor; hafta sonları 23:00'e kadar açık. Sauna 22:00'de kapanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-sauna-yok** (negative_kb/tr): "Merhaba Alex,\n\nSitede sauna bulunmuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-bisiklet** (conditional/tr): "Merhaba Alex,\n\nBisiklet, talep üzerine günlük 200 TL’ye kiralanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-otopark-eczane** (two_kinds/tr): "Merhaba Alex,\n\nEn yakın eczane binanın 300 metre ilerisindeki köşededir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-cop-camasir** (two_kinds/tr): "Merhaba Alex,\n\nÇamaşır makinesi banyoda.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-onceki-havuz** (reference/tr): "Havuz her gün 20:00'de kapanıyor; hafta sonları 23:00'e kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-en-checkout-sauna** (two_kinds/en): "Hello Alex,\n\nCheck-out is at 11:00.\nThe sauna is on the garden level and closes at 22:00 every day.\n\n(This reply was prepared by an automated assistant.)"
- **n-en-smoke-balcony** (negative_kb/en): "Hello Alex,\n\nSmoking is not allowed on the balcony.\n\n(This reply was prepared by an automated assistant.)"
- **n-de-pool-sauna** (same_kind_double/de): "Hallo Alex,\n\nDer Pool schließt täglich um 20:00 Uhr; am Wochenende ist er bis 23:00 Uhr geöffnet.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **n-de-hund** (negative_kb/de): "Hallo Alex,\n\nHaustiere sind in der Wohnung nicht erlaubt.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **n-ru-vyezd-parkovka** (two_kinds/ru): "Здравствуйте, Alex!\n\nВремя выезда — 11:00.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **n-tr-sauna-23-tuzak** (value_trap/tr): "Merhaba Alex,\n\nSauna 22:00'de kapanıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-hafta-sonu-kahvalti** (conditional/tr): "Merhaba Alex,\n\nHafta sonları kahvaltı 11:00'e kadar veriliyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-bisiklet-ucret** (value_trap/tr): "Merhaba Alex,\n\nBisiklet talep üzerine günlük 200 TL'ye kiralanır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-hayvan-sigara** (two_kinds/tr): "Merhaba Alex,\n\nEvcil hayvan kabul edilmiyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-klima-utu** (two_kinds/tr): "Merhaba Alex,\n\nKlima kumandası TV ünitesinin çekmecesinde.\nÜtü ve ütü masası yatak odası dolabında.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-anahtar-hamam** (unknown_topic/tr): "Merhaba Alex,\n\nÇıkışta anahtarı bina kapısının solundaki gri anahtar kutusuna bırakabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **n-tr-havaalani** (grounded/tr): "Merhaba Alex,\n\nHavaalanına arabayla yaklaşık 45 dakika sürer.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=1` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=1` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` · `AI_ANSWER_PARTS_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `1e56c2312243` (öğe + yabancı dil örneği `5f64e1fa7c8a`) · anlama `dbf61aecd3d8` (kip: items+rules+cfu+prv)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
