# Canlı hat — misafire giden cevap — gpt-6-luna (2026-09-30)

Durum: **GEÇERLİ** · commit `6246a2a` · satır 12/12 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/model-reply-compare.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=(boş)` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=1` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · düşünme: `OPENAI_REASONING_EFFORT=none`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 11/11 (100%) |
| doğru olgu MİSAFİRE GİDEN metinde | 11/11 (100%) |
| doğru olgu modelin taslağında (gitmese de) | 11/11 (100%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/11 (0%) |
| dil uyumu misafire giden (TR dışı) | 4/4 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| düşen / hata | 0/12 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 7.3 sn / 9.5 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0542**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 13 | 2457 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 35 | 44206 | 28672 | 2394 | 0 |
| gpt-6-luna | 12 | 228534 | 184261 | 1868 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu |
|---|---|---|---|---|
| grounded | yes | 10 | 0 | 0 |
| multi_turn | yes/no | 1 | 1 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · items_held · reply_output_veto: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **g-tr-wifi-sifre** (grounded/tr): "Merhaba Alex,\n\nWi-Fi ağının adı Lale-5G, şifresi Lale2025! Yatak odasında sinyal zayıfsa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-tr-anahtar-kutusu** (grounded/tr): "Merhaba Alex,\n\nAnahtar, bina kapısının solundaki gri anahtar kutusunda. Şifre 4721; girdikten sonra kapağı aşağı çekip anahtarı alabilirsiniz. Anahtarı aldıktan sonra kapağı kapatıp rakamları karıştırın; bina kapısı da aynı anahtarla açılır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-tr-anahtar-iade-ve-cikis** (grounded/tr): "Merhaba Alex,\n\nÇıkış saati 11:00. Çıkarken anahtarı aynı anahtar kutusuna bırakıp rakamları karıştırabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-tr-market-saat** (grounded/tr): "Merhaba Alex,\n\nEn yakın market, 100 metre ilerideki köşede bulunan Kardelen Market. Her gün 07:00-23:30 saatleri arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-tr-kapi-no** (grounded/tr): "Merhaba Alex,\n\nDaire 3. katta, kapı numarası 12.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-tr-coklu-soru** (grounded/tr): "Merhaba Alex,\n\nWi-Fi şifresi Lale2025!. Anahtar kutusunun kodu 4721; kutu bina kapısının solundadır. Otopark ücreti günlük 150 TL'dir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **g-en-wifi** (grounded/en): "Hello Alex,\n\nThe Wi-Fi network is \"Lale-5G\" and the password is \"Lale2025!\". If the signal is weak in the bedroom, you can connect to \"Lale-2G\" using the same password.\n\n(This reply was prepared by an automated assistant.)"
- **g-en-keybox** (grounded/en): "Hello Alex,\n\nThe key is in the gray lockbox to the left of the building entrance. Enter code 4721 and pull the cover down. After taking the key, close the cover and scramble the numbers. The same key opens the building entrance.\n\n(This reply was prepared by an automated assistant.)"
- **g-fr-boite-cles** (grounded/fr): "Bonjour Alex,\n\nLe code de la boîte à clés est 4721. Saisissez-le, tirez le clapet vers le bas, puis refermez-le et mélangez les chiffres après avoir pris la clé.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **g-ru-keybox** (grounded/ru): "Здравствуйте, Alex!\n\nКод ящика с ключами — 4721. Введите его и потяните крышку вниз, чтобы взять ключ.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **mt-tr-giris-sonra-kod** (multi_turn/tr): "Anahtar kutusunun şifresi 4721. Kutu, bina kapısının solunda.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `6246a2a`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı + bekçi + yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=1` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
