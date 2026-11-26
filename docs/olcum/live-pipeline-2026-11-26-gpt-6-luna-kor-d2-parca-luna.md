# Canlı hat — MÜHÜRLÜ KÖR SET (grounding-kabul-2026-11-26.json) — gpt-6-luna (2026-11-26)

Durum: **GEÇERLİ** · commit `9b959231` · satır 97/97 · maliyet $0.2952
Parça kipi: `AI_ANSWER_PARTS_ENABLED=1` · okuyucu: `AI_SENIOR_READER_ENABLED=1` · evcil hayvan ayrımı: `AI_HELD_PET_SPLIT_ENABLED=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle giden | 46/68 (68%) |
| GEREKSİZ TUTMA (cevabı olan ihtiyaç misafire gitmedi / eksik gitti) | 20 |
| ↳ bunların içinde: metin GİTTİ ama bu ihtiyacın beklenen değeri yok (atlanmış ihtiyaç ya da ölçerin göremediği yanlış değer — ayrıntı dosyasından incelenir) | 1 |
| açık kalması gereken ihtiyaç: açık kaldı | 48/51 (94%) |
| 🚨 YANLIŞ GÖNDERİM (yanlış değer / yanlış "cevaplandı"; hedef 0) | 5 |
| 🚨 "bilgim yok" / iç kaynak anlatımı giden (hedef 0) | 0 |
| giden mesaj | 50/97 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 7/7 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 0/7 (0%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 7 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

Senaryo kimlikleri: `ctl-tr-wifi` `ctl-tr-sessiz` `ctl-en-wifi` `ctl-en-bavul` `ctl-de-muell` `ctl-fr-poubelle` `ctl-es-piscina` `ctl-ru-parkovka` `ctl-ar-wifi` `ctl-tr-mini-wifi` `ctl-en-deterjan` `ctl-tr-taksi` `yakin-tr-havuz-isitma` `yakin-en-mama-sandalyesi` `yakin-de-grill` `yakin-fr-klima-isitma` `yakin-es-socorrista` `yakin-ru-ikinci-arac` `yakin-ar-havuz-derinlik` `yakin-tr-sezlong` `yakin-tr-utu` `yakin-en-park-suresi` `yakin-tr-mini-wifi-hiz` `karma-tr-wifi-otobus` `karma-en-bulasik-gec-cikis` `karma-de-ruhe-fahrrad` `karma-fr-park-bebek` `karma-es-ascensor-basura` `karma-ru-kod-erken` `karma-ar-plaj-metro` `karma-tr-anahtar-kod-araba` `karma-en-fon-transfer` `karma-tr-bebek-sigara-kuafor` `karma-tr-camasir-wifi` `karma-fr-giris-spor` `karma-tr-mini-kod-havlu` `iki-tr-kapali-otopark` `iki-en-sokak-park` `iki-de-trockner` `iki-tr-geri-donusum` `iki-fr-serviette-plage` `iki-es-cargador` `iki-en-bulasik` `iki-ru-klima-salon` `iki-tr-garaj-ucret` `iki-ar-kahve` `yasak-en-balkon-sigara` `yasak-de-party` `yasak-ru-kurenie` `yasak-es-fiesta` `yasak-fr-parasol` `yasak-ar-tadkhin` `yasak-tr-dogum-gunu` `yasak-ar-hafla` `yasak-tr-semsiye` `celiski-tr-wifi` `celiski-en-wifi` `celiski-de-parkgebuehr` `celiski-tr-temizlik` `celiski-fr-piscine` `celiski-es-codigo` `celiski-ru-transfer` `celiski-ar-hudu` `celiski-en-park` `celiski-tr-kapi-kodu` `celiski-tr-transfer` `deger-tr-otogar` `deger-en-eczane` `deger-de-endreinigung` `deger-fr-taxi-gare` `deger-es-panaderia` `deger-ru-taksi-vokzal` `deger-ar-ek-yatak` `deger-tr-merkez-taksi` `deger-tr-havaalani-taksi` `sir-en-anahtar-kutusu` `sir-de-notfall-telefon` `sir-tr-kapi-kodu` `sir-fr-wifi` `sir-es-mini-caja` `sir-ru-mini-wifi` `sir-ar-kapi` `sir-tr-acil-telefon` `sir-tr-en-wifi` `tut-tr-kopek-wifi` `tut-en-kedi-park` `tut-de-hund-waschmaschine` `tut-fr-chien-code` `tut-ru-koshka-musor` `tut-ar-kalb-wifi` `tut-tr-mini-kedi-wifi` `takip-tr-transfer-ucret` `takip-en-park-ucretsiz` `takip-de-pool-saat` `takip-es-lavavajillas` `takip-ru-sushilka` `takip-fr-parking-couvert`

Neden defteri (öneri, ölçer kendisi yazmaz): `node scripts/neden-defteri.mjs ekle docs/olcum/live-pipeline-2026-11-26-gpt-6-luna-kor-d2-parca-luna-ayrinti.json && node scripts/neden-defteri.mjs ozet`

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `9b959231`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-6-luna` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=1` · `AI_TURN_MESSAGES_ENABLED=(boş)` · `AI_REPLY_LANGUAGE_SHADOW_ENABLED=(boş)` · `AI_HOST_COMMITMENT_READER_ENABLED=(boş)` · `AI_REPLY_ITEMS_READER_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=1` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=1` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=1` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `e6dde68a75a6` (öğe + yabancı dil örneği `95d27009860c`) · anlama `31599f891f50` (kip: items+rules+cfu+prv+fee+flt)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
