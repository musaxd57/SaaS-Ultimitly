# Uzun belge RAG ölçümü — dev (opus (geliştirme seti))

Belgeler: D1 13746 kr → 25 kalem · D2 10355 kr → 24 kalem · D3 11461 kr → 12 kalem · D4 9590 kr → 22 kalem · D5 8861 kr → 27 kalem · D6 8491 kr → 27 kalem

Arka plan bilgi tabanı: 250 kalem

## Yapılandırma `live+rrm:decisions`

| ölçü | sonuç |
|---|---|
| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | 125 · 0 · 0 · 0 |
| yalnız "Giriş Talimatı"nda kalan alıntı (QR ve rezervasyon öncesi görmez) | 13 alıntı · 10 soru |
| içe aktarmada kaybolmayan alıntı | 250/250 (%100) |
| çok alıntılı soruda hepsi aynı kalemde | 47/92 (%51) |
| çok alıntılı soruda hepsi aynı parçada | 44/92 (%48) |
| **bağlam tam (bütün alıntılar modelde)** | **105/113 (%93)** |
| en az bir alıntı modelde | 112/113 (%99) |
| cevapsız soruda ortalama seçilen parça | 11.7 (12 soru) |

| kategori | soru | bağlam tam | en az biri | aynı parçada |
|---|---|---|---|---|
| baska_dil | 12 | 10/12 (%83) | 11/12 (%92) | 11/12 (%92) |
| coklu_soru | 10 | 9/10 (%90) | 10/10 (%100) | 3/10 (%30) |
| gonderme | 8 | 7/8 (%88) | 8/8 (%100) | 0/8 (%0) |
| komsu_parca | 15 | 14/15 (%93) | 15/15 (%100) | 9/15 (%60) |
| olumsuzluk | 10 | 10/10 (%100) | 10/10 (%100) | 7/10 (%70) |
| tablo | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |
| uzak_istisna | 20 | 17/20 (%85) | 20/20 (%100) | 1/20 (%5) |
| uzun_paragraf_tek_cumle | 8 | 8/8 (%100) | 8/8 (%100) | 8/8 (%100) |
| yakin_konu | 15 | 15/15 (%100) | 15/15 (%100) | 13/15 (%87) |

Eksik bağlamlı ilk 8 soru (eksik alıntı):

- D1-Q22 [baska_dil] 1/2 — eksik: «| Cam şişe ve kavanoz | Tezgâh altındaki bez torba | Yeşil cam kumbarası | Çarşamba |»
- D2-Q11 [uzak_istisna] 1/2 — eksik: «In July and August the garden lights switch off at 23:00 instead of 01:00, at the request »
- D3-Q13 [komsu_parca] 1/2 — eksik: «Daha büyük alışveriş için ilçe merkezine gitmeniz gerekir; ilçedeki iki zincir market her »
- D3-Q15 [uzak_istisna] 1/2 — eksik: «Cuma günleri köy meydanında pazar kurulur; perşembe akşamı 18:00'den cuma 16:00'ya kadar m»
- D4-Q03 [gonderme] 1/2 — eksik: «Ayrılmadan önce bulaşıkları makineye yerleştirin, çöpleri Bölüm 9'da anlatıldığı gibi ayır»
- D5-Q01 [uzak_istisna] 2/3 — eksik: «Giriş saati 15:00, çıkış saati 11:00'dir.»
- D5-Q13 [coklu_soru] 2/3 — eksik: «Ev en fazla 6 kişiliktir: üst katta iki yatak odası (birinde çift kişilik yatak, diğerinde»
- D5-Q16 [baska_dil] 0/1 — eksik: «Cevap: Yaylada küçük bir bakkal vardır, yalnız Haziran–Eylül arasında 09:00–19:00 açıktır;»

- yapılandırma `live+rrm:decisions` (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş yalnız geçmişli satırda (eski ölçer) · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · model decisions · okuma 400 · blok varsayılan kr / varsayılan parça


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `1bfdb4cd`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-5.1` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `41c825201a8b` (öğe + yabancı dil örneği `f633b7e2bd6d`) · anlama `2280457cf496` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `1bfdb4cd`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-5.1` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `41c825201a8b` (öğe + yabancı dil örneği `f633b7e2bd6d`) · anlama `2280457cf496` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
