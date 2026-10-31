# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-5.1 (2026-10-07)

Durum: **GEÇERLİ** · set `evals/decision-text-acc1.json` · satır 30/30 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 28/30 (93%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 28/28 (100%) |
| 🚨 onayda karar saati metinde | 13/13 (100%) |
| gün adlandırıldı | 28/28 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 28/28 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/28 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 9/10 (90%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/5 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 2.3 sn / 3.5 sn |
| maliyet (liste fiyatı) | $0.0776 |

## Şablona düşüş nedenleri

- check_failed (money_unknown, fee_missing): 2

## Metinler

- **a1-01** (early_checkin · approve · tr) — YZ: Erken giriş talebiniz onaylandı; 6 Kasım günü saat 12:00 itibarıyla giriş yapabilirsiniz. Bu erken giriş için ücret ₺300 olacaktır. Anahtar kutusu kapının solunda.
- **a1-02** (early_checkin · approve · en) — şablon/check_failed: Your early check-in is approved — you can check in on 9 November from 13:00. The early check-in fee is US$25.
- **a1-03** (early_checkin · approve · de) — YZ: Ihr früher Check-in ist bestätigt – Sie können am 12. November ab 12:00 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 12,50 €. Otoparkta 4 numaralı yeri kullanabilirsiniz.
- **a1-04** (early_checkin · approve · fr) — YZ: Votre arrivée anticipée est confirmée : vous pourrez vous installer le 14 novembre à partir de 13:00. Les frais pour cette arrivée anticipée sont de 20 €.
- **a1-05** (early_checkin · approve · es) — şablon/check_failed: Su entrada anticipada está confirmada: el 17 de noviembre puede entrar a partir de las 13:00. La tarifa por entrada anticipada es de 15 US$.
- **a1-06** (early_checkin · approve · ru) — YZ: Ранний заезд одобрен: 20 ноября вы можете заселиться с 11:30. Стандартное время заезда остаётся 14:00. Kapı şifresi giriş günü sabah ayrıca gönderilecek.
- **a1-07** (early_checkin · approve · ar) — YZ: تمت الموافقة على تسجيل الدخول المبكر؛ يمكنكم تسجيل الدخول يوم 23 نوفمبر الساعة 12:00، مع رسوم قدرها ‏750 TRY.
- **a1-08** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 26 November from 14:00. The early check-in fee is €30.
- **a1-09** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 8 Kasım günü çıkış saatiniz 13:00 olarak ayarlanmıştır.
- **a1-10** (late_checkout · approve · de) — YZ: Ihr später Check-out ist bestätigt, Sie können am 11. November bis 13:00 auschecken; die reguläre Check-out-Zeit ist 10:00.
- **a1-11** (late_checkout · approve · fr) — YZ: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu’à 14:00 le 15 novembre au lieu de 11:00.
- **a1-12** (late_checkout · approve · es) — YZ: Su check-out tardío está confirmado: el 19 de noviembre puede dejar el alojamiento hasta las 14:00. Lamentablemente no es posible ampliarlo hasta las 16:00, ya que ese mismo día llega un nuevo huésped y necesitamos tiempo para la limpieza.
- **a1-13** (late_checkout · approve · ru) — YZ: Поздний выезд одобрен: 22 ноября вы можете выехать до 13:00 вместо стандартных 12:00.
- **a1-14** (late_checkout · approve · ar) — YZ: تمت الموافقة على تسجيل الخروج المتأخر، ويمكنكم المغادرة يوم 28 نوفمبر في الساعة 13:30 بدلًا من الساعة 11:00 المعتادة.
- **a1-15** (late_checkout · approve · tr) — YZ: Geç çıkış talebiniz onaylandı; 2 Aralık günü 12:30’da çıkış yapabilirsiniz. Standart çıkış saatimiz 11:00’dir.
- **a1-16** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 4 Aralık günü 11:00 için erken giriş maalesef mümkün değil; standart giriş saatiniz 15:00 olacaktır. Önceki misafirin çıkışı sonrasında temizlik devam ettiği için erken giriş veremiyoruz.
- **a1-17** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in at 12:00 on 5 December is not possible, as the cleaning is still in progress; your check-in time is from 15:00.
- **a1-18** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 7. Dezember um 10:00 ist leider nicht möglich, da die Wohnung nach dem Auszug des vorherigen Gastes noch gereinigt wird. Sie können am 7. Dezember ab 14:00 einchecken.
- **a1-19** (early_checkin · decline · fr · gerekçe cleaning) — YZ: Votre arrivée anticipée ne sera pas possible le 9 décembre, car le logement est encore en cours de préparation ; l’arrivée se fait à partir de 16:00.
- **a1-20** (early_checkin · decline · es · gerekçe previous_guest) — YZ: El 11 de diciembre no será posible la entrada anticipada a las 09:30; la entrada es a partir de las 15:00, ya que ese mismo día aún se estará realizando la salida del huésped anterior.
- **a1-21** (early_checkin · decline · ru · gerekçe cleaning) — YZ: Ранний заезд 13 декабря в 12:00, к сожалению, невозможен, так как уборка после предыдущего выезда еще не завершена; сможете заселиться с 14:00.
- **a1-22** (early_checkin · decline · ar) — YZ: لن يكون تسجيل الدخول المبكر ممكنًا يوم 15 ديسمبر؛ يبدأ تسجيل الدخول من الساعة 15:00.
- **a1-23** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 17 Aralık günü geç çıkış talebinizi maalesef karşılayamıyoruz; çıkış saatiniz 11:00 olacaktır. Aynı gün yeni misafir giriş yapacağı için dairenin temizlenmesi gerekmektedir.
- **a1-24** (late_checkout · decline · en · gerekçe next_guest) — YZ: Late check-out on 19 December is not possible, check-out is by 11:00. The apartment needs to be ready for a new guest arriving the same day.
- **a1-25** (late_checkout · decline · de) — YZ: Ein später Check-out am 21. Dezember ist leider nicht möglich; der Check-out ist bis 10:00 Uhr.
- **a1-26** (late_checkout · decline · fr) — YZ: Un départ tardif ne sera pas possible le 23 décembre à 14:00 ; le départ doit se faire au plus tard à 11:00.
- **a1-27** (late_checkout · decline · es · gerekçe next_guest) — YZ: El 26 de diciembre no será posible la salida tardía; la salida es hasta las 12:00, ya que ese mismo día llega un nuevo huésped.
- **a1-28** (late_checkout · decline · ru · gerekçe cleaning) — YZ: К сожалению, поздний выезд 28 декабря невозможен; вам необходимо освободить квартиру до 12:00, так как в это время еще идет подготовка к уборке.
- **a1-29** (late_checkout · decline · ar) — YZ: لن يكون تسجيل الخروج المتأخر ممكنًا يوم 30 ديسمبر، لذا يجب تسجيل الخروج بحلول الساعة 11:00.
- **a1-30** (early_checkin · decline · en) — YZ: Early check-in on 31 December at 08:00 is not possible; your check-in will be from 15:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c94009b`

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
| gpt-5.1-2025-11-13 | 58 | 56358 | 28672 | 3936 | 0 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c94009b`

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
