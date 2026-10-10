# Ev kuralları — anlama katmanı konu + tutum eval'i (2026-10-09)

Durum: **GEÇERLİ** · commit `232e24f` · veri sürümü 1 · 82 satır
Model: `gpt-6-luna` · reasoning_effort: model varsayılanı · anlama kipi: öğe + kural (canlının kipi)

`dev` bölümü kural istemi ekini yazan geliştiricinin yazdığı settir (GÖRÜLDÜ, iyimser). Karara bağlama onayı YALNIZ kör
yazılmış `holdout` bölümüyle. Sınıflar etiket ile modelin çıktısının AYNI karar tablosundan geçmesiyle bulunur
(`tests/eval/house-rules-metrics.ts`): "konu yok" ile "misafirin eylemi değil" aynı sonuçtur.

## dev

| ölçü | değer |
|---|---|
| Konu bulundu (etiketteki olumlu kayıtlar) | 57/59 (%97) |
| — tutum da birebir | 56/57 (%98) |
| Konu olmayan mesajda olumlu konu üretti | 0/25 (%0) |
| **Yasak kuralda: "misafir değil" diye ATLANDI (tehlikeli sınıf)** | 1 — d-hr080 |
| Yasak kuralda: yanlış / gereksiz kural cümlesi | 0 |
| Yasak kuralda: ev sahibine haber eksik ("yapacağız" → "soruyor") | 1 — d-hr080 |
| Yasak kuralda: konu kaçtı (bugünkü kelime listesi sürer) | 1 — d-hr042 |
| Kural yokken: gereksiz tutma | 1 — d-hr064 |
| Bilinmiyor (model düştü; satır sayılmadı) | 0 |
| Kelime listesi (bugün): gerçek kural konusunu tuttu | 10/57 (%18) |
| Kelime listesi (bugün): kural konusu olmayanı tuttu | 6/25 (%24) |

| dil | konu bulundu | konu olmayanda olumlu konu |
|---|---|---|
| ar | 3/3 | 0/0 |
| de | 4/4 | 0/1 |
| en | 21/21 | 0/9 |
| es | 2/2 | 0/1 |
| fr | 4/4 | 0/1 |
| ru | 4/4 | 0/0 |
| tr | 19/21 | 0/13 |

## Satır başına

| kimlik | dil | etiket | model | kelime listesi |
|---|---|---|---|---|
| d-hr001 | tr | party_event/asks_permission | party_event/asks_permission | — |
| d-hr002 | tr | party_event/announces | party_event/announces | tuttu |
| d-hr003 | tr | party_event/asks_info | party_event/asks_info | tuttu |
| d-hr004 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr005 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr006 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr007 | en | party_event/asks_permission | party_event/asks_permission | tuttu |
| d-hr008 | en | party_event/announces | party_event/announces | tuttu |
| d-hr009 | en | party_event/asks_info | party_event/asks_info | tuttu |
| d-hr010 | en | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr011 | en | — | — | — |
| d-hr012 | de | party_event/announces | party_event/announces | — |
| d-hr013 | fr | party_event/asks_permission | party_event/asks_permission | — |
| d-hr014 | es | party_event/asks_info | party_event/asks_info | — |
| d-hr015 | ru | party_event/asks_permission | party_event/asks_permission | — |
| d-hr016 | ar | party_event/asks_permission | party_event/asks_permission | — |
| d-hr017 | tr | smoking/asks_permission | smoking/asks_permission | tuttu |
| d-hr018 | tr | smoking/announces | smoking/announces | — |
| d-hr019 | tr | smoking/asks_info | smoking/asks_info | — |
| d-hr020 | tr | smoking/not_about_guest | smoking/not_about_guest | — |
| d-hr021 | tr | smoking/not_about_guest | smoking/not_about_guest | — |
| d-hr022 | en | smoking/asks_permission | smoking/asks_permission | — |
| d-hr023 | en | smoking/announces | smoking/announces | — |
| d-hr024 | en | smoking/asks_info | smoking/asks_info | — |
| d-hr025 | en | smoking/not_about_guest | smoking/not_about_guest | — |
| d-hr026 | de | smoking/asks_permission | smoking/asks_permission | — |
| d-hr027 | fr | smoking/announces | smoking/announces | — |
| d-hr028 | ru | smoking/asks_info | smoking/asks_info | — |
| d-hr029 | tr | pets/asks_permission | pets/asks_permission | tuttu |
| d-hr030 | tr | pets/announces | pets/announces | — |
| d-hr031 | tr | pets/asks_info | pets/asks_info | tuttu |
| d-hr032 | tr | pets/not_about_guest | — | — |
| d-hr033 | en | pets/asks_permission | pets/asks_permission | — |
| d-hr034 | en | pets/announces | pets/announces | — |
| d-hr035 | en | pets/asks_info | pets/asks_info | — |
| d-hr036 | en | pets/not_about_guest | — | tuttu |
| d-hr037 | de | pets/asks_permission | pets/asks_permission | — |
| d-hr038 | es | pets/announces | pets/announces | — |
| d-hr039 | ar | pets/asks_info | pets/asks_info | — |
| d-hr040 | tr | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr041 | tr | extra_guests/announces | extra_guests/announces | — |
| d-hr042 | tr | extra_guests/asks_info | — | — |
| d-hr043 | tr | extra_guests/not_about_guest | — | tuttu |
| d-hr044 | en | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr045 | en | extra_guests/announces | extra_guests/announces | — |
| d-hr046 | en | extra_guests/asks_info | extra_guests/asks_info | — |
| d-hr047 | en | extra_guests/not_about_guest | extra_guests/not_about_guest | — |
| d-hr048 | fr | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr049 | ru | extra_guests/announces | extra_guests/announces | — |
| d-hr050 | tr | quiet_hours/asks_permission | quiet_hours/asks_permission | — |
| d-hr051 | tr | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr052 | tr | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr053 | en | quiet_hours/asks_permission | quiet_hours/asks_permission | — |
| d-hr054 | en | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr055 | en | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr056 | de | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr057 | es | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr058 | tr | visitors/asks_permission | visitors/asks_permission | — |
| d-hr059 | tr | visitors/announces | visitors/announces | — |
| d-hr060 | tr | visitors/asks_info | visitors/asks_info | — |
| d-hr061 | tr | — | — | — |
| d-hr062 | en | visitors/asks_permission | visitors/asks_permission | — |
| d-hr063 | en | visitors/announces | visitors/announces | — |
| d-hr064 | en | visitors/asks_info | visitors/asks_permission | — |
| d-hr065 | en | — | — | — |
| d-hr066 | fr | visitors/asks_permission | visitors/asks_permission | — |
| d-hr067 | ru | visitors/asks_info | visitors/asks_info | — |
| d-hr068 | ar | visitors/announces | visitors/announces | — |
| d-hr069 | tr | — | — | — |
| d-hr070 | tr | — | — | — |
| d-hr071 | tr | — | — | — |
| d-hr072 | en | — | — | — |
| d-hr073 | fr | — | — | — |
| d-hr074 | de | — | — | — |
| d-hr075 | tr | pets/asks_permission | pets/asks_permission | tuttu |
| d-hr076 | en | smoking/asks_permission | smoking/asks_permission | — |
| d-hr077 | tr | visitors/asks_permission smoking/asks_permission | visitors/asks_permission smoking/asks_permission | tuttu |
| d-hr078 | en | pets/announces | pets/announces | — |
| d-hr079 | en | quiet_hours/announces party_event/announces | party_event/announces quiet_hours/announces | — |
| d-hr080 | tr | extra_guests/announces | extra_guests/not_about_guest | — |
| d-hr081 | en | visitors/not_about_guest | — | — |
| d-hr082 | tr | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `232e24f`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `90bdf31dec0d` (kip: items)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
