# Acil numara sorusu — anlama katmanı bağlam ayrımı (KÖR set `emergency-number-acc1`)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `352e0fa`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=1` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=0`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kural: risk niyeti complaint_issue / cancellation_refund / human_request → **hold** (ev sahibine), aksi → **give** (resmî numara).

| ölçü | değer |
|---|---|
| doğru karar (give + hold, puanlanan; en öncelikli niyet kuralı) | 10/18 |
| doğru karar — anlama kuralı (niyetlerden herhangi biri şikâyet / iade / insan talebi → hold) | 16/18 |
| **doğru karar — ÜRÜN (kod kuralları + anlama; `emergencyNumberReply`)** | **15/18** |
| 🚨 ürün: bırakılması gerekirken numara verirdi | 1 |
| ürün: numara verilmesi gerekirken bırakırdı | 2 |
| 🚨 bırakılması gerekirken numara verilecekti (hold → give) | 8 |
| numara verilmesi gerekirken bırakılacaktı (give → hold) | 0 |
| anlama çağrısı başarısız | 0 |
| tekrarlarda kararı aynı kalan senaryo | 20/20 |

| kimlik | sınıf | beklenen | tekrar | risk niyeti | niyetler | anlama kararı | ürün kararı |
|---|---|---|---|---|---|---|---|
| a1 | medical | give | 1 | emergency | emergency | give | **hold** |
| a2 | fire | give | 1 | emergency | emergency | give | give |
| a3 | theft | give | 1 | emergency | emergency | give | give |
| a4 | lost_child | give | 1 | emergency | emergency | give | **hold** |
| a5 | curiosity | give | 1 | emergency | emergency | give | give |
| a6 | greeting_question | give | 1 | emergency | emergency | give | give |
| a7 | medical_with_hospital | give | 1 | emergency | emergency | give | give |
| a8 | injury | give | 1 | emergency | emergency | give | give |
| a9 | accident | give | 1 | emergency | emergency | give | give |
| a10 | deposit_dispute | hold | 1 | — | other | **give** | **give** |
| a11 | refund_request | hold | 1 | emergency | cancellation_refund, complaint_issue, emergency | hold | hold |
| a12 | host_threat | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| a13 | cancellation | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| a14 | cleanliness_threat | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| a15 | appliance_failure_threat | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| a16 | internet_failure_threat | hold | 1 | complaint_issue | complaint_issue, human_request | hold | hold |
| a17 | listing_mismatch | hold | 1 | emergency | complaint_issue, emergency | hold | hold |
| a18 | host_insult | hold | 1 | emergency | emergency | **give** | hold |
| a19 | unclear_visitor | either | 1 | emergency | emergency | give | hold |
| a20 | safety_vs_host_dismissal | either | 1 | emergency | complaint_issue, emergency | hold | hold |
