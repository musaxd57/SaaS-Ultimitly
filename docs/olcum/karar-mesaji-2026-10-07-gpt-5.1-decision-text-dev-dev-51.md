# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-5.1 (2026-10-07)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `d6b9610da8cb`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 40/40 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 40/40 (100%) |
| 🚨 onayda karar saati metinde | 19/19 (100%) |
| gün adlandırıldı | 40/40 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 39/39 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/40 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 13/14 (93%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 2.3 sn / 3.4 sn |
| maliyet (liste fiyatı) | $0.1031 |

## Şablona düşüş nedenleri


## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 13:00 itibarıyla daireye giriş yapabilirsiniz.
- **d-02** (early_checkin · approve · en) — YZ: Your early check-in is approved — you can check in on 14 November from 14:00.
- **d-03** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt, Sie können am 14. November um 13:30 einchecken. Für den frühen Check-in fällt eine Gebühr von 20 € an.
- **d-04** (early_checkin · approve · fr) — YZ: Votre arrivée anticipée est confirmée : vous pouvez arriver le 14 novembre à partir de 12:00. Des frais d’arrivée anticipée de 15 € s’appliquent. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Su entrada anticipada está confirmada: el 14 de noviembre puede hacer el check-in a partir de las 13:00.
- **d-06** (early_checkin · approve · ru) — YZ: Ранний заезд подтверждён: 14 ноября вы можете заселиться с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: تمت الموافقة على تسجيل الدخول المبكر، يمكنكم تسجيل الدخول يوم 14 نوفمبر في الساعة 13:00 بدلًا من 15:00.
- **d-08** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 11:00 itibarıyla giriş yapabilirsiniz. Bu erken giriş için ücret ₺750 olacaktır. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 12:00. The early check-in fee is €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt, Sie können am 14. November ab 14:00 Uhr einchecken, anstatt zur Standardzeit um 15:00 Uhr.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 14 Kasım günü erken giriş maalesef mümkün değil, giriş saatiniz 15:00; önceki misafirinizin çıkışı 12:00 olduğundan temizlik henüz tamamlanmayacak.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in at 11:00 on 14 November is not possible; your check-in time will be from 15:00. Çıkış temizliği henüz bitmedi.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November um 10:00 ist leider nicht möglich, da der vorherige Gast erst um 11:00 auscheckt; der reguläre Check-in ist ab 15:00 möglich.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Une arrivée anticipée le 14 novembre à 13:00 n’est pas possible, l’arrivée se fait à partir de 15:00 car le ménage de départ n’est pas encore terminé.
- **d-15** (early_checkin · decline · es) — YZ: El 14 de noviembre no será posible la entrada anticipada a las 12:00; la entrada es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: Ранний заезд 14 ноября в 09:00, к сожалению, невозможен, заезд возможен с 15:00, так как предыдущий гость выезжает в 11:00 и уборка ещё не завершена.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: تسجيل الدخول المبكر في يوم 14 نوفمبر في الساعة 12:00 غير ممكن، لأن تنظيف المغادرة لم ينتهِ بعد، ويمكنكم تسجيل الدخول بدءًا من الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü ne yazık ki erken giriş yapmanız mümkün olmayacak, daireye giriş saati 15:00.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in on 14 November is not possible; your check-in time will be from 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November um 12:00 ist leider nicht möglich; der Check-in ist an diesem Tag ab 15:00 Uhr möglich.
- **d-21** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 18 Kasım günü çıkış saatiniz 13:00 olacaktır. Normal çıkış saatimiz 11:00’dir.
- **d-22** (late_checkout · approve · en) — YZ: Your late check-out is approved; you can check out by 12:00 on 18 November instead of the standard 11:00.
- **d-23** (late_checkout · approve · de) — YZ: Ihr später Check-out ist bestätigt, Sie können am 18. November bis 12:30 auschecken anstatt um 11:00.
- **d-24** (late_checkout · approve · fr) — YZ: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu'à 14:00 le 18 novembre. L’horaire de départ prévu initialement reste 11:00 en temps normal.
- **d-25** (late_checkout · approve · es) — YZ: Su salida tardía está confirmada: el 18 de noviembre puede dejar el alojamiento hasta las 12:00. La hora habitual de salida es a las 11:00.
- **d-26** (late_checkout · approve · ru) — YZ: Поздний выезд одобрен: 18 ноября вы можете выехать до 13:00 вместо стандартных 11:00.
- **d-27** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل الخروج المتأخر؛ يمكنكم الخروج يوم 18 نوفمبر في الساعة 12:00 بدلًا من الساعة 11:00 المعتادة.
- **d-28** (late_checkout · approve · tr) — YZ: 18 Kasım günü çıkışınızı 16:00 saatinde yapabilirsiniz; standart çıkış saatimiz 11:00’dir.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü ne yazık ki 14:00’e kadar geç çıkış mümkün değil, çıkış saatiniz en geç 11:00 olmalıdır; aynı gün yeni misafir giriş yapacağı için temizlik süresine ihtiyacımız var.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 18 November is not possible, check-out is by 11:00. Another guest is arriving the same day and the check-out and cleaning must be completed before 13:00.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — YZ: Ein später Check-out am 18. November bis 14:00 ist leider nicht möglich, da am selben Tag neue Gäste anreisen, daher ist der Check-out bis 11:00.
- **d-32** (late_checkout · decline · fr) — YZ: Un départ tardif ne sera pas possible le 18 novembre à 12:00 ; le départ doit se faire au plus tard à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: El 18 de noviembre no es posible la salida tardía hasta las 15:00; la salida estándar es hasta las 11:00, ya que ese mismo día llega un nuevo huésped.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: Поздний выезд 18 ноября в 14:00, к сожалению, невозможен; выезд должен быть до 11:00, так как в этот же день уже одобрен ранний заезд другим гостям на 12:00.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: لن يكون تسجيل الخروج المتأخر حتى الساعة 13:00 ممكنًا يوم 18 نوفمبر، إذ يوجد في اليوم نفسه ضيف جديد، لذا يكون وقت تسجيل الخروج هو الساعة 11:00.
- **d-36** (late_checkout · decline · tr) — YZ: 18 Kasım günü geç çıkış maalesef mümkün olmayacak, standart çıkış saatiniz 11:00 olacaktır.
- **d-37** (late_checkout · decline · en) — YZ: Late check-out on 18 November is not possible, so check-out will need to be by 11:00.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you may check in on 14 November from 14:00 instead of the standard 16:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü saat 12:00’ye kadar geç çıkış maalesef mümkün değil, çıkış saatiniz 10:00. Aynı gün yeni misafir giriş yapacağı için temizlik süresine ihtiyacımız var.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: Une arrivée anticipée à 14:00 ne sera pas possible le 14 novembre, car le départ précédent est à 12:00 et le nettoyage n’est pas encore terminé ; l’arrivée se fait à partir de 16:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `2f5347a`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| gpt-5.1-2025-11-13 | 80 | 75135 | 40192 | 5439 | 0 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `2f5347a`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
