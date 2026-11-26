# Acil numara sorusu — anlama katmanı bağlam ayrımı (KÖR set `emergency-number-acc2`)


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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=1` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `fb2e7678bd79` (öğe + yabancı dil örneği `7146c50f9004`) · anlama `0d15f1dfc7b6` (kip: items+rules+cfu+thr)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kural: risk niyeti complaint_issue / cancellation_refund / human_request → **hold** (ev sahibine), aksi → **give** (resmî numara).

| ölçü | değer |
|---|---|
| doğru karar (give + hold, puanlanan; en öncelikli niyet kuralı) | 18/18 |
| doğru karar — anlama kuralı (niyetlerden herhangi biri şikâyet / iade / insan talebi → hold) | 18/18 |
| **doğru karar — ÜRÜN (kod kuralları + anlama; `emergencyNumberReply`)** | **18/18** |
| 🚨 ürün: bırakılması gerekirken numara verirdi | 0 |
| ürün: numara verilmesi gerekirken bırakırdı | 0 |
| **ürün — yalnız GÖRÜLMEMİŞ senaryolar (4 senaryo hata analizi için açıldı)** | **14/14** |
| 🚨 bırakılması gerekirken numara verilecekti (hold → give) | 0 |
| numara verilmesi gerekirken bırakılacaktı (give → hold) | 0 |
| anlama çağrısı başarısız | 0 |
| tekrarlarda kararı aynı kalan senaryo | 20/20 |

| kimlik | sınıf | beklenen | tekrar | risk niyeti | niyetler | anlama kararı | ürün kararı |
|---|---|---|---|---|---|---|---|
| b1 | medical | give | 1 | emergency | emergency | give | give |
| b2 | allergy | give | 1 | emergency | emergency | give | give |
| b3 | burn_smoke | give | 1 | emergency | emergency | give | give |
| b4 | fall | give | 1 | emergency | emergency | give | give |
| b5 | gas | give | 1 | emergency | emergency | give | give |
| b6 | theft | give | 1 | emergency | emergency | give | give |
| b7 | fight | give | 1 | emergency | emergency | give | give |
| b8 | missing_person | give | 1 | emergency | emergency | give | give |
| b9 | curiosity | give | 1 | emergency | emergency | give | give |
| b10 | deposit | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b11 | refund | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b12 | cancellation | hold | 1 | complaint_issue | cancellation_refund, complaint_issue | hold | hold |
| b13 | listing_mismatch | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b14 | host_rude | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b15 | noise_police_threat | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b16 | breakdown_police | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b17 | host_no_answer | hold | 1 | complaint_issue | complaint_issue | hold | hold |
| b18 | host_intrusion | hold | 1 | complaint_issue | complaint_issue, human_request | hold | hold |
| b19 | ambiguous_visitor | either | 1 | human_request | human_request | hold | hold |
| b20 | ambiguous_wait | either | 1 | emergency | complaint_issue, emergency | hold | hold |
