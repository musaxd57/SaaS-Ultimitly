# Canlı hat — misafire giden cevap — gpt-6-luna (2026-09-30)

Durum: **GEÇERLİ** · commit `1844fb8` · satır 24/24 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/code-greeting.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=(boş)` · kod selamı: `AI_CODE_GREETING_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=none`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 22/24 (92%) |
| doğru olgu MİSAFİRE GİDEN metinde | 22/24 (92%) |
| doğru olgu modelin taslağında (gitmese de) | 24/24 (100%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/22 (0%) |
| dil uyumu misafire giden (TR dışı) | 12/12 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| düşen / hata | 0/24 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 7.6 sn / 9.4 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0835**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 23 | 2260 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 66 | 79282 | 61184 | 4239 | 0 |
| gpt-6-luna | 24 | 453340 | 402504 | 3459 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu |
|---|---|---|---|---|
| grounded | yes | 22 | 2 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · context_injection: 2

## Kod selamı (K17) — `AI_CODE_GREETING_ENABLED=(boş)`

Beklenti anahtar AÇIK içindir (adlı / adsız / selam yok); kapalı kolda 'beklenti' sütunu yalnız karşılaştırma içindir.

Beklenti tuttu: 3/24 · soyad / tam ad metinde: 2 · ad ilk satırdan sonra (gövdede): 0 · doğru olgu: 24/24 · panelde tam ad korunuyor: 24/24

| senaryo | dil | ton | giden | ilk satır | beklenti tuttu | soyad metinde | ad gövdede | olgu |
|---|---|---|---|---|---|---|---|---|
| k-tr-ayse | tr | warm | evet | "Merhaba Ayşe, Wi-Fi ağının adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✖ | hayır | hayır | ✔ |
| k-en-john | en | warm | evet | "Hi, the Wi-Fi network is “Lale-5G” and the password is “Lale2025!”. If the signal is weak in the bedroom, you can connect to “Lale-2G” using the same password." | ✖ | hayır | hayır | ✔ |
| k-de-anna | de | warm | evet | "Hallo Anna, das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet „Lale2025!“. Wenn das Signal im Schlafzimmer schwach ist, können Sie sich mit demselben Passwort mit dem Netzwerk „Lale-2G“ verbinden." | ✖ | hayır | hayır | ✔ |
| k-fr-marie | fr | warm | evet | "Bonjour, le code de la boîte à clés est 4721." | ✖ | hayır | hayır | ✔ |
| k-es-carlos | es | warm | evet | "Hola, el check-in es a las 15:00." | ✖ | hayır | hayır | ✔ |
| k-ru-ivan | ru | warm | evet | "Здравствуйте. Пароль от Wi-Fi: Lale2025! Если в спальне слабый сигнал, подключитесь к сети Lale-2G, используя тот же пароль." | ✖ | hayır | hayır | ✔ |
| k-ar-mohammed | ar | warm | evet | "مرحباً، كلمة مرور شبكة Wi-Fi هي Lale2025!. وإذا كانت الإشارة ضعيفة في غرفة النوم، يمكنكم الاتصال بشبكة Lale-2G باستخدام كلمة المرور نفسها." | ✖ | hayır | hayır | ✔ |
| k-tr-iki-ad | tr | warm | evet | "Anahtar kutusunun şifresi 4721." | ✖ | hayır | hayır | ✔ |
| k-en-tireli | en | warm | evet | "Checkout is at 11:00." | ✖ | hayır | hayır | ✔ |
| k-tr-ad-alani-yok | tr | warm | evet | "Merhaba Ayşe, Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✖ | EVET | hayır | ✔ |
| k-en-yer-tutucu | en | warm | evet | "Check-in starts at 15:00." | ✖ | hayır | hayır | ✔ |
| k-tr-takvim | tr | warm | evet | "Anahtar kutusunun şifresi 4721." | ✖ | hayır | hayır | ✔ |
| k-tr-resmi | tr | formal | evet | "Sayın Ayşe Yılmaz, anahtar kutusunun şifresi 4721’dir. Saygılarımızla." | ✖ | EVET | hayır | ✔ |
| k-tr-kisa | tr | short | evet | "Ağ adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✔ | hayır | hayır | ✔ |
| k-en-luks | en | luxury | evet | "The check-out time is 11:00. When you leave, please return the key to the same key box and scramble the numbers." | ✖ | hayır | hayır | ✔ |
| k-tr-ikinci-tur | tr | warm | evet | "Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✔ | hayır | hayır | ✔ |
| k-en-ikinci-tur | en | warm | evet | "The key box code is 4721." | ✔ | hayır | hayır | ✔ |
| k-kotu-talimat | en | warm | hayır | "Hi, the Wi-Fi network is “Lale-5G” and the password is “Lale2025!”. If the signal is weak in the bedroom, you can connect to “Lale-2G” with the same password." | ✖ | hayır | hayır | ✔ |
| k-kotu-etiket | tr | warm | hayır | "Merhaba, giriş saati 15:00." | ✖ | hayır | hayır | ✔ |
| k-kotu-html | en | warm | evet | "Check-out is at 11:00." | ✖ | hayır | hayır | ✔ |
| k-kotu-emoji | tr | warm | evet | "Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✖ | hayır | hayır | ✔ |
| k-kotu-uzun | tr | warm | evet | "Anahtar kutusunun kodu 4721." | ✖ | hayır | hayır | ✔ |
| k-kotu-acil-sozcuk | tr | warm | evet | "Merhaba, Wi-Fi ağının adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz." | ✖ | hayır | hayır | ✔ |
| k-kotu-iade | en | warm | evet | "Hello, check-in begins at 15:00." | ✖ | hayır | hayır | ✔ |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **k-tr-ayse** (grounded/tr): "Merhaba Ayşe, Wi-Fi ağının adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-john** (grounded/en): "Hi, the Wi-Fi network is “Lale-5G” and the password is “Lale2025!”. If the signal is weak in the bedroom, you can connect to “Lale-2G” using the same password.\n\n(This reply was prepared by an automated assistant.)"
- **k-de-anna** (grounded/de): "Hallo Anna, das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet „Lale2025!“. Wenn das Signal im Schlafzimmer schwach ist, können Sie sich mit demselben Passwort mit dem Netzwerk „Lale-2G“ verbinden.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **k-fr-marie** (grounded/fr): "Bonjour, le code de la boîte à clés est 4721.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **k-es-carlos** (grounded/es): "Hola, el check-in es a las 15:00.\n\n(This reply was prepared by an automated assistant.)"
- **k-ru-ivan** (grounded/ru): "Здравствуйте. Пароль от Wi-Fi: Lale2025! Если в спальне слабый сигнал, подключитесь к сети Lale-2G, используя тот же пароль.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **k-ar-mohammed** (grounded/ar): "مرحباً، كلمة مرور شبكة Wi-Fi هي Lale2025!. وإذا كانت الإشارة ضعيفة في غرفة النوم، يمكنكم الاتصال بشبكة Lale-2G باستخدام كلمة المرور نفسها.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **k-tr-iki-ad** (grounded/tr): "Anahtar kutusunun şifresi 4721.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-tireli** (grounded/en): "Checkout is at 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **k-tr-ad-alani-yok** (grounded/tr): "Merhaba Ayşe, Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-yer-tutucu** (grounded/en): "Check-in starts at 15:00.\n\n(This reply was prepared by an automated assistant.)"
- **k-tr-takvim** (grounded/tr): "Anahtar kutusunun şifresi 4721.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-resmi** (grounded/tr): "Sayın Ayşe Yılmaz, anahtar kutusunun şifresi 4721’dir. Saygılarımızla.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-kisa** (grounded/tr): "Ağ adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-luks** (grounded/en): "The check-out time is 11:00. When you leave, please return the key to the same key box and scramble the numbers.\n\n(This reply was prepared by an automated assistant.)"
- **k-tr-ikinci-tur** (grounded/tr): "Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-en-ikinci-tur** (grounded/en): "The key box code is 4721.\n\n(This reply was prepared by an automated assistant.)"
- **k-kotu-html** (grounded/en): "Check-out is at 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **k-kotu-emoji** (grounded/tr): "Wi-Fi ağının adı Lale-5G, şifresi Lale2025!. Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-kotu-uzun** (grounded/tr): "Anahtar kutusunun kodu 4721.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-kotu-acil-sozcuk** (grounded/tr): "Merhaba, Wi-Fi ağının adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-kotu-iade** (grounded/en): "Hello, check-in begins at 15:00.\n\n(This reply was prepared by an automated assistant.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `1844fb8`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı + bekçi + yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
