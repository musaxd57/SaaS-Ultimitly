# Konuşma Anlama Durumu eval'i — gpt-6-luna (2026-10-09)

Durum: **GEÇERLİ** · commit `c6996fb` · veri sürümü 1 · senaryo 8 × 2 kol
Yapılandırma: anlama katmanı AÇIK · bekçi KOŞMAZ (kapanış birebir, sızıntı temkinli — `conversation-state-harness.ts` başı) · eylem beyanı KAPALI · gün 2026-10-10 (Europe/Istanbul, varsayılan yerel saat 14:00)

| ölçü | hedef | bayrak KAPALI | bayrak AÇIK |
|---|---|---|---|
| 🚨 SIZINTI (beklenti 'gitmez' iken otomatik gitti) | 0 | 0/5 (0%) | 0/5 (0%) |
| 🚨 YANLIŞ SUSTURMA (gerçek soru/istek susturuldu) | 0 | 0/7 (0%) | 0/7 (0%) |
| kapanış: sessiz kaldı |  | 1/1 (100%) | 1/1 (100%) |
| kapanış: gereksiz OTOMATİK cevap |  | 0/1 (0%) | 0/1 (0%) |
| kapanış: gereksiz taslak (ev sahibine) |  | 0/1 (0%) | 0/1 (0%) |
| 🚨 BEKLEME SÖZÜ misafire giden | 0 | 0/2 (0%) | 0/2 (0%) |
| bekleme sözü model üretti (kapı tuttu) |  | 0/7 (0%) | 0/7 (0%) |
| netleştirme: çözülebilir mesajda soru soruldu | ≈0 | 0/6 (0%) | 0/6 (0%) |
| 🚨 GENEL netleştirme (tüm cevaplar) | 0 | 0/7 (0%) | 0/7 (0%) |
| belirsiz mesajda TEK hedefli soru |  | 1/1 (100%) | 1/1 (100%) |
| konaklama türü: cevap modelinin beyanı doğru |  | — | — |
| konaklama türü: anlama katmanı doğru |  | — | — |
| 🚨 çıkış saati: yolculuk saati çıkış diye kaydedildi | 0 | — | — |
| çıkış saati: doğru kayıt (düzeltme dahil) |  | — | — |
| ev sahibindeki konu: karar/izin/söz YOK |  | — | — |
| selam tekrarı (önceki cevaptan sonra) | 0 | 0/2 (0%) | 0/2 (0%) |
| anlama katmanı düştü (satır geçersiz sayılır) | 0 | 0/7 (0%) | 0/7 (0%) |
| cevap modeli yedeğe düştü / hata | 0 | 0/8 (0%) | 0/8 (0%) |

Sınıf bazında (otomatik gönderim · sessiz):

| sınıf | KAPALI otomatik | KAPALI sessiz | AÇIK otomatik | AÇIK sessiz |
|---|---|---|---|---|
| closing | 0/1 (0%) | 1/1 (100%) | 0/1 (0%) | 1/1 (100%) |
| resolvable | 2/6 (33%) | 0/6 (0%) | 2/6 (33%) | 0/6 (0%) |
| ambiguous | 0/1 (0%) | 0/1 (0%) | 0/1 (0%) | 0/1 (0%) |

## Kollar arasında değişen senaryolar

Alanlar: sessiz | otomatik | beyan | anlama türü | kayıtlı çıkış | soru sayısı | söz | selam

(yok)

## Soru soran cevaplar (insan okur)

- `f8-8-tr-ambiguous-availability` [off] (ambiguous, beklenen one): ["Hangi ayın 3’ü ile 4’ünü kastediyorsunuz?"]
- `f8-8-tr-ambiguous-availability` [on] (ambiguous, beklenen one): ["Hangi ayın 3'ü ile 4'ünü kastediyorsunuz?"]

## Bekleme sözü, yanlış susturma, sızıntı (satır satır)


## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c6996fb`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
