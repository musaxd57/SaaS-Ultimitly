# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-6-luna (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 40/40 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 40/40 (100%) |
| 🚨 onayda karar saati metinde | 19/19 (100%) |
| gün adlandırıldı | 40/40 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 40/40 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/40 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 5/14 (36%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 3.4 sn / 4.9 sn |
| maliyet (liste fiyatı) | $0.0076 |

## Şablona düşüş nedenleri


## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 13:00 itibarıyla giriş yapabilirsiniz.
- **d-02** (early_checkin · approve · en) — YZ: You can check in early on 14 November from 14:00.
- **d-03** (early_checkin · approve · de) — YZ: Sie können am 14. November ab 13:30 Uhr einchecken. Für den frühen Check-in beträgt die Gebühr 20 €.
- **d-04** (early_checkin · approve · fr) — YZ: Vous pouvez arriver le 14 novembre à 12:00. Les frais d’arrivée anticipée sont de 15 €. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Puede hacer el check-in el 14 de noviembre a las 13:00.
- **d-06** (early_checkin · approve · ru) — YZ: Вы можете заселиться 14 ноября с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: يمكنكم تسجيل الدخول يوم 14 نوفمبر في الساعة 13:00.
- **d-08** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 11:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti ₺750. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: You can check in on 14 November at 12:00. The early check-in fee is €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Sie können am 14. November ab 14:00 Uhr einchecken.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 14 Kasım günü 12:00'de erken giriş mümkün değil; temizlik henüz bitmediği için giriş saatiniz 15:00 olacaktır.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 14 November is not possible, as the cleaning is still in progress. Check-in is from 15:00.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich, da die Reinigung noch nicht abgeschlossen ist. Der Check-in ist ab 15:00 Uhr möglich.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Une arrivée anticipée ne sera pas possible le 14 novembre, car le ménage de départ n’est pas terminé. Vous pourrez arriver à partir de 15:00.
- **d-15** (early_checkin · decline · es) — YZ: No será posible realizar el check-in anticipado el 14 de noviembre; el check-in es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: К сожалению, ранний заезд 14 ноября невозможен, поскольку уборка ещё не закончена. Заезд — с 15:00.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: للأسف، لا يمكن تسجيل الدخول مبكرًا يوم 14 نوفمبر لأن تنظيف الشقة لم ينتهِ بعد؛ يبدأ تسجيل الدخول الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü 13:00'te erken giriş mümkün değil; standart giriş saati 15:00.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in is not possible on 14 November; check-in is from 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich; der Check-in ist ab 15:00 Uhr möglich.
- **d-21** (late_checkout · approve · tr) — YZ: 18 Kasım günü saat 13:00'te çıkış yapabilirsiniz.
- **d-22** (late_checkout · approve · en) — YZ: You can check out by 12:00 on 18 November.
- **d-23** (late_checkout · approve · de) — YZ: Sie können am 18. November bis 12:30 auschecken.
- **d-24** (late_checkout · approve · fr) — YZ: Vous pouvez quitter le logement le 18 novembre à 14:00.
- **d-25** (late_checkout · approve · es) — YZ: Puede hacer el check-out el 18 de noviembre a las 12:00.
- **d-26** (late_checkout · approve · ru) — YZ: Вы можете выехать 18 ноября в 13:00.
- **d-27** (late_checkout · approve · ar) — YZ: يمكنكم تسجيل الخروج يوم 18 نوفمبر الساعة 12:00.
- **d-28** (late_checkout · approve · tr) — YZ: 18 Kasım günü saat 16:00'da çıkış yapabilirsiniz.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış mümkün değil; aynı gün yeni bir misafir giriş yapacağı için çıkış saati 11:00.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — YZ: Unfortunately, late check-out on 18 November is not possible, so check-out is by 11:00.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — YZ: Ein später Check-out am 18. November ist leider nicht möglich, da am selben Tag ein neuer Gast anreist. Der Check-out ist bis 11:00 Uhr.
- **d-32** (late_checkout · decline · fr) — YZ: Le départ tardif n’est pas possible le 18 novembre ; le départ se fait à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: No será posible realizar el check-out tardío el 18 de noviembre, ya que ese mismo día llega un nuevo huésped. El check-out es hasta las 11:00.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: К сожалению, поздний выезд 18 ноября невозможен: выезд — до 11:00.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: لا يمكن تسجيل الخروج المتأخر يوم 18 نوفمبر، إذ يصل ضيف جديد في اليوم نفسه؛ وموعد تسجيل الخروج المعتاد هو 11:00.
- **d-36** (late_checkout · decline · tr) — YZ: 18 Kasım günü geç çıkış yapmanız mümkün değil; çıkış saati 11:00.
- **d-37** (late_checkout · decline · en) — YZ: Unfortunately, late check-out on 18 November is not possible; check-out is by 11:00.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November at 14:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış mümkün değil; standart çıkış saati 10:00.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: Votre arrivée anticipée ne sera pas possible le 14 novembre, car le ménage n'est pas encore terminé. L'arrivée est possible à partir de 16:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
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
| gpt-6-luna | 80 | 77345 | 47320 | 8280 | 3567 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
