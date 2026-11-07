# Karar mesajı (yapay zekâ + kod + bekçi) — gpt-6-luna (2026-10-07)

Durum: **GEÇERLİ** · set `evals/decision-text-acc1.json` · satır 30/30 · yazıcı istem kimliği `6920f683d5ad`

| ölçü | değer |
|---|---|
| yapay zekâ metni kullanıldı | 28/30 (93%) |
| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | 28/28 (100%) |
| 🚨 onayda karar saati metinde | 13/13 (100%) |
| gün adlandırıldı | 28/28 (100%) |
| misafirin dili (kodun kesin tespiti olanlarda) | 26/26 (100%) |
| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | 0/28 (0%) |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 7/10 (70%) |
| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | 0/5 (0%) |
| gecikme p50 / p95 (yazıcı + bekçi) | 2.4 sn / 3.9 sn |
| maliyet (liste fiyatı) | $0.0367 |

## Şablona düşüş nedenleri

- check_failed (money_unknown, fee_missing): 2

## Metinler

- **a1-01** (early_checkin · approve · tr) — YZ: 6 Kasım günü saat 12:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti ₺300. Anahtar kutusu kapının solunda.
- **a1-02** (early_checkin · approve · en) — şablon/check_failed: Your early check-in is approved — you can check in on 9 November from 13:00. The early check-in fee is US$25.
- **a1-03** (early_checkin · approve · de) — YZ: Sie können am 12. November ab 12:00 Uhr einchecken. Die Gebühr für den frühen Check-in beträgt 12,50 €. Otoparkta 4 numaralı yeri kullanabilirsiniz.
- **a1-04** (early_checkin · approve · fr) — YZ: Vous pouvez arriver le 14 novembre à 13:00. Les frais d’arrivée anticipée s’élèvent à 20 €.
- **a1-05** (early_checkin · approve · es) — şablon/check_failed: Su entrada anticipada está confirmada: el 17 de noviembre puede entrar a partir de las 13:00. La tarifa por entrada anticipada es de 15 US$.
- **a1-06** (early_checkin · approve · ru) — YZ: Вы можете заселиться 20 ноября с 11:30. Kapı şifresi giriş günü sabah ayrıca gönderilecek.
- **a1-07** (early_checkin · approve · ar) — YZ: يمكنكم تسجيل الدخول يوم 23 نوفمبر ابتداءً من الساعة 12:00، وقد تمت الموافقة على تسجيل الدخول المبكر برسوم قدرها ‏750 TRY.
- **a1-08** (early_checkin · approve · en) — YZ: You can check in early on 26 November at 14:00. The early check-in fee is €30.
- **a1-09** (late_checkout · approve · tr) — YZ: 8 Kasım günü çıkışınızı 13:00’te yapabilirsiniz.
- **a1-10** (late_checkout · approve · de) — YZ: Sie können am 11. November bis 13:00 auschecken.
- **a1-11** (late_checkout · approve · fr) — YZ: Vous pouvez quitter le logement le 15 novembre à 14:00.
- **a1-12** (late_checkout · approve · es) — YZ: Puede hacer el check-out el 19 de noviembre hasta las 14:00.
- **a1-13** (late_checkout · approve · ru) — YZ: Вы можете выехать 22 ноября до 13:00.
- **a1-14** (late_checkout · approve · ar) — YZ: يمكنكم تسجيل الخروج يوم 28 نوفمبر الساعة 13:30.
- **a1-15** (late_checkout · approve · tr) — YZ: 2 Aralık günü saat 12:30'da çıkış yapabilirsiniz.
- **a1-16** (early_checkin · decline · tr · gerekçe previous_guest) — YZ: 4 Aralık günü erken giriş mümkün değil; önceki misafirin çıkışı 13:00 olarak planlandığından giriş saati 15:00.
- **a1-17** (early_checkin · decline · en · gerekçe cleaning) — YZ: Early check-in on 5 December won’t be possible, as the cleaning is still in progress; check-in is from 15:00.
- **a1-18** (early_checkin · decline · de · gerekçe previous_guest) — YZ: Ein früher Check-in am 7. Dezember ist leider nicht möglich, da der vorherige Gast noch auscheckt. Der Check-in ist ab 14:00 möglich.
- **a1-19** (early_checkin · decline · fr · gerekçe cleaning) — YZ: L’arrivée anticipée ne sera pas possible le 9 décembre, car le ménage n’est pas encore terminé. Vous pourrez arriver à partir de 16:00.
- **a1-20** (early_checkin · decline · es · gerekçe previous_guest) — YZ: No será posible realizar el check-in anticipado el 11 de diciembre; el check-in es a partir de las 15:00.
- **a1-21** (early_checkin · decline · ru · gerekçe cleaning) — YZ: К сожалению, заселиться 13 декабря в 12:00 невозможно: уборка после выезда ещё не завершена. Стандартное время заезда — 14:00.
- **a1-22** (early_checkin · decline · ar) — YZ: لن يكون تسجيل الدخول المبكر ممكنًا لكم يوم 15 ديسمبر، ويمكنكم تسجيل الدخول ابتداءً من 15:00.
- **a1-23** (late_checkout · decline · tr · gerekçe next_guest) — YZ: 17 Aralık günü 14:00'te geç çıkış yapmanız mümkün değil; çıkış saati 11:00.
- **a1-24** (late_checkout · decline · en · gerekçe next_guest) — YZ: Unfortunately, late check-out at 15:00 is not possible on 19 December, as a new guest arrives the same day. Check-out is by 11:00.
- **a1-25** (late_checkout · decline · de) — YZ: Ein später Check-out am 21. Dezember ist leider nicht möglich; der Check-out ist bis 10:00 Uhr.
- **a1-26** (late_checkout · decline · fr) — YZ: Le départ tardif n’est pas possible le 23 décembre ; vous devrez quitter le logement à 11:00.
- **a1-27** (late_checkout · decline · es · gerekçe next_guest) — YZ: Lamentablemente, no es posible hacer el check-out más tarde el 26 de diciembre, ya que ese mismo día llega un nuevo huésped. La hora de check-out es hasta las 12:00.
- **a1-28** (late_checkout · decline · ru · gerekçe cleaning) — YZ: К сожалению, выезд 28 декабря в 14:00 невозможен; стандартное время выезда — до 12:00.
- **a1-29** (late_checkout · decline · ar) — YZ: للأسف، لا يمكن تسجيل الخروج المتأخر يوم 30 ديسمبر؛ موعد تسجيل الخروج هو الساعة 11:00.
- **a1-30** (early_checkin · decline · en) — YZ: Unfortunately, early check-in on 31 December is not possible. Check-in is from 15:00.


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c94009b`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| gpt-6-luna | 30 | 20019 | 0 | 1403 | 216 |
| gpt-5.1-2025-11-13 | 28 | 36039 | 29952 | 2269 | 0 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c94009b`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` (öğe + yabancı dil örneği `ead9babb34d8`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
