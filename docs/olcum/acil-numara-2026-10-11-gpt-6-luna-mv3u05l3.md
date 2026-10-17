# Acil numara sorusu — anlama katmanı bağlam ayrımı


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `181add0`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kural: risk niyeti complaint_issue / cancellation_refund / human_request → **hold** (ev sahibine), aksi → **give** (resmî numara).

| ölçü | değer |
|---|---|
| doğru karar (give + hold, puanlanan) | 43/62 |
| 🚨 bırakılması gerekirken numara verilecekti (hold → give) | 19 |
| numara verilmesi gerekirken bırakılacaktı (give → hold) | 0 |
| anlama çağrısı başarısız | 0 |
| tekrarlarda kararı aynı kalan senaryo | 30/33 |

| kimlik | sınıf | beklenen | tekrar | risk niyeti | karar |
|---|---|---|---|---|---|
| e1 | host_intrusion | either | 1 | emergency | give |
| e1 | host_intrusion | either | 2 | emergency | give |
| e2 | host_intrusion | either | 1 | emergency | give |
| e2 | host_intrusion | either | 2 | emergency | give |
| g1 | medical | give | 1 | emergency | give |
| g1 | medical | give | 2 | emergency | give |
| g2 | medical | give | 1 | emergency | give |
| g2 | medical | give | 2 | emergency | give |
| g3 | curiosity | give | 1 | emergency | give |
| g3 | curiosity | give | 2 | emergency | give |
| g4 | info | give | 1 | emergency | give |
| g4 | info | give | 2 | emergency | give |
| g5 | crime | give | 1 | emergency | give |
| g5 | crime | give | 2 | emergency | give |
| g6 | safety | give | 1 | emergency | give |
| g6 | safety | give | 2 | emergency | give |
| g7 | medical | give | 1 | emergency | give |
| g7 | medical | give | 2 | emergency | give |
| g8 | safety | give | 1 | emergency | give |
| g8 | safety | give | 2 | emergency | give |
| g9 | medical | give | 1 | emergency | give |
| g9 | medical | give | 2 | emergency | give |
| g10 | curiosity | give | 1 | emergency | give |
| g10 | curiosity | give | 2 | emergency | give |
| g11 | crime | give | 1 | emergency | give |
| g11 | crime | give | 2 | emergency | give |
| g12 | info | give | 1 | emergency | give |
| g12 | info | give | 2 | emergency | give |
| g13 | info | give | 1 | emergency | give |
| g13 | info | give | 2 | emergency | give |
| g14 | medical | give | 1 | emergency | give |
| g14 | medical | give | 2 | emergency | give |
| g15 | medical | give | 1 | emergency | give |
| g15 | medical | give | 2 | emergency | give |
| g16 | curiosity | give | 1 | emergency | give |
| g16 | curiosity | give | 2 | emergency | give |
| g17 | info | give | 1 | emergency | give |
| g17 | info | give | 2 | emergency | give |
| g18 | info | give | 1 | emergency | give |
| g18 | info | give | 2 | emergency | give |
| g19 | safety | give | 1 | emergency | give |
| g19 | safety | give | 2 | emergency | give |
| h1 | host_dispute | hold | 1 | emergency | **give** |
| h1 | host_dispute | hold | 2 | emergency | **give** |
| h2 | host_dispute | hold | 1 | complaint_issue | hold |
| h2 | host_dispute | hold | 2 | emergency | **give** |
| h3 | refund_threat | hold | 1 | emergency | **give** |
| h3 | refund_threat | hold | 2 | emergency | **give** |
| h4 | complaint | hold | 1 | emergency | **give** |
| h4 | complaint | hold | 2 | emergency | **give** |
| h5 | host_dispute | hold | 1 | emergency | **give** |
| h5 | host_dispute | hold | 2 | emergency | **give** |
| h6 | refund_threat | hold | 1 | emergency | **give** |
| h6 | refund_threat | hold | 2 | complaint_issue | hold |
| h7 | host_dispute | hold | 1 | emergency | **give** |
| h7 | host_dispute | hold | 2 | emergency | **give** |
| h8 | complaint | hold | 1 | emergency | **give** |
| h8 | complaint | hold | 2 | emergency | **give** |
| h9 | complaint | hold | 1 | complaint_issue | hold |
| h9 | complaint | hold | 2 | complaint_issue | hold |
| h10 | host_dispute | hold | 1 | emergency | **give** |
| h10 | host_dispute | hold | 2 | emergency | **give** |
| h11 | host_dispute | hold | 1 | cancellation_refund | hold |
| h11 | host_dispute | hold | 2 | emergency | **give** |
| h12 | host_dispute | hold | 1 | emergency | **give** |
| h12 | host_dispute | hold | 2 | emergency | **give** |
