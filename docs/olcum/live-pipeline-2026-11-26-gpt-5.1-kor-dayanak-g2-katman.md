# Canlı hat — MÜHÜRLÜ KÖR SET (grounding-kabul-2026-11-12.json) — gpt-5.1 (2026-11-26)

Durum: **GEÇERLİ** · commit `f9c4c5dd` · satır 74/74 · maliyet $0.8407
Parça kipi: `AI_ANSWER_PARTS_ENABLED=(boş)` · okuyucu: `AI_SENIOR_READER_ENABLED=(boş)` · evcil hayvan ayrımı: `AI_HELD_PET_SPLIT_ENABLED=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle giden | 45/64 (70%) |
| GEREKSİZ TUTMA (cevabı olan ihtiyaç misafire gitmedi / eksik gitti) | 19 |
| ↳ bunların içinde: metin GİTTİ ama bu ihtiyacın beklenen değeri yok (atlanmış ihtiyaç ya da ölçerin göremediği yanlış değer — ayrıntı dosyasından incelenir) | 0 |
| açık kalması gereken ihtiyaç: açık kaldı | 43/54 (80%) |
| 🚨 YANLIŞ GÖNDERİM (yanlış değer / yanlış "cevaplandı"; hedef 0) | 11 |
| 🚨 "bilgim yok" / iç kaynak anlatımı giden (hedef 0) | 0 |
| giden mesaj | 43/74 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 3/3 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 0/3 (0%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 3 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 0 |

Senaryo kimlikleri: `nt1` `nt2` `nt3` `nt4` `nt5` `nt6` `en1` `en2` `en3` `en4` `en5` `en6` `en7` `en8` `cf1` `cf2` `cf3` `cf4` `cf5` `ne1` `ne2` `ne3` `ne4` `ne5` `ne6` `vt1` `vt2` `vt3` `vt4` `vt5` `vt6` `vt8` `hp1` `hp2` `hp3` `hp4` `hp5` `hp6` `hp7` `hp8` `hp9` `hp10` `or1a` `or1b` `or2a` `or2b` `or3a` `or3b` `c1` `c2` `c3` `c4` `c5` `c6` `c7` `c8` `c9` `c10` `c11` `c12` `m1` `m2` `m3` `m4` `m5` `m6` `m7` `m8` `t1` `t2` `t3` `t4` `t5` `t6`

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `f9c4c5dd`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=1` · `AI_TURN_MESSAGES_ENABLED=(boş)` · `AI_REPLY_LANGUAGE_SHADOW_ENABLED=(boş)` · `AI_HOST_COMMITMENT_READER_ENABLED=(boş)` · `AI_REPLY_ITEMS_READER_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=1` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `e6dde68a75a6` (öğe + yabancı dil örneği `95d27009860c`) · anlama `31599f891f50` (kip: items+rules+cfu+prv+fee+flt)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
