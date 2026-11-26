# Canlı hat — misafire giden cevap — gpt-5.1 (2026-10-01)

Durum: **GEÇERLİ** · commit `61ddf1a` · satır 36/36 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/luna-acceptance-4.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 14/22 (64%) |
| doğru olgu MİSAFİRE GİDEN metinde | 14/22 (64%) |
| doğru olgu modelin taslağında (gitmese de) | 22/22 (100%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/15 (0%) |
| dil uyumu misafire giden (TR dışı) | 8/8 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 1 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 1/14 (7%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/36 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 6.1 sn / 9.2 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.4495**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 38 | 6001 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 119 | 856456 | 685824 | 15032 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| fix_report_safe | yes | 4 | 4 | 0 | 4/8 | 0 | 0 |
| nonfault_complaint | no | 0 | 5 | 0 | 0/0 | 0 | 0 |
| fix_report_hazard | no | 0 | 5 | 2 | 0/0 | 0 | 0 |
| regression | yes | 6 | 0 | 0 | 6/6 | 0 | 0 |
| fix_question_safe | yes | 1 | 3 | 0 | 1/4 | 0 | 0 |
| fix_report_nokb | no | 1 | 3 | 0 | 0/0 | 0 | 0 |
| complaint_mixed | yes | 3 | 1 | 0 | 3/4 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · items_fix_unverified: 5
- low_confidence_or_risky · items_held · reply_output_veto: 5
- low_confidence_or_risky · items_held · items_nothing_answered: 3
- low_confidence_or_risky · handoff_notice · reply_output_veto: 2
- low_confidence_or_risky · low_confidence_or_risky · model_risk_label: 2
- escalated_to_human · escalated_to_human · model_intent: 2
- low_confidence_or_risky · low_confidence_or_risky · items_nothing_answered: 1
- low_confidence_or_risky · low_confidence_or_risky · lexical_risk: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **k4-04** (regression/en): "Hello Alex,\n\nYou can park your car in the building’s parking garage on level -1; your dedicated space is number 27. The garage door opens with the black remote on the keychain.\n\n(This reply was prepared by an automated assistant.)"
- **k4-07** (complaint_mixed/tr): "Merhaba Alex,\n\nWi-Fi ağ adı Mercan_Loft_5G, şifre ise Deniz.Yildizi47. Yatak odasında sinyal zayıfsa Mercan_Loft_2G ağına de aynı şifreyle bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k4-12** (regression/tr): "Merhaba Alex,\n\nÇöp poşetlerini gri konteynere, plastik, cam ve kâğıt atıklarını yanındaki mavi geri dönüşüm konteynerine atabilirsiniz. Konteynerler sokağın köşesinde, Defne Fırını'nın hemen önünde bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k4-19** (regression/es): "Hola Alex,\n\nLa dirección es Yelkovan Sokak No: 9, Karşıyaka, Esmirna. La forma más sencilla de llegar al aeropuerto desde el apartamento es tomando el autobús H24 desde la parada frente al edificio (aproximadamente 50 minutos), o en taxi, que suele tardar unos 35 minutos.\n\n(This reply was prepared by an automated assis"
- **k4-20** (fix_report_safe/ru): "Здравствуйте, Alex!\n\nПароль для сети Wi‑Fi: Mercan_Loft_5G — Deniz.Yildizi47 (буквы D и Y заглавные, точку обязательно указывать). Пожалуйста, введите его ещё раз, полностью совпадая с регистром. Если телефон не видит сеть Mercan_Loft_5G, выберите Mercan_Loft_2G и используйте тот же пароль.\n\n(Этот ответ подготовлен авт"
- **k4-21** (complaint_mixed/de): "Hallo Alex,\n\nDie bequemste Verbindung ist der Flughafenbus \"H24\" direkt von der Haltestelle vor dem Haus zum Flughafen, die Fahrt dauert etwa 50 Minuten. Alternativ können Sie ein Taxi nehmen, die Fahrtzeit liegt ungefähr bei 35 Minuten.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k4-26** (regression/tr): "Merhaba Alex,\n\nWi-Fi ağımızın adı \"Mercan_Loft_5G\", şifresi ise Deniz.Yildizi47. Yatak odasında sinyal zayıf olursa \"Mercan_Loft_2G\" ağına aynı şifreyle bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k4-27** (fix_report_safe/en): "You can try holding the big button on the garage remote down for about 3 seconds while staying within about 10 meters of the gate. If the small light on the remote still does not come on, the battery is likely empty: there is a spare CR2032 battery in the right drawer of the TV unit. You can open the back cover of the "
- **k4-29** (complaint_mixed/tr): "Merhaba Alex,\n\nYakınınızda Lavanta Eczanesi var; daireden yaklaşık 200 metre ileride, Liman Caddesi üzerinde bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k4-30** (fix_report_safe/ar): "مرحباً Alex،\n\nفي بعض الهواتف لا تظهر شبكة Mercan_Loft_5G. يمكنكم بدلاً من ذلك اختيار شبكة Mercan_Loft_2G، وكلمة المرور نفسها: Deniz.Yildizi47 (مع مراعاة الأحرف الكبيرة والصغيرة والنقطة بينهما).\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **k4-31** (fix_report_nokb/es): "Hola Alex,\n\nEntiendo lo molesto que es que el internet no funcione. Según los datos que tengo, la red Wi‑Fi se llama \"Mercan_Loft_5G\" y la contraseña es \"Deniz.Yildizi47\"; por favor, pruebe a desconectarse y volver a conectarse a esta red con esa clave.\n\n(This reply was prepared by an automated assistant.)"
- **k4-33** (fix_question_safe/tr): "Merhaba Alex,\n\nKumandanın büyük tuşuna 3 saniye basılı tutup kapıya 10 metreden fazla yaklaşmadan yeniden dener misiniz. Tuşa bastığınızda kumandanın küçük ışığı yanmıyorsa pili bitmiş olabilir; yedek CR2032 pil TV ünitesinin sağ çekmecesinde, kumandanın arka kapağını bozuk parayla açıp pili değiştirebilirsiniz.\n\n(Bu y"
- **k4-34** (regression/fr): "Bonjour Alex,\n\nOui, il y a une pharmacie toute proche. « Lavanta Eczanesi » se trouve à environ 200 mètres, sur la rue Liman Caddesi.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **k4-35** (fix_report_safe/tr): "Wi-Fi’ye bağlı görünüp sayfalar açılmıyorsa modemi yeniden başlatmayı deneyebilirsiniz. Modem, TV ünitesinin alt rafındaki beyaz kutu; arkasındaki \"ON/OFF\" düğmesine basarak kapatıp 30 saniye bekleyin, sonra tekrar açın ve 2-3 dakika içinde öndeki \"WAN\" ışığı yeşil yandığında internet geri gelmiş olmalıdır.\n\n(Bu yanıt "
- **k4-36** (regression/tr): "Çıkış saati 11:00. Anahtarı bırakmanıza gerek yok; çıkarken kapıyı çekmeniz yeterli.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `61ddf1a`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | — |
| Üslup özeti | `gpt-5.1` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` · anlama `7110591352fb` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
