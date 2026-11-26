# Anlama ölçümü — mühürlü kör set — kol live (2026-11-26)

Durum: **GEÇERLİ** · senaryo 72/72 · istek 108 · denetçi gpt-5.1 · tahmini maliyet $0.81

Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.

### Anlama (modelin kendisi — ilişki işareti varsayılmadı)

| ölçü | değer |
|---|---|
| beklenen istek bulundu (niyet + mesaj) | 98/108 (91%) |
| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | 2/108 (2%) |
| 🚨 kaçan istek | 8/108 (7%) |
| fazla istek (beklenende karşılığı yok) | 16 |
| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | 97/98 (99%) |
| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | 5/5 · 0 |
| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | 11/15 · 0 · 4 |
| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | 2/2 · 0 |

### Son misafir sonucu (istek bazında)

| beklenen | sonuç | değer |
|---|---|---|
| cevap | doğru (olgu bağı doğrulandı) | 37/62 (60%) |
| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | 10/62 (16%) |
| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | 5/62 (8%) |
| cevap | gereksiz tutuldu — ev sahibinde açık | 10/62 (16%) |
| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | 0/62 (0%) |
| tut | doğru tutuldu — ev sahibinde açık | 40/42 (95%) |
| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | 0/42 (0%) |
| tut | 🚨 tutuldu ama sessiz düştü | 2/42 (5%) |
| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | 4/4 (100%) |
| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | 0 / 0 |
| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | 10/13 (77%) |
| senaryo | bütün istekleri doğru | 57/72 (79%) |
| 🚨 yasak dize misafire giden | 0 | |
| bilgi | ürün cevap modelini kullanmadı (not_model) | 0 |

### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)

| destek | sayı |
|---|---|
| supported | 84 |
| misbound | 1 |
| contradicted | 0 |
| unsupported | 3 |
| unverified | 1 |
| process | 35 |
| denetçi düştü | 0 |

### Etiket / dil kırılımı (istek doğru)

| kırılım | doğru |
|---|---|
| appliance_usage | 1/1 (100%) |
| complaint_ambiguous | 4/4 (100%) |
| complaint_dependent | 23/25 (92%) |
| complaint_independent | 8/10 (80%) |
| conditional | 6/10 (60%) |
| emergency | 4/4 (100%) |
| fix_recipe | 7/10 (70%) |
| followup_in_kb | 1/2 (50%) |
| greeting | — |
| hazard | 8/8 (100%) |
| independent | 1/2 (50%) |
| missing_info | 3/3 (100%) |
| missing_info_contrast | 3/3 (100%) |
| multi_turn | 13/17 (76%) |
| neighbor_entity | 32/40 (80%) |
| no_recipe | 4/4 (100%) |
| pair_same_words | 33/36 (92%) |
| relation_type | 17/21 (81%) |
| safety_info | 1/1 (100%) |
| secret | 1/1 (100%) |
| stay_change | 7/9 (78%) |
| two_unanswered | 5/6 (83%) |
| dil ar | 5/8 (63%) |
| dil de | 10/10 (100%) |
| dil en | 12/16 (75%) |
| dil es | 9/10 (90%) |
| dil fr | 7/8 (88%) |
| dil ru | 5/7 (71%) |
| dil tr | 43/49 (88%) |

### Model kullanımı

| model | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 73 | 8754 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 172 | 353850 | 270720 | 61812 | 35707 |
| gpt-6-luna | 117 | 1597631 | 1297321 | 28666 | 13850 |

Mühürlü set: ayrıntı basılmaz. Hatalı senaryo kimlikleri: tr_sauna_relation, tr_ac_cool, tr_dish_recipe, tr_pets_peki, tr_balcony_two_msgs, en_extend_wifi, en_pets_cond, en_steam_followup, en_tv_fix, fr_visitors, es_pet_followup, ru_refund_transfer, ru_garage_height, ar_gym_pool, ar_early_checkin

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `f9c4c5dd`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `claude-haiku-5-5` | yok (klasik model) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=(boş)` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=(boş)` · `AI_TURN_MESSAGES_ENABLED=(boş)` · `AI_REPLY_LANGUAGE_SHADOW_ENABLED=(boş)` · `AI_HOST_COMMITMENT_READER_ENABLED=(boş)` · `AI_REPLY_ITEMS_READER_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
