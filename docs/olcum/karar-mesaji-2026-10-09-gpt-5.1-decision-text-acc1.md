# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-5.1 (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-acc1.json` · satır 30/30 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 30/30 (100%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 30/30 (100%) |
| 🚨 onayda karar saati metinde | 15/15 (100%) |
| gün adlandırıldı | 30/30 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 30/30 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/30 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 9/10 (90%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/5 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 3.3 sn / 4.5 sn |
| maliyet (liste fiyatı) | $0.0452 |

## Şablona düşüş nedenleri


## Metinler

- **a1-01** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 6 Kasım günü saat 12:00 itibarıyla giriş yapabilirsiniz. Bu erken giriş için ₺300 ücret uygulanacaktır. Anahtar kutusu kapının solunda.
- **a1-02** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 9 November from 13:00. The early check-in fee is US$25.
- **a1-03** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt – Sie können am 12. November ab 12:00 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 12,50 €. Otoparkta 4 numaralı yeri kullanabilirsiniz.
- **a1-04** (early_checkin · approve · fr) — YZ: Votre arrivée anticipée est confirmée : vous pouvez arriver le 14 novembre à partir de 13:00. Les frais d’arrivée anticipée sont de 20 €.
- **a1-05** (early_checkin · approve · es) — YZ: Su entrada anticipada está confirmada: el 17 de noviembre puede hacer el check-in a las 13:00. La tarifa por la entrada anticipada es de 15 US$.
- **a1-06** (early_checkin · approve · ru) — YZ: Ранний заезд подтверждён: 20 ноября вы можете заселиться с 11:30 вместо стандартного заезда с 14:00. Kapı şifresi giriş günü sabah ayrıca gönderilecek.
- **a1-07** (early_checkin · approve · ar) — YZ: تمت الموافقة على تسجيل الدخول المبكر؛ يمكنكم تسجيل الدخول يوم 23 نوفمبر الساعة 12:00، مع رسوم قدرها ‏750 TRY.
- **a1-08** (early_checkin · approve · en) — YZ: Your early check-in is approved — you can check in on 26 November from 14:00. The early check-in fee is €30.
- **a1-09** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 8 Kasım günü çıkış saatiniz 13:00 olacaktır. Standart çıkış saatimiz 11:00 olduğu için 14:00 yerine en geç 13:00’a kadar kalabilirsiniz.
- **a1-10** (late_checkout · approve · de) — YZ: Ihr später Check-out ist bestätigt, Sie können am 11. November bis 13:00 auschecken. Die reguläre Check-out-Zeit ist 10:00.
- **a1-11** (late_checkout · approve · fr) — YZ: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu’à 14:00 le 15 novembre, au lieu de l’horaire habituel de 11:00.
- **a1-12** (late_checkout · approve · es) — YZ: La salida tardía está confirmada: el 19 de noviembre puede dejar el alojamiento hasta las 14:00. El horario habitual de salida es a las 12:00.
- **a1-13** (late_checkout · approve · ru) — YZ: Поздний выезд подтверждён: 22 ноября вы можете выехать до 13:00 вместо стандартных 12:00.
- **a1-14** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل الخروج المتأخر؛ يمكنكم الخروج يوم 28 نوفمبر في الساعة 13:30 بدلًا من الساعة 11:00 المعتادة.
- **a1-15** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı, 2 Aralık günü çıkış saatiniz 12:30 olarak belirlenmiştir. Standart çıkış saatimiz 11:00’dır.
- **a1-16** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 4 Aralık günü 11:00’de erken giriş maalesef mümkün değil; giriş saatiniz 15:00 olacaktır, önceki misafir hâlâ çıkış yapıyor olacak.
- **a1-17** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in at 12:00 on 5 December is not possible; check-in is from 15:00, as the cleaning is not yet finished.
- **a1-18** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 7. Dezember um 10:00 ist leider nicht möglich; der Check-in ist ab 14:00 Uhr möglich, da die Wohnung nach dem Auszug des vorherigen Gastes noch gereinigt wird.
- **a1-19** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Une arrivée anticipée ne sera pas possible le 9 décembre, car le logement est encore en cours de nettoyage ce jour-là ; votre arrivée est donc possible à partir de 16:00.
- **a1-20** (early_checkin · decline · es · gerekçe previous_guest) — YZ: El 11 de diciembre no será posible la entrada anticipada a las 09:30; la entrada estándar es a partir de las 15:00, ya que el apartamento aún se está desocupando esa misma mañana.
- **a1-21** (early_checkin · decline · ru · gerekçe cleaning) — YZ: Ранний заезд 13 декабря в 12:00, к сожалению, невозможен; стандартное время заезда — с 14:00, так как уборка после выезда ещё не завершена.
- **a1-22** (early_checkin · decline · ar) — YZ: لن يكون تسجيل الدخول المبكر ممكنًا يوم 15 ديسمبر في الساعة 11:00؛ وقت تسجيل الدخول المعتاد هو 15:00.
- **a1-23** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 17 Aralık günü saat 14:00’e kadar geç çıkış maalesef mümkün olmayacak, standart çıkış saati 11:00’dir; aynı gün yeni misafir giriş yapacağı için konutun temizlenmesi gerekmektedir.
- **a1-24** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 19 December is not possible, so check-out will need to be by 11:00. On the same day a new guest arrives and the apartment must be ready in time.
- **a1-25** (late_checkout · decline · de) — YZ: Ein später Check-out am 21. Dezember ist leider nicht möglich; der Check-out ist bis 10:00 Uhr.
- **a1-26** (late_checkout · decline · fr) — YZ: Un départ tardif à 14:00 ne sera pas possible le 23 décembre ; le départ doit se faire au plus tard à 11:00.
- **a1-27** (late_checkout · decline · es · gerekçe next_guest) — YZ: El 26 de diciembre no es posible una salida tardía; la salida es hasta las 12:00, ya que ese mismo día llega un nuevo huésped.
- **a1-28** (late_checkout · decline · ru · gerekçe cleaning) — YZ: К сожалению, поздний выезд 28 декабря в 14:00 невозможен, выезд — до 12:00. Квартира будет убираться после вашего выезда.
- **a1-29** (late_checkout · decline · ar) — YZ: للأسف لن يكون تسجيل الخروج المتأخر ممكنًا يوم 30 ديسمبر؛ وقت تسجيل الخروج هو الساعة 11:00، وليس الساعة 13:00.
- **a1-30** (early_checkin · decline · en) — YZ: Early check-in on 31 December at 08:00 is not possible; your check-in will be from 15:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `52b6972`

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
| gpt-5.1-2025-11-13 | 30 | 20019 | 0 | 1693 | 0 |
| gpt-6-luna | 30 | 38966 | 35578 | 5070 | 2635 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `52b6972`

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
