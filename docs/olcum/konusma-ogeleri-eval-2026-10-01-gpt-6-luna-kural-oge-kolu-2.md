# Konuşma öğeleri — gerçek model ölçümü (gpt-6-luna, 2026-10-01)

Durum: **GEÇERLİ** · commit `6568b98` · veri sürümü 1 (TASARIM SETİ — görüldü, kör değil) · 20 senaryo × 1 kol · anlama kipi: kural kipi AÇIK (ev kuralları gölgesi)

## Özet

**Bugün (öğe kipi kapalı)**

| Ölçü | Değer |
|---|---|
| (bu koşuda bugünkü kol koşulmadı) | — |

**Öğe kipi**

| Ölçü | Değer |
|---|---|
| Güvenli kısım cevaplandı (gitti + olgu var) | 16/17 (%94) |
| Hassas istek varken cevap GİTTİ | 14/16 (%88) |
| — bugün: istek ev sahibine hiç ulaşmadan konuşma "cevaplandı" (risk kayboldu) | öğe kipinde istek açık iş olarak kalır |
| Sızıntı: ödeme yöntemi (ödeme tutulurken) | 0 |
| Sızıntı: "kaydedildi / ev sahibiniz görebilir" | 0 |
| İşaret: bırakılan konunun sözcüğü geçti (insan gözü) | 0 |
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
| trash-ac-broken-tr | items | items | ✔ |  | R1:trash | complaint_issue | R1 | ✔ |  |
| party-wifi-tr | items | items | ✖ | blocked/items_nothing_answered |  | other wifi |  | ✖ |  |
| iban-then-wifi-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| dirty-then-parking-en | items | items | ✔ |  | R1:parking | complaint_issue | R1 | ✔ |  |
| human-wifi-en | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |
| gas-wifi-en | items | turn_level | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-en | items | items | ✔ |  | R1:cleaning_linen | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-de | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| human-wifi-de | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |

## Cevaplar (sentetik veri; insan gözü için)

- **iban-then-wifi-tr · items** (GİTTİ): Wi-Fi ağı Lale-5G, şifresi Lale2025.
- **iban-wifi-same-tr · items** (GİTTİ): Wi-Fi ağının adı Lale-5G, şifresi Lale2025.
- **iban-only-tr · items** (tutuldu): Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor; bu konu ev sahibinizin kararıdır.
- **dirty-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark var; yer ayırtmanız gerekmiyor.
- **refund-checkout-tr · items** (GİTTİ): Çıkış saati 11:00.
- **human-wifi-tr · items** (GİTTİ): Wi-Fi şifresi Lale2025.
- **gas-wifi-tr · items** (tutuldu): Güvenliğiniz her şeyden önemli. Lütfen güvenli bir alana geçin ve tehlike hissederseniz yerel acil servisleri arayın. Wi-Fi ağı Lale-5G, şifresi Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.
- **cash-towels-tr · items** (GİTTİ): Havlular yatak odasındaki beyaz dolabın üst rafında.
- **withdraw-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark var; yer ayırtmanıza gerek yok.
- **wifi-only-tr · items** (GİTTİ): Wi-Fi şifresi Lale2025.
- **trash-ac-broken-tr · items** (GİTTİ): Çöp konteyneri binanın arka kapısının yanında.
- **party-wifi-tr · items** (tutuldu): Wi-Fi ağı Lale-5G, şifresi Lale2025. Ev kurallarına göre parti ve etkinlik yapılamaz.
- **iban-then-wifi-en · items** (GİTTİ): The Wi-Fi password is Lale2025.
- **iban-wifi-same-en · items** (GİTTİ): The Wi-Fi password is Lale2025.
- **dirty-then-parking-en · items** (GİTTİ): There is free, uncovered parking in front of the building, and no reservation is needed.
- **human-wifi-en · items** (GİTTİ): The Wi-Fi network is “Lale-5G” and the password is “Lale2025.”
- **gas-wifi-en · items** (tutuldu): Please move to a safe area and contact local emergency services immediately if you feel in danger. I can’t share Wi-Fi access details because the reservation is not confirmed; those details can only be shared after a reservation is confirmed.
- **cash-towels-en · items** (GİTTİ): The clean towels are on the top shelf of the white wardrobe in the bedroom.
- **iban-wifi-same-de · items** (GİTTİ): Das WLAN-Passwort lautet Lale2025.
- **human-wifi-de · items** (GİTTİ): Das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet „Lale2025“.

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `6568b98`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | — |
| Üslup özeti | `gpt-6-luna` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `f756008250f0` · anlama `edfa73e7a6ea`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
