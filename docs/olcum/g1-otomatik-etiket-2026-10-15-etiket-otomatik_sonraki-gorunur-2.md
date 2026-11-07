# G1 — anlama katmanında otomatik mesaj etiketi (2026-10-15) · kol: etiket-otomatik_sonraki-gorunur

Senaryo 25 × tur 3 · doğru 75/75 · katman hatası 0

Kod: HEAD `f90d971` · yerel src değişikliği yok · kol istemden ölçüldü: `etiket-otomatik_sonraki-gorunur`

| Senaryo | Tur | Sonuç | Niyetler | Konaklama | Hata |
|---|---|---|---|---|---|
| tr-geç-çıkış-teklifi-evet | 1 | ✓ | late_checkout | late_checkout 13:00 |  |
| tr-geç-çıkış-hatırlatma-teşekkür | 1 | ✓ | greeting_thanks | yok |  |
| tr-erken-giriş-müsaitliğe-göre | 1 | ✓ | early_checkin | early_checkin 12:00 |  |
| tr-wifi-kartta | 1 | ✓ | wifi | yok |  |
| tr-anahtar-kutusu | 1 | ✓ | access_keys | yok |  |
| tr-otopark-bilgi | 1 | ✓ | parking | yok |  |
| tr-otomatik-sonra-şikâyet | 1 | ✓ | complaint_issue | yok |  |
| tr-otomatik-ev-sahibi-adı | 1 | ✓ | human_request | yok |  |
| tr-otomatik-geç-çıkış-ücret-sorusu | 1 | ✓ | late_checkout | yok |  |
| tr-HOST-onay-sonra-teşekkür | 1 | ✓ | greeting_thanks | yok |  |
| tr-HOST-geç-çıkış-sorusu | 1 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-late-checkout-offer-yes | 1 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-early-checkin-maybe | 1 | ✓ | early_checkin | early_checkin 11:00 |  |
| en-thanks-after-auto | 1 | ✓ | greeting_thanks | yok |  |
| en-wifi-card | 1 | ✓ | wifi | yok |  |
| en-HOST-approved-early | 1 | ✓ | greeting_thanks | yok |  |
| ctx-tr-geç-çıkış-sonra-soru | 1 | ✓ | late_checkout | late_checkout 13:00 |  |
| ctx-tr-wifi-kart-sonra-soru | 1 | ✓ | wifi + greeting_thanks | yok |  |
| ctx-en-early-after-parking | 1 | ✓ | early_checkin | early_checkin 11:00 |  |
| gtg-tr-erken-giriş | 1 | ✓ | early_checkin | early_checkin 12:00 |  |
| gtg-tr-wifi-kart | 1 | ✓ | greeting_thanks + wifi | yok |  |
| gtg-en-late-checkout | 1 | ✓ | greeting_thanks + late_checkout | late_checkout 13:00 |  |
| gtg-tr-çıkış-bilgi-kontrol | 1 | ✓ | greeting_thanks + greeting_thanks | yok |  |
| son-tr-wifi-sonra-çıkış-şablonu | 1 | ✓ | wifi | yok |  |
| son-en-parking-then-welcome | 1 | ✓ | parking | yok |  |
| tr-geç-çıkış-teklifi-evet | 2 | ✓ | late_checkout | late_checkout 13:00 |  |
| tr-geç-çıkış-hatırlatma-teşekkür | 2 | ✓ | greeting_thanks | yok |  |
| tr-erken-giriş-müsaitliğe-göre | 2 | ✓ | early_checkin | early_checkin 12:00 |  |
| tr-wifi-kartta | 2 | ✓ | wifi | yok |  |
| tr-anahtar-kutusu | 2 | ✓ | access_keys | yok |  |
| tr-otopark-bilgi | 2 | ✓ | parking | yok |  |
| tr-otomatik-sonra-şikâyet | 2 | ✓ | complaint_issue | yok |  |
| tr-otomatik-ev-sahibi-adı | 2 | ✓ | human_request | yok |  |
| tr-otomatik-geç-çıkış-ücret-sorusu | 2 | ✓ | late_checkout | yok |  |
| tr-HOST-onay-sonra-teşekkür | 2 | ✓ | greeting_thanks | yok |  |
| tr-HOST-geç-çıkış-sorusu | 2 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-late-checkout-offer-yes | 2 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-early-checkin-maybe | 2 | ✓ | early_checkin | early_checkin 11:00 |  |
| en-thanks-after-auto | 2 | ✓ | greeting_thanks | yok |  |
| en-wifi-card | 2 | ✓ | wifi | yok |  |
| en-HOST-approved-early | 2 | ✓ | greeting_thanks | yok |  |
| ctx-tr-geç-çıkış-sonra-soru | 2 | ✓ | late_checkout | late_checkout 13:00 |  |
| ctx-tr-wifi-kart-sonra-soru | 2 | ✓ | wifi + greeting_thanks | yok |  |
| ctx-en-early-after-parking | 2 | ✓ | early_checkin | early_checkin 11:00 |  |
| gtg-tr-erken-giriş | 2 | ✓ | early_checkin | early_checkin 12:00 |  |
| gtg-tr-wifi-kart | 2 | ✓ | greeting_thanks + wifi | yok |  |
| gtg-en-late-checkout | 2 | ✓ | greeting_thanks + late_checkout | late_checkout 13:00 |  |
| gtg-tr-çıkış-bilgi-kontrol | 2 | ✓ | greeting_thanks + greeting_thanks | yok |  |
| son-tr-wifi-sonra-çıkış-şablonu | 2 | ✓ | wifi | yok |  |
| son-en-parking-then-welcome | 2 | ✓ | parking | yok |  |
| tr-geç-çıkış-teklifi-evet | 3 | ✓ | late_checkout | late_checkout 13:00 |  |
| tr-geç-çıkış-hatırlatma-teşekkür | 3 | ✓ | greeting_thanks | yok |  |
| tr-erken-giriş-müsaitliğe-göre | 3 | ✓ | early_checkin | early_checkin 12:00 |  |
| tr-wifi-kartta | 3 | ✓ | wifi | yok |  |
| tr-anahtar-kutusu | 3 | ✓ | access_keys | yok |  |
| tr-otopark-bilgi | 3 | ✓ | parking | yok |  |
| tr-otomatik-sonra-şikâyet | 3 | ✓ | complaint_issue | yok |  |
| tr-otomatik-ev-sahibi-adı | 3 | ✓ | human_request | yok |  |
| tr-otomatik-geç-çıkış-ücret-sorusu | 3 | ✓ | late_checkout | yok |  |
| tr-HOST-onay-sonra-teşekkür | 3 | ✓ | greeting_thanks | yok |  |
| tr-HOST-geç-çıkış-sorusu | 3 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-late-checkout-offer-yes | 3 | ✓ | late_checkout | late_checkout 13:00 |  |
| en-early-checkin-maybe | 3 | ✓ | early_checkin | early_checkin 11:00 |  |
| en-thanks-after-auto | 3 | ✓ | greeting_thanks | yok |  |
| en-wifi-card | 3 | ✓ | wifi | yok |  |
| en-HOST-approved-early | 3 | ✓ | greeting_thanks | yok |  |
| ctx-tr-geç-çıkış-sonra-soru | 3 | ✓ | late_checkout | late_checkout 13:00 |  |
| ctx-tr-wifi-kart-sonra-soru | 3 | ✓ | wifi + greeting_thanks | yok |  |
| ctx-en-early-after-parking | 3 | ✓ | early_checkin | early_checkin 11:00 |  |
| gtg-tr-erken-giriş | 3 | ✓ | early_checkin | early_checkin 12:00 |  |
| gtg-tr-wifi-kart | 3 | ✓ | greeting_thanks + wifi | yok |  |
| gtg-en-late-checkout | 3 | ✓ | greeting_thanks + late_checkout | late_checkout 13:00 |  |
| gtg-tr-çıkış-bilgi-kontrol | 3 | ✓ | greeting_thanks + greeting_thanks | yok |  |
| son-tr-wifi-sonra-çıkış-şablonu | 3 | ✓ | wifi | yok |  |
| son-en-parking-then-welcome | 3 | ✓ | parking | yok |  |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `f90d971`

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
