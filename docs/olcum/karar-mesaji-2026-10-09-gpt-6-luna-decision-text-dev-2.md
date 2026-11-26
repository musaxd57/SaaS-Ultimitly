# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-6-luna (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 40/40 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 40/40 (100%) |
| 🚨 onayda karar saati metinde | 19/19 (100%) |
| gün adlandırıldı | 40/40 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 39/39 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/40 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 7/14 (50%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 3.7 sn / 5.4 sn |
| maliyet (liste fiyatı) | $0.0093 |

## Şablona düşüş nedenleri


## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 13:00 itibarıyla giriş yapabilirsiniz.
- **d-02** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in at 14:00 on 14 November.
- **d-03** (early_checkin · approve · de) — YZ: Sie können am 14. November ab 13:30 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 20 €.
- **d-04** (early_checkin · approve · fr) — YZ: Vous pouvez arriver le 14 novembre à 12:00 ; les frais d’arrivée anticipée s’élèvent à 15 €. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Puede hacer el check-in el 14 de noviembre a las 13:00.
- **d-06** (early_checkin · approve · ru) — YZ: Вы можете заселиться 14 ноября с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: يمكنكم تسجيل الدخول يوم 14 نوفمبر في الساعة 13:00.
- **d-08** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 11:00'de giriş yapabilirsiniz; erken giriş ücreti ₺750. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: Your early check-in is approved: you can check in on 14 November at 12:00 for a fee of €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Sie können am 14. November um 14:00 einchecken.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 14 Kasım günü 12:00'de erken giriş mümkün değil; çıkış temizliği henüz tamamlanmadığı için standart giriş saati 15:00'tir.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 14 November won’t be possible, as cleaning is still in progress; check-in is from 15:00.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich, da die Reinigung noch nicht abgeschlossen ist; der Check-in ist ab 15:00 Uhr möglich.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: L’arrivée anticipée n’est pas possible le 14 novembre, car le ménage n’est pas encore terminé ; vous pourrez arriver à partir de 15:00.
- **d-15** (early_checkin · decline · es) — YZ: No será posible realizar el check-in anticipado el 14 de noviembre; la entrada es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: Ранний заезд 14 ноября невозможен, уборка еще не завершена; Вы сможете заселиться с 15:00.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: لا يمكن لحضرتكم تسجيل الدخول مبكرًا يوم 14 نوفمبر، إذ لم ينتهِ تنظيف الشقة بعد، ويبدأ تسجيل الدخول الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü 13:00'te erken giriş mümkün değil; giriş saatiniz 15:00.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in is not possible on 14 November; check-in is at 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich; der reguläre Check-in ist ab 15:00 Uhr möglich.
- **d-21** (late_checkout · approve · tr) — YZ: 18 Kasım günü saat 13:00'te çıkış yapabilirsiniz.
- **d-22** (late_checkout · approve · en) — YZ: Your late check-out is approved; you may check out at 12:00 on 18 November.
- **d-23** (late_checkout · approve · de) — YZ: Sie können am 18. November bis 12:30 Uhr auschecken.
- **d-24** (late_checkout · approve · fr) — YZ: Vous pouvez quitter le logement à 14:00 le 18 novembre.
- **d-25** (late_checkout · approve · es) — YZ: Puede hacer el check-out el 18 de noviembre a las 12:00.
- **d-26** (late_checkout · approve · ru) — YZ: 18 ноября Вы можете выехать в 13:00.
- **d-27** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل المغادرة المتأخر، ويمكنكم تسجيل المغادرة يوم 18 نوفمبر الساعة 12:00.
- **d-28** (late_checkout · approve · tr) — YZ: 18 Kasım günü saat 16:00'da çıkış yapabilirsiniz.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü 14:00'te çıkış yapmanız mümkün değil; aynı gün yeni bir misafir giriş yapacağı için çıkış saati 11:00'dır.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 18 November isn’t possible; check-out is by 11:00 because a new guest arrives the same day.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — YZ: Ein später Check-out am 18. November ist leider nicht möglich, da am selben Tag ein neuer Gast anreist; der Check-out ist bis 11:00 Uhr.
- **d-32** (late_checkout · decline · fr) — YZ: Le départ tardif ne sera pas possible le 18 novembre ; le départ doit avoir lieu au plus tard à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: No es posible realizar el check-out tardío el 18 de noviembre; la salida es a las 11:00, ya que ese mismo día llega un nuevo huésped.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: 18 ноября поздний выезд невозможен: в этот день прибывает новый гость, поэтому выезд необходимо завершить до 11:00.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: لا يمكن تمديد وقت تسجيل الخروج يوم 18 نوفمبر؛ موعد تسجيل الخروج هو الساعة 11:00، إذ يصل ضيف جديد في اليوم نفسه.
- **d-36** (late_checkout · decline · tr) — YZ: 18 Kasım günü geç çıkış yapmanız mümkün değil; çıkış saati 11:00.
- **d-37** (late_checkout · decline · en) — YZ: Late check-out on 18 November isn't possible; check-out is by 11:00.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November at 14:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış yapmanız mümkün değil; standart çıkış saatiniz 10:00, çünkü aynı gün yeni bir misafir giriş yapacak.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: Il ne sera pas possible d’avancer votre arrivée le 14 novembre, car le ménage n’est pas encore terminé ; vous pourrez arriver à partir de 16:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | high |
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
| gpt-6-luna | 80 | 77412 | 48022 | 11849 | 6877 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | high |
| Anlama katmanı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
