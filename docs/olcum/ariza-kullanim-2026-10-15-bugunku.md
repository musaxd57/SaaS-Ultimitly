# Arıza ↔ kullanım sorusu — anlama katmanı (2026-10-15) · istem kolu: bugunku

Kod: HEAD `fc58607` · yerel src değişikliği yok

- canli-oge-iliski: toplam 40/40 · arıza bildirimi 22/22 · kullanım sorusu 18/18
- temel: toplam 20/40 · arıza bildirimi 2/22 · kullanım sorusu 18/18

| Kip | Vaka | Tur | Sonuç | Niyetler | Hata |
|---|---|---|---|---|---|
| canli-oge-iliski | b-tr-tost-wifi | 1 | ✓ | complaint_issue + appliance_help + wifi |  |
| canli-oge-iliski | b-en-espresso-wifi | 1 | ✓ | complaint_issue + appliance_help + wifi |  |
| canli-oge-iliski | b-tr-bulaşık | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-saç-kurutma | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-de-wasserkocher | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-çamaşır-kapak | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-en-tv-remote | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-mikrodalga | 1 | ✓ | appliance_help + complaint_issue |  |
| canli-oge-iliski | b-en-fridge | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-çaydanlık-başka | 1 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-internet-reset | 1 | ✓ | complaint_issue + wifi |  |
| canli-oge-iliski | h-tr-tost-nasıl | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | h-en-espresso-how | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | h-tr-saç-kurutma-nerede | 1 | ✓ | amenities |  |
| canli-oge-iliski | h-tr-çamaşır-program | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | h-de-wasserkocher-wie | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | h-tr-tablet | 1 | ✓ | amenities |  |
| canli-oge-iliski | h-tr-kumanda-bulamadık | 1 | ✓ | appliance_help + appliance_help |  |
| canli-oge-iliski | h-tr-kahve-su | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | h-en-oven-preheat | 1 | ✓ | appliance_help |  |
| canli-oge-iliski | b-tr-tost-wifi | 2 | ✓ | complaint_issue + appliance_help + wifi |  |
| canli-oge-iliski | b-en-espresso-wifi | 2 | ✓ | appliance_help + complaint_issue + wifi |  |
| canli-oge-iliski | b-tr-bulaşık | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-saç-kurutma | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-de-wasserkocher | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-çamaşır-kapak | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-en-tv-remote | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-mikrodalga | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-en-fridge | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-çaydanlık-başka | 2 | ✓ | complaint_issue + appliance_help |  |
| canli-oge-iliski | b-tr-internet-reset | 2 | ✓ | complaint_issue + wifi |  |
| canli-oge-iliski | h-tr-tost-nasıl | 2 | ✓ | appliance_help |  |
| canli-oge-iliski | h-en-espresso-how | 2 | ✓ | appliance_help |  |
| canli-oge-iliski | h-tr-saç-kurutma-nerede | 2 | ✓ | amenities |  |
| canli-oge-iliski | h-tr-çamaşır-program | 2 | ✓ | appliance_help |  |
| canli-oge-iliski | h-de-wasserkocher-wie | 2 | ✓ | appliance_help |  |
| canli-oge-iliski | h-tr-tablet | 2 | ✓ | amenities |  |
| canli-oge-iliski | h-tr-kumanda-bulamadık | 2 | ✓ | appliance_help + appliance_help |  |
| canli-oge-iliski | h-tr-kahve-su | 2 | ✓ | appliance_help |  |
| canli-oge-iliski | h-en-oven-preheat | 2 | ✓ | appliance_help |  |
| temel | b-tr-tost-wifi | 1 | ✗ | appliance_help + wifi | eksik complaint_issue |
| temel | b-en-espresso-wifi | 1 | ✗ | appliance_help + wifi | eksik complaint_issue |
| temel | b-tr-bulaşık | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-saç-kurutma | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-de-wasserkocher | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-çamaşır-kapak | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-en-tv-remote | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-mikrodalga | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-en-fridge | 1 | ✓ | complaint_issue |  |
| temel | b-tr-çaydanlık-başka | 1 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-internet-reset | 1 | ✗ | appliance_help | eksik complaint_issue; eksik wifi |
| temel | h-tr-tost-nasıl | 1 | ✓ | appliance_help |  |
| temel | h-en-espresso-how | 1 | ✓ | appliance_help |  |
| temel | h-tr-saç-kurutma-nerede | 1 | ✓ | appliance_help |  |
| temel | h-tr-çamaşır-program | 1 | ✓ | appliance_help |  |
| temel | h-de-wasserkocher-wie | 1 | ✓ | appliance_help |  |
| temel | h-tr-tablet | 1 | ✓ | amenities |  |
| temel | h-tr-kumanda-bulamadık | 1 | ✓ | appliance_help |  |
| temel | h-tr-kahve-su | 1 | ✓ | appliance_help |  |
| temel | h-en-oven-preheat | 1 | ✓ | appliance_help |  |
| temel | b-tr-tost-wifi | 2 | ✗ | appliance_help + wifi | eksik complaint_issue |
| temel | b-en-espresso-wifi | 2 | ✗ | appliance_help + wifi | eksik complaint_issue |
| temel | b-tr-bulaşık | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-saç-kurutma | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-de-wasserkocher | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-çamaşır-kapak | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-en-tv-remote | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-mikrodalga | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-en-fridge | 2 | ✓ | complaint_issue |  |
| temel | b-tr-çaydanlık-başka | 2 | ✗ | appliance_help | eksik complaint_issue |
| temel | b-tr-internet-reset | 2 | ✗ | appliance_help | eksik complaint_issue; eksik wifi |
| temel | h-tr-tost-nasıl | 2 | ✓ | appliance_help |  |
| temel | h-en-espresso-how | 2 | ✓ | appliance_help |  |
| temel | h-tr-saç-kurutma-nerede | 2 | ✓ | appliance_help |  |
| temel | h-tr-çamaşır-program | 2 | ✓ | appliance_help |  |
| temel | h-de-wasserkocher-wie | 2 | ✓ | appliance_help |  |
| temel | h-tr-tablet | 2 | ✓ | amenities |  |
| temel | h-tr-kumanda-bulamadık | 2 | ✓ | appliance_help |  |
| temel | h-tr-kahve-su | 2 | ✓ | appliance_help |  |
| temel | h-en-oven-preheat | 2 | ✓ | appliance_help |  |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `fc58607`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
