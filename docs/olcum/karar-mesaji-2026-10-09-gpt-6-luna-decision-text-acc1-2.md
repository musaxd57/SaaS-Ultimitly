# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-6-luna (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-acc1.json` · satır 30/30 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 30/30 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 30/30 (100%) |
| 🚨 onayda karar saati metinde | 15/15 (100%) |
| gün adlandırıldı | 30/30 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 28/28 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/30 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 4/10 (40%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/5 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 3.5 sn / 5.1 sn |
| maliyet (liste fiyatı) | $0.0066 |

## Şablona düşüş nedenleri


## Metinler

- **a1-01** (early_checkin · approve · tr) — YZ: 6 Kasım günü saat 12:00'de giriş yapabilirsiniz; erken giriş ücreti ₺300. Anahtar kutusu kapının solunda.
- **a1-02** (early_checkin · approve · en) — YZ: You can check in early on 9 November at 13:00. The early check-in fee is US$25.
- **a1-03** (early_checkin · approve · de) — YZ: Sie können am 12. November ab 12:00 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 12,50 €. Otoparkta 4 numaralı yeri kullanabilirsiniz.
- **a1-04** (early_checkin · approve · fr) — YZ: Vous pouvez arriver le 14 novembre à 13:00. Les frais d’arrivée anticipée s’élèvent à 20 €.
- **a1-05** (early_checkin · approve · es) — YZ: Puede hacer el check-in el 17 de noviembre a las 13:00. La tarifa por entrada anticipada es de 15 US$.
- **a1-06** (early_checkin · approve · ru) — YZ: Вы можете заселиться 20 ноября в 11:30. Kapı şifresi giriş günü sabah ayrıca gönderilecek.
- **a1-07** (early_checkin · approve · ar) — YZ: يمكنكم تسجيل الدخول يوم 23 نوفمبر عند الساعة 12:00. رسوم تسجيل الدخول المبكر ‏750 TRY.
- **a1-08** (early_checkin · approve · en) — YZ: Your early check-in is approved; you may check in on 26 November at 14:00. The fee is €30.
- **a1-09** (late_checkout · approve · tr) — YZ: 8 Kasım günü çıkışınızı 13:00'te yapabilirsiniz.
- **a1-10** (late_checkout · approve · de) — YZ: Sie können am 11. November bis 13:00 auschecken.
- **a1-11** (late_checkout · approve · fr) — YZ: Vous pouvez quitter le logement jusqu’à 14:00 le 15 novembre.
- **a1-12** (late_checkout · approve · es) — YZ: Puede hacer el check-out el 19 de noviembre a las 14:00.
- **a1-13** (late_checkout · approve · ru) — YZ: Вы можете выехать 22 ноября до 13:00.
- **a1-14** (late_checkout · approve · ar) — YZ: يمكنكم تسجيل الخروج يوم 28 نوفمبر الساعة 13:30.
- **a1-15** (late_checkout · approve · tr) — YZ: 2 Aralık günü saat 12:30'da çıkış yapabilirsiniz.
- **a1-16** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 4 Aralık günü erken giriş mümkün değil; giriş saatiniz 15:00.
- **a1-17** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 5 December isn't possible, as cleaning is still in progress; check-in is from 15:00.
- **a1-18** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 7. Dezember ist leider nicht möglich; der Check-in ist ab 14:00 Uhr möglich.
- **a1-19** (early_checkin · decline · fr · gerekçe cleaning) — YZ: L’arrivée anticipée ne sera pas possible le 9 décembre, car le ménage est encore en cours ; l’arrivée se fait à partir de 16:00.
- **a1-20** (early_checkin · decline · es · gerekçe previous_guest) — YZ: No será posible realizar el check-in anticipado el 11 de diciembre; el horario habitual de entrada es a las 15:00.
- **a1-21** (early_checkin · decline · ru · gerekçe cleaning) — YZ: Ранний заезд 13 декабря невозможен, поскольку уборка ещё не завершена; стандартное время заезда — 14:00.
- **a1-22** (early_checkin · decline · ar) — YZ: لا يمكن تسجيل الدخول مبكرًا يوم 15 ديسمبر؛ يبدأ تسجيل الدخول الساعة 15:00.
- **a1-23** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 17 Aralık günü 14:00'te çıkış yapmanız mümkün değil; çıkış saati 11:00. Aynı gün yeni bir misafir giriş yapacağı için geç çıkış talebinizi karşılayamıyoruz.
- **a1-24** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 19 December isn’t possible; check-out is by 11:00.
- **a1-25** (late_checkout · decline · de) — YZ: Ein später Check-out am 21. Dezember ist leider nicht möglich; der Check-out ist um 10:00 Uhr.
- **a1-26** (late_checkout · decline · fr) — YZ: Le départ tardif n’est pas possible le 23 décembre ; le départ doit avoir lieu à 11:00.
- **a1-27** (late_checkout · decline · es · gerekçe next_guest) — YZ: No será posible realizar una salida tardía el 26 de diciembre; la hora de salida es 12:00, ya que ese mismo día llega un nuevo huésped.
- **a1-28** (late_checkout · decline · ru · gerekçe cleaning) — YZ: К сожалению, поздний выезд 28 декабря невозможен; выезд — до 12:00.
- **a1-29** (late_checkout · decline · ar) — YZ: لا يمكن تسجيل الخروج متأخرًا يوم 30 ديسمبر؛ موعد تسجيل الخروج المعتاد هو 11:00.
- **a1-30** (early_checkin · decline · en) — YZ: Early check-in on 31 December isn't possible; check-in is from 15:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | medium |
| Anlama katmanı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| gpt-6-luna | 60 | 58579 | 36048 | 7929 | 4243 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | medium |
| Anlama katmanı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
