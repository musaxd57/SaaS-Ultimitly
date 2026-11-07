# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-5.1 (2026-10-31)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 39/40 (98%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 39/39 (100%) |
| 🚨 onayda karar saati metinde | 19/19 (100%) |
| gün adlandırıldı | 39/39 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 38/38 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/39 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 10/13 (77%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 3.5 sn / 4.5 sn |
| maliyet (liste fiyatı) | $0.0695 |

## Şablona düşüş nedenleri

- check_failed (internal_copy): 1

## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 13:00 itibarıyla daireye giriş yapabilirsiniz. Standart giriş saatimiz 15:00 olduğu için buna göre plan yapabilirsiniz.
- **d-02** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 14:00. Our standard check-in time is 15:00.
- **d-03** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt: Sie können am 14. November um 13:30 einchecken. Die Gebühr für den frühen Check-in beträgt 20 €.
- **d-04** (early_checkin · approve · fr) — YZ: Votre arrivée anticipée est confirmée : vous pourrez accéder au logement le 14 novembre à partir de 12:00. Des frais de 15 € s’appliquent pour cette arrivée avant l’heure d’enregistrement standard de 15:00. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Su entrada anticipada está confirmada: el 14 de noviembre puede hacer el check-in a partir de las 13:00, en lugar de las 15:00 habituales.
- **d-06** (early_checkin · approve · ru) — YZ: Ранний заезд одобрен: 14 ноября вы можете заселиться с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: تمت الموافقة على تسجيل الدخول المبكر، يمكنكم تسجيل الدخول يوم 14 نوفمبر في الساعة 13:00 بدلًا من 15:00 المعتادة.
- **d-08** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 14 Kasım günü saat 11:00 itibarıyla giriş yapabilirsiniz. Bu erken giriş için ₺750 ücret alınacaktır. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November at 12:00. The early check-in fee is €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt, Sie können am 14. November ab 14:00 Uhr einchecken. Die reguläre Check-in-Zeit ist 15:00 Uhr.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — şablon/check_failed: Maalesef 14 Kasım günü erken giriş mümkün olmayacak; giriş saati 15:00.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 14 November at 11:00 is not possible; check-in is from 15:00, as the apartment is still being cleaned.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November um 10:00 ist leider nicht möglich; der Check-in ist an diesem Tag ab 15:00 Uhr möglich, da die Reinigung der Wohnung noch nicht abgeschlossen ist.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Une arrivée anticipée ne sera pas possible le 14 novembre à 13:00, le logement étant encore en cours de nettoyage. Vous pourrez vous enregistrer à partir de 15:00.
- **d-15** (early_checkin · decline · es) — YZ: El 14 de noviembre no será posible la entrada anticipada a las 12:00; la entrada ese día es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: Ранний заезд 14 ноября в 09:00, к сожалению, невозможен; заселение возможно с 15:00. В это время еще идет уборка после предыдущего гостя.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: لن يكون تسجيل الدخول المبكر ممكنًا يوم 14 نوفمبر في الساعة 12:00، حيث إن التنظيف بعد الضيوف السابقين لم يكتمل بعد، ويمكنكم تسجيل الدخول بدءًا من الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü 13:00’de erken giriş maalesef mümkün değil; giriş saatiniz 15:00 olacaktır.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in will not be possible on 14 November; check-in is from 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November um 12:00 ist leider nicht möglich. Der Check-in ist an diesem Tag ab 15:00 Uhr möglich.
- **d-21** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 18 Kasım günü çıkış saatiniz 13:00 olacaktır. Normal çıkış saatimiz 11:00 olduğu için bu tarihte 13:00’e kadar kalabilirsiniz.
- **d-22** (late_checkout · approve · en) — YZ: Your late check-out is approved; you can check out by 12:00 on 18 November. As we have a new guest arriving the same day, the latest we can offer is 12:00 instead of the standard 11:00 check-out.
- **d-23** (late_checkout · approve · de) — YZ: Ihr später Check-out ist bestätigt; Sie können am 18. November bis 12:30 Uhr auschecken.
- **d-24** (late_checkout · approve · fr) — YZ: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu'à 14:00 le 18 novembre. L’horaire de départ habituel est 11:00.
- **d-25** (late_checkout · approve · es) — YZ: Su salida tardía está autorizada: el 18 de noviembre puede dejar el alojamiento hasta las 12:00. No es posible ampliarla hasta las 13:00, ya que ese mismo día llega un nuevo huésped y la hora estándar de salida es a las 11:00.
- **d-26** (late_checkout · approve · ru) — YZ: Поздний выезд одобрен: 18 ноября вы можете выехать до 13:00 вместо стандартных 11:00.
- **d-27** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل الخروج المتأخر يوم 18 نوفمبر الساعة 12:00. وقت تسجيل الخروج المعتاد هو 11:00.
- **d-28** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 18 Kasım günü çıkış saatiniz 16:00 olacak. Normal çıkış saatimiz 11:00 olduğu için bu saate kadar konaklamaya devam edebilirsiniz.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü 14:00’a kadar geç çıkış ne yazık ki mümkün olmayacak; çıkış saatiniz 11:00. Aynı gün yeni misafir giriş yapacağı için dairenin hazırlanması gerekiyor.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 18 November is not possible, so check-out will need to be by 11:00. Another guest is arriving the same day, so the apartment must be ready earlier.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — YZ: Ein später Check-out am 18. November bis 14:00 Uhr ist leider nicht möglich; der Check-out ist bis 11:00 Uhr, da an diesem Tag noch gereinigt werden muss, bevor ein neuer Gast ankommt.
- **d-32** (late_checkout · decline · fr) — YZ: Un départ tardif à 12:00 ne sera pas possible le 18 novembre. Le départ doit se faire au plus tard à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: El 18 de noviembre no será posible la salida tardía hasta las 15:00; la salida es hasta las 11:00, ya que ese mismo día llega un nuevo huésped.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: Поздний выезд 18 ноября в 14:00, к сожалению, невозможен, так как в этот же день заезжает новый гость. Пожалуйста, выполните выезд до 11:00.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: لن يكون تسجيل الخروج المتأخر حتى الساعة 13:00 ممكنًا يوم 18 نوفمبر، إذ سيصل ضيف جديد في نفس اليوم، ولذلك يجب أن يكون تسجيل الخروج في الساعة 11:00.
- **d-36** (late_checkout · decline · tr) — YZ: 18 Kasım günü geç çıkış maalesef mümkün olmayacak, standart çıkış saatiniz 11:00.
- **d-37** (late_checkout · decline · en) — YZ: Late check-out on 18 November is not possible, so check-out will need to be by 11:00. Thank you for your understanding regarding the 12:00 request.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November from 14:00 instead of the standard 16:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış maalesef mümkün değil, standart çıkış saati 10:00 olarak kalacak; aynı gün yeni misafir giriş yapacağı için buna ihtiyacımız var.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: Une arrivée anticipée ne sera pas possible le 14 novembre à 14:00, car le logement est encore en cours de nettoyage. Votre arrivée sera possible à partir de 16:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `2863249d`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-5.1` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `bd6e8b2d6471` (öğe + yabancı dil örneği `34e8b0508392`) · anlama `2280457cf496` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| gpt-5.1-2025-11-13 | 40 | 26564 | 0 | 3217 | 890 |
| gpt-6-luna | 39 | 50104 | 44954 | 6264 | 3131 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `2863249d`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-5.1` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `bd6e8b2d6471` (öğe + yabancı dil örneği `34e8b0508392`) · anlama `2280457cf496` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
