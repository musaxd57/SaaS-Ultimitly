# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-6-luna (2026-10-09)

Durum: **GEÇERLİ** · set `evals/decision-text-dev.json` · satır 40/40 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 33/40 (83%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 33/33 (100%) |
| 🚨 onayda karar saati metinde | 15/15 (100%) |
| gün adlandırıldı | 33/33 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 32/32 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/33 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 5/11 (45%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/7 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 4.2 sn / 12.0 sn |
| maliyet (liste fiyatı) | $0.0072 |

## Şablona düşüş nedenleri

- model_failed: 7

## Metinler

- **d-01** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 13:00'te giriş yapabilirsiniz.
- **d-02** (early_checkin · approve · en) — YZ: You can check in early on 14 November at 14:00.
- **d-03** (early_checkin · approve · de) — YZ: Sie können am 14. November ab 13:30 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 20 €.
- **d-04** (early_checkin · approve · fr) — YZ: Vous pouvez arriver le 14 novembre à 12:00. Les frais d’arrivée anticipée s’élèvent à 15 €. Anahtar kutusu kapının solunda.
- **d-05** (early_checkin · approve · es) — YZ: Puede hacer el check-in el 14 de noviembre a las 13:00.
- **d-06** (early_checkin · approve · ru) — YZ: Вы можете заселиться 14 ноября с 12:30. Стоимость раннего заезда — 500 TRY.
- **d-07** (early_checkin · approve · ar) — YZ: يمكنكم تسجيل الدخول مبكرًا يوم 14 نوفمبر الساعة 13:00.
- **d-08** (early_checkin · approve · tr) — YZ: 14 Kasım günü saat 11:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti ₺750. Lütfen girişte kimliğinizi hazır bulundurun.
- **d-09** (early_checkin · approve · en) — YZ: You can check in early on 14 November at 12:00. The early check-in fee is €12.50.
- **d-10** (early_checkin · approve · de) — YZ: Sie können am 14. November ab 14:00 einchecken.
- **d-11** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 14 Kasım günü erken giriş mümkün değil; çıkış temizliği henüz tamamlanmadığı için giriş saatiniz 15:00 olacaktır.
- **d-12** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in won’t be possible on 14 November because cleaning is still in progress; check-in is from 15:00.
- **d-13** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich; Sie können ab 15:00 Uhr einchecken, da die Reinigung noch nicht abgeschlossen ist.
- **d-14** (early_checkin · decline · fr · gerekçe cleaning) — YZ: L’arrivée anticipée n’est pas possible le 14 novembre, car le nettoyage n’est pas encore terminé. Vous pourrez arriver à partir de 15:00.
- **d-15** (early_checkin · decline · es) — YZ: No será posible realizar la entrada anticipada el 14 de noviembre; la entrada es a partir de las 15:00.
- **d-16** (early_checkin · decline · ru · gerekçe previous_guest) — YZ: Ранний заезд 14 ноября невозможен, поскольку уборка еще не завершена; заселение возможно с 15:00.
- **d-17** (early_checkin · decline · ar · gerekçe cleaning) — YZ: لن يكون تسجيل الدخول المبكر ممكنًا يوم 14 نوفمبر لأن تنظيف المغادرة لم ينتهِ بعد. يبدأ تسجيل الدخول الساعة 15:00.
- **d-18** (early_checkin · decline · tr) — YZ: 14 Kasım günü 13:00'te erken giriş yapmanız mümkün değil; standart giriş saati 15:00.
- **d-19** (early_checkin · decline · en) — YZ: Early check-in on 14 November isn’t possible; check-in is from 15:00.
- **d-20** (early_checkin · decline · de) — YZ: Ein früher Check-in am 14. November ist leider nicht möglich; der Check-in ist ab 15:00 Uhr möglich.
- **d-21** (late_checkout · approve · tr) — YZ: 18 Kasım günü saat 13:00'te çıkış yapabilirsiniz.
- **d-22** (late_checkout · approve · en) — YZ: Your late check-out is approved: you may check out at 12:00 on 18 November.
- **d-23** (late_checkout · approve · de) — YZ: Sie können am 18. November bis 12:30 auschecken.
- **d-24** (late_checkout · approve · fr) — şablon/model_failed: Votre départ tardif est confirmé : vous pouvez libérer le logement jusqu'à 14:00 le 18 novembre.
- **d-25** (late_checkout · approve · es) — YZ: Puede hacer el check-out el 18 de noviembre hasta las 12:00.
- **d-26** (late_checkout · approve · ru) — şablon/model_failed: Поздний выезд подтверждён: 18 ноября вы можете выехать до 13:00.
- **d-27** (late_checkout · approve · ar) — şablon/model_failed: تمت الموافقة على تسجيل الخروج المتأخر: موعد خروجكم يوم 18 نوفمبر هو الساعة 12:00.
- **d-28** (late_checkout · approve · tr) — şablon/model_failed: Geç çıkış talebiniz onaylandı: 18 Kasım günü çıkış saatiniz 16:00.
- **d-29** (late_checkout · decline · tr · gerekçe next_guest) — şablon/model_failed: Maalesef 18 Kasım günü geç çıkış mümkün olmayacak; çıkış saati 11:00.
- **d-30** (late_checkout · decline · en · gerekçe next_guest) — şablon/model_failed: Unfortunately, late check-out won't be possible on 18 November; check-out is by 11:00.
- **d-31** (late_checkout · decline · de · gerekçe next_guest) — şablon/model_failed: Leider ist ein später Check-out am 18. November nicht möglich; der Check-out ist bis 11:00 Uhr.
- **d-32** (late_checkout · decline · fr) — YZ: Le départ tardif ne sera pas possible le 18 novembre ; le départ doit avoir lieu au plus tard à 11:00.
- **d-33** (late_checkout · decline · es · gerekçe next_guest) — YZ: No será posible realizar el check-out tardío el 18 de noviembre; la salida debe ser a las 11:00, ya que ese mismo día llega un nuevo huésped.
- **d-34** (late_checkout · decline · ru · gerekçe next_guest) — YZ: Поздний выезд 18 ноября невозможен; выезд — до 11:00.
- **d-35** (late_checkout · decline · ar · gerekçe next_guest) — YZ: للأسف، لا يمكن تسجيل الخروج المتأخر يوم 18 نوفمبر، إذ يصل ضيف جديد في اليوم نفسه؛ موعد تسجيل الخروج هو الساعة 11:00.
- **d-36** (late_checkout · decline · tr) — YZ: 18 Kasım günü geç çıkış yapmanız mümkün değil; çıkış saati 11:00.
- **d-37** (late_checkout · decline · en) — YZ: Late check-out on 18 November isn’t possible; please check out by 11:00.
- **d-38** (early_checkin · approve · en) — YZ: Your early check-in is approved; you can check in on 14 November at 14:00.
- **d-39** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 18 Kasım günü geç çıkış mümkün değildir; aynı gün yeni bir misafir giriş yapacağı için çıkış saatiniz 10:00’dur.
- **d-40** (early_checkin · decline · fr · gerekçe previous_guest) — YZ: L’arrivée anticipée ne sera pas possible le 14 novembre, car le ménage n’est pas encore terminé ; l’arrivée se fait à partir de 16:00.


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
| gpt-6-luna | 66 | 63848 | 39878 | 8877 | 4818 |

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
