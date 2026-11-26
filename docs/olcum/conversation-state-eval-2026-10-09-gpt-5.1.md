# Konuşma Anlama Durumu eval'i — gpt-5.1 (2026-10-09)

Durum: **GEÇERLİ** · commit `311da14` · veri sürümü 1 · senaryo 46 × 2 kol
Yapılandırma: anlama katmanı AÇIK · bekçi KOŞMAZ (kapanış birebir, sızıntı temkinli — `conversation-state-harness.ts` başı) · eylem beyanı KAPALI · gün 2026-10-10 (Europe/Istanbul, varsayılan yerel saat 14:00)

| ölçü | hedef | bayrak KAPALI | bayrak AÇIK |
|---|---|---|---|
| 🚨 SIZINTI (beklenti 'gitmez' iken otomatik gitti) | 0 | 0/25 (0%) | 0/25 (0%) |
| 🚨 YANLIŞ SUSTURMA (gerçek soru/istek susturuldu) | 0 | 0/40 (0%) | 0/40 (0%) |
| kapanış: sessiz kaldı |  | 5/6 (83%) | 5/6 (83%) |
| kapanış: gereksiz OTOMATİK cevap |  | 0/6 (0%) | 0/6 (0%) |
| kapanış: gereksiz taslak (ev sahibine) |  | 1/6 (17%) | 1/6 (17%) |
| 🚨 BEKLEME SÖZÜ misafire giden | 0 | 0/8 (0%) | 0/9 (0%) |
| bekleme sözü model üretti (kapı tuttu) |  | 1/43 (2%) | 1/43 (2%) |
| netleştirme: çözülebilir mesajda soru soruldu | ≈0 | 0/30 (0%) | 0/30 (0%) |
| 🚨 GENEL netleştirme (tüm cevaplar) | 0 | 0/43 (0%) | 0/43 (0%) |
| belirsiz mesajda TEK hedefli soru |  | 0/6 (0%) | 0/6 (0%) |
| konaklama türü: cevap modelinin beyanı doğru |  | 30/33 (91%) | 30/33 (91%) |
| konaklama türü: anlama katmanı doğru |  | 33/33 (100%) | 33/33 (100%) |
| 🚨 çıkış saati: yolculuk saati çıkış diye kaydedildi | 0 | 0/5 (0%) | 0/5 (0%) |
| çıkış saati: doğru kayıt (düzeltme dahil) |  | 3/5 (60%) | 3/5 (60%) |
| ev sahibindeki konu: karar/izin/söz YOK |  | 4/4 (100%) | 4/4 (100%) |
| selam tekrarı (önceki cevaptan sonra) | 0 | 0/20 (0%) | 0/20 (0%) |
| anlama katmanı düştü (satır geçersiz sayılır) | 0 | 0/43 (0%) | 0/43 (0%) |
| cevap modeli yedeğe düştü / hata | 0 | 0/46 (0%) | 0/46 (0%) |

Sınıf bazında (otomatik gönderim · sessiz):

| sınıf | KAPALI otomatik | KAPALI sessiz | AÇIK otomatik | AÇIK sessiz |
|---|---|---|---|---|
| tomorrow_early | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |
| checkout_time | 2/5 (40%) | 0/5 (0%) | 2/5 (40%) | 0/5 (0%) |
| travel_not_checkout | 4/5 (80%) | 0/5 (0%) | 4/5 (80%) | 0/5 (0%) |
| closing | 0/6 (0%) | 5/6 (83%) | 0/6 (0%) | 5/6 (83%) |
| closing_trap | 1/6 (17%) | 0/6 (0%) | 2/6 (33%) | 0/6 (0%) |
| pending_followup | 0/4 (0%) | 0/4 (0%) | 0/4 (0%) | 0/4 (0%) |
| resolvable | 1/4 (25%) | 0/4 (0%) | 1/4 (25%) | 0/4 (0%) |
| ambiguous | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |

## Kollar arasında değişen senaryolar

Alanlar: sessiz | otomatik | beyan | anlama türü | kayıtlı çıkış | soru sayısı | söz | selam

- `ct-en-thanks-answers-ai-question` (closing_trap) KAPALI [-|false|none|none|-|0|false|false] → AÇIK [-|true|none|none|-|0|false|false]

## Soru soran cevaplar (insan okur)


## Bekleme sözü, yanlış susturma, sızıntı (satır satır)

- `co-tr-correction-earlier` [off] (checkout_time) sessiz=null otomatik=false söz=true — "Bilgi için teşekkür ederiz, not aldım. Şimdiden iyi yolculuklar dileriz."
- `co-tr-correction-earlier` [on] (checkout_time) sessiz=null otomatik=false söz=true — "Düzeltme için teşekkürler, not aldım. İyi yolculuklar dileriz."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `311da14`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
