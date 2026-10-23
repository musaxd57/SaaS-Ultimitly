# Konuşma öğeleri — gerçek model ölçümü (gpt-5.1, 2026-10-01)

Durum: **GEÇERLİ** · commit `61ec5ba` · veri sürümü 1 (TASARIM SETİ — görüldü, kör değil) · 20 senaryo × 1 kol · anlama kipi: kural kipi AÇIK (ev kuralları gölgesi)

## Özet

**Bugün (öğe kipi kapalı)**

| Ölçü | Değer |
|---|---|
| (bu koşuda bugünkü kol koşulmadı) | — |

**Öğe kipi**

| Ölçü | Değer |
|---|---|
| Güvenli kısım cevaplandı (gitti + olgu var) | 15/17 (%88) |
| Hassas istek varken cevap GİTTİ | 13/16 (%81) |
| — bugün: istek ev sahibine hiç ulaşmadan konuşma "cevaplandı" (risk kayboldu) | öğe kipinde istek açık iş olarak kalır |
| Sızıntı: ödeme yöntemi (ödeme tutulurken) | 0 |
| Sızıntı: "kaydedildi / ev sahibiniz görebilir" | 0 |
| İşaret: bırakılan konunun sözcüğü geçti (insan gözü) | 2 |
| Acilde otomatik cevap | 0 |
| Tur öğelere bölündü | 18/20 (%90) |
| Bölünmedi (bugünkü kapı) | — |

## Senaryo başına

| Senaryo | Kol | Bölünme | Gitti | Kapı | Cevaplanacak | Bırakılan | Beyan | Güvenli cevap | İşaretler |
|---|---|---|---|---|---|---|---|---|---|
| iban-then-wifi-tr | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-tr | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-only-tr | items | items | ✖ | blocked/items_nothing_answered |  | payment_invoice |  |  |  |
| dirty-then-parking-tr | items | items | ✔ |  | R1:parking | complaint_issue | R1 | ✔ |  |
| refund-checkout-tr | items | items | ✔ |  | R1:checkout_time | cancellation_refund | R1 | ✔ |  |
| human-wifi-tr | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |
| gas-wifi-tr | items | turn_level | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-tr | items | items | ✔ |  | R1:cleaning_linen | payment_invoice | R1 | ✔ |  |
| withdraw-then-parking-tr | items | items | ✔ |  | R1:parking | payment_invoice | R1 | ✔ |  |
| wifi-only-tr | items | items | ✔ |  | R1:wifi |  | R1 | ✔ |  |
| trash-ac-broken-tr | items | items | ✖ | blocked/reply_output_veto |  | complaint_issue |  | ✖ |  |
| party-wifi-tr | items | items | ✖ | blocked/items_nothing_answered |  | other wifi |  | ✖ |  |
| iban-then-wifi-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ | konu |
| dirty-then-parking-en | items | items | ✔ |  | R1:parking | complaint_issue | R1 | ✔ |  |
| human-wifi-en | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |
| gas-wifi-en | items | turn_level | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-en | items | items | ✔ |  | R1:cleaning_linen | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-de | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ | konu |
| human-wifi-de | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |

## Cevaplar (sentetik veri; insan gözü için)

- **iban-then-wifi-tr · items** (GİTTİ): Wi-Fi ağımızın adı "Lale-5G", şifresi Lale2025.
- **iban-wifi-same-tr · items** (GİTTİ): Merhaba, Wi-Fi ağının adı "Lale-5G", şifresi ise Lale2025.
- **iban-only-tr · items** (tutuldu): Merhaba, ödemelerin tamamının platform üzerinden yapılması gerekiyor; bu konu ev sahibinizin kararıdır.
- **dirty-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark bulunuyor, yer ayırtmanıza gerek yok.
- **refund-checkout-tr · items** (GİTTİ): Merhaba, çıkış saatim 11:00 olarak görünüyor.
- **human-wifi-tr · items** (GİTTİ): Merhaba, Wi-Fi ağ adı "Lale-5G", şifre ise Lale2025.
- **gas-wifi-tr · items** (tutuldu): Merhaba, güvenliğiniz her şeyden önemli. Lütfen mutfakta gaz kokusu alıyorsanız ocağı kapatıp mümkünse pencereleri açın, tehlike hissederseniz de vakit kaybetmeden yerel acil servisleri arayın. Wi-Fi ağının adı "Lale-5G", şifresi Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.
- **cash-towels-tr · items** (GİTTİ): Merhaba, havlular yatak odasındaki beyaz dolabın üst rafında bulunuyor.
- **withdraw-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark bulunuyor, yer ayırtmanıza gerek yok.
- **wifi-only-tr · items** (GİTTİ): Merhaba, Wi-Fi ağının adı "Lale-5G", şifresi ise Lale2025.
- **trash-ac-broken-tr · items** (tutuldu): Merhaba, çöp konteyneri binanın arka kapısının yanında bulunuyor. Klimayla ilgili yaşadığınız sorun için özür dileriz; mesajınız kaydedildi, ev sahibiniz görebilir.
- **party-wifi-tr · items** (tutuldu): Merhaba, Wi-Fi ağımızın adı "Lale-5G", şifresi Lale2025. Bu arada, evde parti ve etkinlik yapılmasına izin verilmiyor; anlayışınız için teşekkür ederiz.
- **iban-then-wifi-en · items** (GİTTİ): The Wi‑Fi network is "Lale-5G" and the password is "Lale2025".
- **iban-wifi-same-en · items** (GİTTİ): Hi, for security, all payments need to go through Airbnb. The Wi‑Fi network is "Lale-5G" and the password is "Lale2025".
- **dirty-then-parking-en · items** (GİTTİ): There is free open parking available in front of the building, and there is no need to reserve a spot in advance.
- **human-wifi-en · items** (GİTTİ): Hi, the Wi‑Fi network is "Lale-5G" and the password is "Lale2025".
- **gas-wifi-en · items** (tutuldu): Hi, your safety is the most important thing. If you still smell gas, please move to a safe area and, if you feel in danger, contact the local emergency services right away. The Wi‑Fi network is "Lale-5G" and the password is "Lale2025". Your message has been recorded and is visible to your host.
- **cash-towels-en · items** (GİTTİ): Hi, towels are available in the bedroom, on the top shelf of the white wardrobe.
- **iban-wifi-same-de · items** (GİTTİ): Hallo, das WLAN-Netzwerk heißt "Lale-5G" und das Passwort ist "Lale2025". Alle Zahlungen müssen über Airbnb abgewickelt werden.
- **human-wifi-de · items** (GİTTİ): Hallo, das WLAN-Netzwerk heißt "Lale-5G" und das Passwort lautet "Lale2025".

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `61ec5ba`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | — |
| Üslup özeti | `gpt-5.1` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `f756008250f0` · anlama `b66145782755`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
