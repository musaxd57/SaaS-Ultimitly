# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-5.1 (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 40/40 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 40/40 (100%) |
| 🚨 onayda karar saati metinde | 19/19 (100%) |
| gün adlandırıldı | 40/40 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 38/38 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/40 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 10/14 (71%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 2.9 sn / 4.5 sn |
| maliyet (liste fiyatı) | $0.0598 |

## Şablona düşüş nedenleri


## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 13:00 itibarıyla giriş yapabilirsiniz. Konaklamanız boyunca standart giriş saatimiz olan 15:00 yerine belirttiğiniz saatte daireniz hazır olacaktır.
- **d-02** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 14:00.
- **d-03** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt – Sie können am 14. November um 13:30 einchecken. Die Gebühr für den frühen Check-in beträgt 20 €.
- **d-04** (early_checkin · approve · fr) — YZ: Votre arrivée anticipée est confirmée : vous pouvez arriver le 14 novembre à partir de 12:00. Des frais d’arrivée anticipée de 15 € s’appliquent. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Su entrada anticipada está confirmada: el 14 de noviembre puede hacer el check-in a partir de las 13:00, en lugar de las 15:00 habituales.
- **d-06** (early_checkin · approve · ru) — YZ: Ранний заезд подтверждён: 14 ноября вы можете заселиться с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: تمت الموافقة على تسجيل الدخول المبكر، يمكنكم تسجيل الدخول يوم 14 نوفمبر في الساعة 13:00 بدلاً من الساعة 15:00.
- **d-08** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 11:00 itibarıyla giriş yapabilirsiniz. Bu erken giriş için ₺750 ek ücret alınacaktır. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 12:00, and the early check-in fee is €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt, Sie können am 14. November ab 14:00 einchecken. Die reguläre Check-in-Zeit ist 15:00.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 14 Kasım günü erken giriş maalesef mümkün değil, standart giriş saati 15:00; önceki konaklamanın çıkış temizliği henüz tamamlanmadı.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 14 November at 11:00 is not possible; check-in is from 15:00. The apartment is still being cleaned at that time.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November um 10:00 ist leider nicht möglich, da die Wohnung noch gereinigt wird. Sie können am 14. November ab 15:00 einchecken.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Une arrivée anticipée ne sera pas possible le 14 novembre à 13:00, le logement étant encore en cours de nettoyage, l’enregistrement se fait à partir de 15:00.
- **d-15** (early_checkin · decline · es) — YZ: El 14 de noviembre no será posible la entrada anticipada a las 12:00; la entrada es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: Ранний заезд 14 ноября в 09:00, к сожалению, невозможен, так как ещё идёт уборка после предыдущего гостя. Заезд для вас возможен с 15:00.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: تسجيل الدخول المبكر في يوم 14 نوفمبر الساعة 12:00 غير ممكن، حيث إن التنظيف بعد المغادرة لم يكتمل بعد، ويمكنكم تسجيل الدخول بدءًا من الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü erken giriş ne yazık ki mümkün olmayacak, daireye giriş saati 15:00 olarak kalacak.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in on 14 November is not possible; your check-in time is from 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November um 12:00 ist leider nicht möglich; Sie können am 14. November ab 15:00 einchecken.
- **d-21** (late_checkout · approve · tr) — YZ: 18 Kasım günü çıkışınızı 13:00’de yapabilirsiniz; normal çıkış saatimiz 11:00’dir.
- **d-22** (late_checkout · approve · en) — YZ: Your late check-out is approved; you can check out by 12:00 on 18 November. This is a bit later than the standard check-out time of 11:00.
- **d-23** (late_checkout · approve · de) — YZ: Ihr später Check-out ist bestätigt; Sie können am 18. November bis 12:30 auschecken. Die reguläre Check-out-Zeit ist 11:00.
- **d-24** (late_checkout · approve · fr) — YZ: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu’à 14:00 le 18 novembre. L’horaire de départ standard reste fixé à 11:00.
- **d-25** (late_checkout · approve · es) — YZ: La salida tardía está confirmada: el 18 de noviembre puede dejar el alojamiento hasta las 12:00. No es posible ampliarla hasta las 13:00, ya que ese mismo día llega un nuevo huésped y se necesita tiempo para la limpieza.
- **d-26** (late_checkout · approve · ru) — YZ: Поздний выезд одобрен: 18 ноября вы можете выехать до 13:00 вместо стандартных 11:00.
- **d-27** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل الخروج المتأخر، يمكنكم المغادرة يوم 18 نوفمبر الساعة 12:00 بدلاً من الساعة 11:00 المعتادة.
- **d-28** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 18 Kasım günü çıkış saatiniz 16:00 olacaktır. Standart çıkış saatimiz 11:00’dir.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü saat 14:00’e kadar geç çıkış maalesef mümkün değil, standart çıkış saatiniz 11:00. Aynı gün yeni misafir giriş yapacağı için bu süre içinde dairenin temizlenmesi gerekiyor.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 18 November is not possible, so check-out must be by 11:00. There is a new guest arriving the same day and the apartment needs to be ready before then.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — YZ: Ein später Check-out am 18. November bis 14:00 ist leider nicht möglich, da an diesem Tag noch eine neue Anreise stattfindet; der Check-out ist bis 11:00 Uhr.
- **d-32** (late_checkout · decline · fr) — YZ: Un départ tardif ne sera pas possible le 18 novembre à 12:00 ; le départ doit se faire au plus tard à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: El 18 de noviembre no será posible la salida tardía; la salida es hasta las 11:00, ya que ese mismo día llega un nuevo huésped y necesitamos tiempo para la limpieza.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: Поздний выезд 18 ноября в 14:00, к сожалению, невозможен; выезд должен быть до 11:00, так как в этот же день заезжает новый гость.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: لن يكون تسجيل الخروج المتأخر حتى الساعة 13:00 ممكنًا يوم 18 نوفمبر، لذا يجب أن يكون تسجيل الخروج في الساعة 11:00، إذ يصل ضيف جديد في نفس اليوم.
- **d-36** (late_checkout · decline · tr) — YZ: Maalesef 18 Kasım günü geç çıkış mümkün olmayacak; standart çıkış saatiniz 11:00.
- **d-37** (late_checkout · decline · en) — YZ: Late check-out on 18 November is not possible, so check-out will need to be by 11:00.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 14:00 instead of the standard 16:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış ne yazık ki mümkün değil, standart çıkış saatiniz 10:00. Aynı gün yeni misafir giriş yapacağı için dairenin temizlenmesi gerekiyor.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: Une arrivée anticipée le 14 novembre à 14:00 n’est pas possible, l’appartement est encore en cours de nettoyage ce jour-là ; votre heure d’arrivée reste donc à partir de 16:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| gpt-5.1-2025-11-13 | 40 | 26564 | 0 | 2246 | 0 |
| gpt-6-luna | 40 | 51318 | 47320 | 6615 | 3396 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `43a0db6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
