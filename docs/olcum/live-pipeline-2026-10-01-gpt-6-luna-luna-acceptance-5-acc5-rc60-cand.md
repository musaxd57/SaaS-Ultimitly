# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-01)

Durum: **GEÇERLİ** · commit `08c21c6` · satır 44/44 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/luna-acceptance-5.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · düşünme: `OPENAI_REASONING_EFFORT=none`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 21/28 (75%) |
| doğru olgu MİSAFİRE GİDEN metinde | 20/28 (71%) |
| doğru olgu modelin taslağında (gitmese de) | 27/28 (96%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/21 (0%) |
| dil uyumu misafire giden (TR dışı) | 14/14 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 1 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/16 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 1 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/44 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 6.3 sn / 8.3 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2429**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 46 | 9872 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 102 | 199604 | 115200 | 9553 | 0 |
| gpt-6-luna | 44 | 896529 | 740503 | 8523 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| fix_report_recipe | yes | 6 | 2 | 0 | 5/8 | 0 | 0 |
| mixed_norecipe_question | yes | 4 | 1 | 0 | 4/5 | 1 | 0 |
| fix_hazard | no | 0 | 4 | 2 | 0/0 | 0 | 0 |
| fix_info_only | no | 0 | 5 | 0 | 0/0 | 0 | 0 |
| regression | yes | 4 | 0 | 0 | 4/4 | 0 | 0 |
| fix_question_recipe | yes | 3 | 2 | 0 | 3/5 | 0 | 0 |
| fix_no_item | no | 0 | 4 | 0 | 0/0 | 0 | 0 |
| mixed_recipe_question | yes | 3 | 0 | 0 | 3/3 | 0 | 0 |
| fix_generic_title | yes | 1 | 2 | 0 | 1/3 | 0 | 0 |
| nonfault_complaint | no | 0 | 3 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · items_held · reply_output_veto: 9
- low_confidence_or_risky · items_held · items_nothing_answered: 8
- escalated_to_human · escalated_to_human · model_intent: 2
- low_confidence_or_risky · low_confidence_or_risky · model_risk_label: 2
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1
- low_confidence_or_risky · items_held · model_intent: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **k5-01** (fix_report_recipe/tr): "Merhaba Alex,\n\nKumandadaki SOURCE tuşuna basıp listeden HDMI 2’yi seçer misiniz? TV kutusu bu girişe bağlıdır. Görüntü hâlâ gelmezse TV kutusunun fişini çekin, 30 saniye bekleyip yeniden takın ve 2 dakika bekleyin.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-02** (mixed_norecipe_question/en): "Hello Alex,\n\nThe nearest pharmacy is Kekik Eczanesi, about 300 metres away on Cumhuriyet Caddesi. It is open until 19:30 on weekdays and 14:00 on Saturdays.\n\n(This reply was prepared by an automated assistant.)"
- **k5-05** (regression/tr): "Merhaba Alex,\n\nBinanın -1. katındaki kapalı otoparkta size ayrılmış P-14 numaralı park yeri var. Araç kapısını giriş dolabındaki anahtarlıkta asılı kumandayla açabilirsiniz; araç yüksekliği en fazla 2,1 m olmalı.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-06** (fix_question_recipe/fr): "Bonjour Alex,\n\nAppuyez sur la touche SOURCE de la télécommande, puis sélectionnez HDMI 2. Si l’image ne revient pas, débranchez le boîtier TV, attendez 30 secondes, rebranchez-le et patientez 2 minutes.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **k5-08** (mixed_recipe_question/tr): "Merhaba Alex,\n\nKumandadaki SOURCE tuşuna basıp listeden HDMI 2'yi seçin; TV kutusu bu girişe bağlıdır. Otoparkta size ayrılan yer P-14 numaralıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-09** (fix_generic_title/de): "Hallo Alex,\n\nStellen Sie den Drehschalter auf „Drain/Spin“ und drücken Sie „START/PAUSE“. Das Abpumpen dauert etwa 12 Minuten. Stellen Sie den Drehschalter anschließend auf „OFF“ und warten Sie 2 Minuten, bis sich die Tür entriegelt.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k5-11** (fix_report_recipe/ar): "مرحباً Alex،\n\nإذا كانت شاشة الريموت فارغة، حرّكوا الغطاء الخلفي واستبدلوا بطاريتي AAA؛ ستجدون بطاريات احتياطية في الدرج الأيسر لوحدة التلفاز.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **k5-16** (regression/en): "Hello Alex,\n\nCheck-out is at 11:00. You can simply pull the door closed when you leave; it locks automatically.\n\n(This reply was prepared by an automated assistant.)"
- **k5-19** (mixed_norecipe_question/de): "Hallo Alex,\n\nBei der Kaffeemaschine kann ich anhand der vorliegenden Informationen keine passende Lösung nennen. Den Müll können Sie in den grauen Container links vom Hauseingang werfen. Bitte stellen Sie die Müllbeutel vor 21:30 Uhr hinaus; die Abholung erfolgt jeden Abend um 21:30 Uhr.\n\n(Diese Antwort wurde von einem"
- **k5-23** (mixed_recipe_question/ru): "Здравствуйте, Alex!\n\nЧтобы кондиционер подавал холодный воздух, нажмите на пульте MODE и выберите значок снежинки (COOL), затем установите температуру 22°C. Холодный воздух появится через 3–5 минут. Мусор можно вынести к серому контейнеру слева от входа в здание, а пластик, стекло и бумагу — в синий контейнер рядом; пр"
- **k5-25** (fix_question_recipe/de): "Hallo Alex,\n\nSchieben Sie die Rückseite der Fernbedienung auf und tauschen Sie die beiden AAA-Batterien aus. Ersatzbatterien finden Sie in der linken Schublade des TV-Schranks.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k5-27** (fix_report_recipe/fr): "Bonjour Alex,\n\nLe voyant WAN clignote en orange : vérifiez que le câble gris à l’arrière du modem est bien enfoncé dans la prise Internet murale jusqu’à entendre un clic. Redémarrez ensuite le modem avec le bouton ON/OFF à l’arrière, attendez 30 secondes, puis rallumez-le. Les voyants peuvent mettre 2 à 3 minutes à dev"
- **k5-28** (regression/tr): "Merhaba Alex,\n\nÇöpleri bina girişinin solundaki gri konteynere, geri dönüşümü yanındaki mavi kutuya bırakabilirsiniz. Belediye çöpleri her akşam 21:30'da topladığı için çöpleri bu saatten önce bırakmanız gerekir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-29** (mixed_norecipe_question/fr): "Bonjour Alex,\n\nVotre place de parking est au niveau -1, dans le parking couvert, à l’emplacement P-14. L’entrée pour les voitures s’ouvre avec la télécommande accrochée au porte-clés dans le placard de l’entrée. La hauteur maximale du véhicule est de 2,1 m.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **k5-31** (fix_report_recipe/tr): "Modemin arkasındaki gri kablonun duvardaki internet girişine tık sesi gelene kadar oturduğundan emin olun. Ardından modemin arkasındaki ON/OFF düğmesiyle kapatıp 30 saniye bekleyin ve yeniden açın; ışıkların yeşile dönmesi 2–3 dakika sürebilir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-36** (fix_report_recipe/en): "Hello Alex,\n\nPress MODE on the remote and select the snowflake (COOL) symbol, then set the temperature to 22°C. If the balcony door is open, close it; the air should cool within 3–5 minutes.\n\n(This reply was prepared by an automated assistant.)"
- **k5-37** (mixed_norecipe_question/tr): "Merhaba Alex,\n\nEn yakın eczane Kekik Eczanesi; hafta içi 19:30’a, cumartesi 14:00’e kadar açık. Pazar günleri ve geceleri nöbetçi eczane listesi eczanenin kapısında asılıdır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k5-39** (fix_report_recipe/de): "Hallo Alex,\n\nDie rote Kontrollleuchte leuchtet nicht, wenn die Batterie leer ist. Öffnen Sie die Rückseite der Fernbedienung mit einer Münze und ersetzen Sie die CR2032-Batterie; eine Ersatzbatterie befindet sich in der blauen Box im Eingangsbereich.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k5-41** (mixed_recipe_question/ar): "إذا كان ضوء WAN يومض باللون البرتقالي، فتأكدوا من تثبيت الكابل الرمادي خلف المودم في مدخل الإنترنت بالحائط حتى تسمعوا صوت نقرة، ثم أوقفوا المودم من زر ON/OFF وانتظروا 30 ثانية قبل تشغيله مجدداً. قد يستغرق تحوّل الأضواء إلى الأخضر من دقيقتين إلى ثلاث دقائق. مكان سيارتكم هو الموقف المغلق أسفل المبنى، في الطابق -1، في الم"
- **k5-42** (fix_question_recipe/tr): "Merhaba Alex,\n\nKumandanın ışığı yanmıyorsa pili bitmiş olabilir. Arka kapağını bozuk parayla açıp CR2032 pili değiştirebilirsiniz; yedek pil giriş dolabındaki mavi kutuda. Kumanda yine çalışmazsa kapının sağındaki direkteki çağrı düğmesine basın; site görevlisi 07:00–23:00 arasında kapıyı açar.\n\n(Bu yanıt otomatik asis"
- **k5-44** (regression/es): "Hola Alex,\n\nSí, la farmacia más cercana es Kekik Eczanesi, a unos 300 m, en Cumhuriyet Caddesi. Entre semana abre de 08:30 a 19:30.\n\n(This reply was prepared by an automated assistant.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `08c21c6`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | — |
| Üslup özeti | `gpt-6-luna` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` · anlama `7110591352fb` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
