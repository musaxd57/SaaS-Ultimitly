# Konuşma Anlama Durumu eval'i — gpt-6-luna (2026-10-10)

Durum: **GEÇERLİ** · commit `58f4163` · veri sürümü 1 · senaryo 46 × 2 kol
Yapılandırma: anlama katmanı AÇIK · bekçi KOŞMAZ (kapanış birebir, sızıntı temkinli — `conversation-state-harness.ts` başı) · eylem beyanı KAPALI · gün 2026-10-10 (Europe/Istanbul, varsayılan yerel saat 14:00)

| ölçü | hedef | bayrak KAPALI | bayrak AÇIK |
|---|---|---|---|
| 🚨 SIZINTI (beklenti 'gitmez' iken otomatik gitti) | 0 | 0/25 (0%) | 0/25 (0%) |
| 🚨 YANLIŞ SUSTURMA (gerçek soru/istek susturuldu) | 0 | 0/40 (0%) | 0/40 (0%) |
| kapanış: sessiz kaldı |  | 5/6 (83%) | 5/6 (83%) |
| kapanış: gereksiz OTOMATİK cevap |  | 0/6 (0%) | 0/6 (0%) |
| kapanış: gereksiz taslak (ev sahibine) |  | 1/6 (17%) | 1/6 (17%) |
| 🚨 BEKLEME SÖZÜ misafire giden | 0 | 0/11 (0%) | 0/10 (0%) |
| bekleme sözü model üretti (kapı tuttu) |  | 1/43 (2%) | 1/43 (2%) |
| netleştirme: çözülebilir mesajda soru soruldu | ≈0 | 1/30 (3%) | 0/30 (0%) |
| 🚨 GENEL netleştirme (tüm cevaplar) | 0 | 0/43 (0%) | 0/43 (0%) |
| belirsiz mesajda TEK hedefli soru |  | 0/6 (0%) | 0/6 (0%) |
| konaklama türü: cevap modelinin beyanı doğru |  | 29/33 (88%) | 32/33 (97%) |
| konaklama türü: anlama katmanı doğru |  | 33/33 (100%) | 33/33 (100%) |
| 🚨 çıkış saati: yolculuk saati çıkış diye kaydedildi | 0 | 0/5 (0%) | 0/5 (0%) |
| çıkış saati: doğru kayıt (düzeltme dahil) |  | 4/5 (80%) | 4/5 (80%) |
| ev sahibindeki konu: karar/izin/söz YOK |  | 4/4 (100%) | 4/4 (100%) |
| selam tekrarı (önceki cevaptan sonra) | 0 | 0/20 (0%) | 0/20 (0%) |
| anlama katmanı düştü (satır geçersiz sayılır) | 0 | 0/43 (0%) | 0/43 (0%) |
| cevap modeli yedeğe düştü / hata | 0 | 0/46 (0%) | 0/46 (0%) |

Sınıf bazında (otomatik gönderim · sessiz):

| sınıf | KAPALI otomatik | KAPALI sessiz | AÇIK otomatik | AÇIK sessiz |
|---|---|---|---|---|
| tomorrow_early | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |
| checkout_time | 4/5 (80%) | 0/5 (0%) | 3/5 (60%) | 0/5 (0%) |
| travel_not_checkout | 5/5 (100%) | 0/5 (0%) | 5/5 (100%) | 0/5 (0%) |
| closing | 0/6 (0%) | 5/6 (83%) | 0/6 (0%) | 5/6 (83%) |
| closing_trap | 1/6 (17%) | 0/6 (0%) | 1/6 (17%) | 0/6 (0%) |
| pending_followup | 0/4 (0%) | 0/4 (0%) | 0/4 (0%) | 0/4 (0%) |
| resolvable | 1/4 (25%) | 0/4 (0%) | 1/4 (25%) | 0/4 (0%) |
| ambiguous | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |

## Kollar arasında değişen senaryolar

Alanlar: sessiz | otomatik | beyan | anlama türü | kayıtlı çıkış | soru sayısı | söz | selam

- `te-tr-f14-written-last-evening-arrival-today` (tomorrow_early) KAPALI [-|false|none|early_checkin|-|0|false|-] → AÇIK [-|false|early_checkin|early_checkin|-|0|false|-]
- `te-en-f14-written-last-evening-checkout-today` (tomorrow_early) KAPALI [-|false|none|late_checkout|-|1|false|-] → AÇIK [-|false|late_checkout|late_checkout|-|0|false|-]
- `co-tr-correction-earlier` (checkout_time) KAPALI [-|true|none|none|09:00|0|false|false] → AÇIK [-|false|none|none|09:00|0|true|false]
- `ct-en-accepts-host-paid-offer` (closing_trap) KAPALI [-|false|none|late_checkout|-|0|false|false] → AÇIK [-|false|late_checkout|late_checkout|-|0|false|false]
- `amb-tr-midnight-twin-daytime-arrival-today` (ambiguous) KAPALI [-|false|early_checkin|early_checkin|-|0|true|-] → AÇIK [-|false|early_checkin|early_checkin|-|0|false|-]

## Soru soran cevaplar (insan okur)

- `te-en-f14-written-last-evening-checkout-today` [off] (tomorrow_early, beklenen none): ["Would you like to request a late check-out for today?"]

## Bekleme sözü, yanlış susturma, sızıntı (satır satır)

- `amb-tr-midnight-twin-daytime-arrival-today` [off] (ambiguous) sessiz=null otomatik=false söz=true — "Merhaba,\n\nYarınki erken giriş, dairenin temizliğinin tamamlanmasına ve ev sahibinizin onayına bağlıdır. Sabah 10:00’da şehre varacağınızı not ettim; giriş talebiniz ev sahibinizin kararıdır ve mesajınız kaydedildi, ev sahibiniz görebilir."
- `co-tr-correction-earlier` [on] (checkout_time) sessiz=null otomatik=false söz=true — "Düzeltme için teşekkürler, 09:00 olarak not ettim."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `58f4163`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | none |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` (öğe + yabancı dil örneği `6772725db6f1`) · anlama `c24de69367b2` (kip: cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
