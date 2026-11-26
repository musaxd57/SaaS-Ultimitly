# Acil numara sorusu — anlama katmanı bağlam ayrımı (geliştirme seti `emergency-number`)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `3cd6e28`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=1` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=0`

İstem kimliği (SHA-256 ilk 12): cevap `fb2e7678bd79` (öğe + yabancı dil örneği `7146c50f9004`) · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kural: risk niyeti complaint_issue / cancellation_refund / human_request → **hold** (ev sahibine), aksi → **give** (resmî numara).

| ölçü | değer |
|---|---|
| doğru karar (give + hold, puanlanan; en öncelikli niyet kuralı) | 53/62 |
| doğru karar — anlama kuralı (niyetlerden herhangi biri şikâyet / iade / insan talebi → hold) | 60/62 |
| **doğru karar — ÜRÜN (kod kuralları + anlama; `emergencyNumberReply`)** | **60/62** |
| 🚨 ürün: bırakılması gerekirken numara verirdi | 0 |
| ürün: numara verilmesi gerekirken bırakırdı | 2 |
| 🚨 bırakılması gerekirken numara verilecekti (hold → give) | 7 |
| numara verilmesi gerekirken bırakılacaktı (give → hold) | 2 |
| anlama çağrısı başarısız | 0 |
| tekrarlarda kararı aynı kalan senaryo | 28/33 |

| kimlik | sınıf | beklenen | tekrar | risk niyeti | niyetler | anlama kararı | ürün kararı |
|---|---|---|---|---|---|---|---|
| e1 | host_intrusion | either | 1 | complaint_issue | complaint_issue | hold | hold |
| e1 | host_intrusion | either | 2 | complaint_issue | complaint_issue | hold | hold |
| e2 | host_intrusion | either | 1 | emergency | emergency | give | hold |
| e2 | host_intrusion | either | 2 | emergency | emergency | give | hold |
| g1 | medical | give | 1 | emergency | emergency | give | give |
| g1 | medical | give | 2 | emergency | emergency | give | give |
| g2 | medical | give | 1 | emergency | emergency | give | give |
| g2 | medical | give | 2 | emergency | emergency | give | give |
| g3 | curiosity | give | 1 | emergency | emergency | give | give |
| g3 | curiosity | give | 2 | emergency | emergency | give | give |
| g4 | info | give | 1 | emergency | emergency | give | give |
| g4 | info | give | 2 | emergency | emergency | give | give |
| g5 | crime | give | 1 | complaint_issue | complaint_issue | **hold** | **hold** |
| g5 | crime | give | 2 | emergency | emergency | give | give |
| g6 | safety | give | 1 | emergency | emergency | give | give |
| g6 | safety | give | 2 | emergency | emergency | give | give |
| g7 | medical | give | 1 | emergency | emergency | give | give |
| g7 | medical | give | 2 | emergency | emergency | give | give |
| g8 | safety | give | 1 | emergency | emergency | give | give |
| g8 | safety | give | 2 | emergency | emergency | give | give |
| g9 | medical | give | 1 | emergency | emergency | give | give |
| g9 | medical | give | 2 | emergency | emergency | give | give |
| g10 | curiosity | give | 1 | emergency | emergency | give | give |
| g10 | curiosity | give | 2 | emergency | emergency | give | give |
| g11 | crime | give | 1 | emergency | emergency | give | give |
| g11 | crime | give | 2 | complaint_issue | complaint_issue | **hold** | **hold** |
| g12 | info | give | 1 | emergency | emergency | give | give |
| g12 | info | give | 2 | emergency | emergency | give | give |
| g13 | info | give | 1 | emergency | emergency | give | give |
| g13 | info | give | 2 | emergency | emergency | give | give |
| g14 | medical | give | 1 | emergency | emergency | give | give |
| g14 | medical | give | 2 | emergency | emergency | give | give |
| g15 | medical | give | 1 | emergency | emergency | give | give |
| g15 | medical | give | 2 | emergency | emergency | give | give |
| g16 | curiosity | give | 1 | emergency | emergency | give | give |
| g16 | curiosity | give | 2 | emergency | emergency | give | give |
| g17 | info | give | 1 | emergency | emergency | give | give |
| g17 | info | give | 2 | emergency | emergency | give | give |
| g18 | info | give | 1 | emergency | emergency | give | give |
| g18 | info | give | 2 | emergency | emergency | give | give |
| g19 | safety | give | 1 | emergency | emergency | give | give |
| g19 | safety | give | 2 | emergency | emergency | give | give |
| h1 | host_dispute | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h1 | host_dispute | hold | 2 | complaint_issue | complaint_issue | hold | hold |
| h2 | host_dispute | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| h2 | host_dispute | hold | 2 | complaint_issue | complaint_issue | hold | hold |
| h3 | refund_threat | hold | 1 | complaint_issue | cancellation_refund, complaint_issue | hold | hold |
| h3 | refund_threat | hold | 2 | complaint_issue | cancellation_refund, complaint_issue | hold | hold |
| h4 | complaint | hold | 1 | complaint_issue | access_keys, complaint_issue | hold | hold |
| h4 | complaint | hold | 2 | complaint_issue | access_keys, complaint_issue | hold | hold |
| h5 | host_dispute | hold | 1 | emergency | complaint_issue, emergency, human_request | hold | hold |
| h5 | host_dispute | hold | 2 | emergency | complaint_issue, emergency | hold | hold |
| h6 | refund_threat | hold | 1 | emergency | cancellation_refund, emergency | hold | hold |
| h6 | refund_threat | hold | 2 | emergency | cancellation_refund, emergency | hold | hold |
| h7 | host_dispute | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h7 | host_dispute | hold | 2 | complaint_issue | complaint_issue | hold | hold |
| h8 | complaint | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h8 | complaint | hold | 2 | complaint_issue | complaint_issue | hold | hold |
| h9 | complaint | hold | 1 | complaint_issue | appliance_help, complaint_issue | hold | hold |
| h9 | complaint | hold | 2 | complaint_issue | appliance_help, complaint_issue | hold | hold |
| h10 | host_dispute | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h10 | host_dispute | hold | 2 | emergency | complaint_issue, emergency | hold | hold |
| h11 | host_dispute | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h11 | host_dispute | hold | 2 | complaint_issue | complaint_issue | hold | hold |
| h12 | host_dispute | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| h12 | host_dispute | hold | 2 | emergency | complaint_issue, emergency | hold | hold |
