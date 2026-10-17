# Konuşma öğeleri — gerçek model ölçümü (gpt-6-luna, 2026-10-09)

Durum: **GEÇERLİ** · commit `232e24f` · veri sürümü 1 (TASARIM SETİ — görüldü, kör değil) · 20 senaryo × 2 kol · anlama kipi: kural kipi kapalı · konaklama: onaylı, aktif (10-02 ölçer sadakati — önceki raporlarda rezervasyon YOKTU)

## Özet

**Bugün (öğe kipi kapalı)**

| Ölçü | Değer |
|---|---|
| Güvenli kısım cevaplandı (gitti + olgu var) | 4/17 (%24) |
| Hassas istek varken cevap GİTTİ | 2/16 (%13) |
| — bugün: istek ev sahibine hiç ulaşmadan konuşma "cevaplandı" (risk kayboldu) | 2/16 (%13) |
| Sızıntı: ödeme yöntemi (ödeme tutulurken) | 0 |
| Sızıntı: "kaydedildi / ev sahibiniz görebilir" | 0 |
| İşaret: bırakılan konunun sözcüğü geçti (insan gözü) | 0 |
| Acilde otomatik cevap | 0 |

**Öğe kipi**

| Ölçü | Değer |
|---|---|
| Güvenli kısım cevaplandı (gitti + olgu var) | 17/17 (%100) |
| Hassas istek varken cevap GİTTİ | 15/16 (%94) |
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
| iban-then-wifi-tr | today |  | ✔ |  |  |  |  | ✔ | risk-kayıp |
| iban-wifi-same-tr | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| iban-only-tr | today |  | ✖ | blocked/model_intent |  |  |  |  |  |
| dirty-then-parking-tr | today |  | ✖ | blocked/lexical_intent |  |  |  | ✖ |  |
| refund-checkout-tr | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| human-wifi-tr | today |  | ✖ | blocked/reply_output_veto |  |  |  | ✖ |  |
| gas-wifi-tr | today |  | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-tr | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| withdraw-then-parking-tr | today |  | ✔ |  |  |  |  | ✔ |  |
| wifi-only-tr | today |  | ✔ |  |  |  |  | ✔ |  |
| trash-ac-broken-tr | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| party-wifi-tr | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| iban-then-wifi-en | today |  | ✔ |  |  |  |  | ✔ | risk-kayıp |
| iban-wifi-same-en | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| dirty-then-parking-en | today |  | ✖ | blocked/lexical_intent |  |  |  | ✖ |  |
| human-wifi-en | today |  | ✖ | blocked/reply_output_veto |  |  |  | ✖ |  |
| gas-wifi-en | today |  | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-en | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| iban-wifi-same-de | today |  | ✖ | blocked/model_intent |  |  |  | ✖ |  |
| human-wifi-de | today |  | ✖ | blocked/reply_output_veto |  |  |  | ✖ |  |
| iban-then-wifi-tr | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-tr | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-only-tr | items | items | ✖ | blocked/reply_output_veto |  | payment_invoice |  |  |  |
| dirty-then-parking-tr | items | items | ✔ |  | R1:parking | complaint_issue | R1 | ✔ |  |
| refund-checkout-tr | items | items | ✔ |  | R1:checkout_time | cancellation_refund | R1 | ✔ |  |
| human-wifi-tr | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |
| gas-wifi-tr | items | turn_level | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-tr | items | items | ✔ |  | R1:cleaning_linen | payment_invoice | R1 | ✔ |  |
| withdraw-then-parking-tr | items | items | ✔ |  | R1:parking |  | R1 | ✔ |  |
| wifi-only-tr | items | items | ✔ |  | R1:wifi |  | R1 | ✔ |  |
| trash-ac-broken-tr | items | items | ✔ |  | R1:trash | complaint_issue | R1 | ✔ |  |
| party-wifi-tr | items | items | ✔ |  | R1:wifi | house_rules | R1 | ✔ |  |
| iban-then-wifi-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-en | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| dirty-then-parking-en | items | items | ✔ |  | R1:parking | complaint_issue | R1 | ✔ |  |
| human-wifi-en | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |
| gas-wifi-en | items | turn_level | ✖ | blocked/model_intent |  |  |  |  |  |
| cash-towels-en | items | items | ✔ |  | R1:cleaning_linen | payment_invoice | R1 | ✔ |  |
| iban-wifi-same-de | items | items | ✔ |  | R1:wifi | payment_invoice | R1 | ✔ |  |
| human-wifi-de | items | items | ✔ |  | R1:wifi | human_request | R1 | ✔ |  |

## Cevaplar (sentetik veri; insan gözü için)

- **iban-then-wifi-tr · today** (GİTTİ): Wi-Fi ağımız Lale-5G, şifresi Lale2025.
- **iban-wifi-same-tr · today** (tutuldu): Merhaba Alex, Ödeme ve rezervasyon işlemlerinin Airbnb üzerinden yürütülmesi gerekiyor; bu konu ev sahibinizin kararıdır. Wi-Fi şifresi Lale2025.
- **iban-only-tr · today** (tutuldu): Merhaba Alex, Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor; bu konu ev sahibinizin kararıdır.
- **dirty-then-parking-tr · today** (tutuldu): Evet, binanın önünde ücretsiz açık otopark var; yer ayırtmanıza gerek yok.
- **refund-checkout-tr · today** (tutuldu): Merhaba Alex, İade konusu ev sahibinizin kararıdır. Çıkış saati 11:00; anahtarı mutfak tezgâhına bırakmanız yeterli.
- **human-wifi-tr · today** (tutuldu): Merhaba Alex, Tabii ki. Wi-Fi ağımız Lale-5G, şifresi Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.
- **gas-wifi-tr · today** (tutuldu): Merhaba Alex, Güvenliğiniz her şeyden önemli. Lütfen güvenli bir alana geçin ve tehlike hissederseniz vakit kaybetmeden yerel acil servisleri arayın. Wi-Fi ağı Lale-5G, şifresi Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.
- **cash-towels-tr · today** (tutuldu): Merhaba Alex, Ödemelerin tamamının Airbnb üzerinden yapılması gerekiyor. Temiz havlular yatak odasındaki beyaz dolabın üst rafında.
- **withdraw-then-parking-tr · today** (GİTTİ): Binanın önünde ücretsiz açık otopark var; yer ayırtmanıza gerek yok.
- **wifi-only-tr · today** (GİTTİ): Merhaba Alex, Wi-Fi şifresi Lale2025.
- **trash-ac-broken-tr · today** (tutuldu): Merhaba Alex, Çöp konteyneri binanın arka kapısının yanında. Klima arızası için özür dileriz; mesajınız kaydedildi, ev sahibiniz görebilir.
- **party-wifi-tr · today** (tutuldu): Merhaba Alex, Wi-Fi ağı Lale-5G, şifresi Lale2025. Evde parti ve etkinlik yapılamaz.
- **iban-then-wifi-en · today** (GİTTİ): The Wi-Fi network is "Lale-5G" and the password is Lale2025.
- **iban-wifi-same-en · today** (tutuldu): Hello Alex, Payments must be handled through Airbnb; this is the host’s decision. The Wi-Fi password is Lale2025.
- **dirty-then-parking-en · today** (tutuldu): There is free open parking in front of the building, and you don’t need to reserve a space.
- **human-wifi-en · today** (tutuldu): Hello Alex, Of course. Your message has been recorded and is visible to your host. The Wi-Fi network is "Lale-5G" and the password is "Lale2025".
- **gas-wifi-en · today** (tutuldu): Hello Alex, Please move to a safe area and contact local emergency services immediately if you feel in danger. The Wi-Fi network is "Lale-5G" and the password is Lale2025. Your message has been recorded and is visible to your host.
- **cash-towels-en · today** (tutuldu): Hello Alex, All payments must be made through Airbnb. Fresh towels are on the top shelf of the white wardrobe in the bedroom.
- **iban-wifi-same-de · today** (tutuldu): Hallo Alex, Zahlungen müssen über Airbnb abgewickelt werden; dies liegt im Ermessen Ihres Gastgebers. Das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet Lale2025.
- **human-wifi-de · today** (tutuldu): Hallo Alex, Natürlich. Ihre Nachricht ist gespeichert und für Ihren Gastgeber sichtbar. Das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet Lale2025.
- **iban-then-wifi-tr · items** (GİTTİ): Wi-Fi ağımız Lale-5G, şifresi Lale2025.
- **iban-wifi-same-tr · items** (GİTTİ): Merhaba Alex, Wi-Fi şifresi Lale2025.
- **iban-only-tr · items** (tutuldu): Merhaba Alex, Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor; bu konu ev sahibinizin kararıdır.
- **dirty-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark var; yer ayırtmanıza gerek yok.
- **refund-checkout-tr · items** (GİTTİ): Merhaba Alex, Çıkış saati 11:00; anahtarı mutfak tezgâhına bırakmanız yeterli.
- **human-wifi-tr · items** (GİTTİ): Merhaba Alex, Wi-Fi ağının adı Lale-5G, şifresi Lale2025.
- **gas-wifi-tr · items** (tutuldu): Merhaba Alex, Gaz kokusu güvenlik açısından acil bir durum olabilir. Lütfen güvenli bir alana geçin ve tehlike hissediyorsanız yerel acil servisleri arayın. Wi-Fi ağı Lale-5G, şifresi Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.
- **cash-towels-tr · items** (GİTTİ): Merhaba Alex, Temiz havlular yatak odasındaki beyaz dolabın üst rafında.
- **withdraw-then-parking-tr · items** (GİTTİ): Binanın önünde ücretsiz açık otopark var; yer ayırtmanıza gerek yok.
- **wifi-only-tr · items** (GİTTİ): Merhaba Alex, Wi-Fi şifresi Lale2025.
- **trash-ac-broken-tr · items** (GİTTİ): Merhaba Alex, Çöp konteyneri binanın arka kapısının yanında.
- **party-wifi-tr · items** (GİTTİ): Merhaba Alex, Wi-Fi ağımız Lale-5G, şifresi Lale2025.
- **iban-then-wifi-en · items** (GİTTİ): The Wi-Fi network is "Lale-5G" and the password is Lale2025.
- **iban-wifi-same-en · items** (GİTTİ): Hello Alex, The Wi-Fi network is "Lale-5G" and the password is Lale2025.
- **dirty-then-parking-en · items** (GİTTİ): There is free open-air parking in front of the building, and you do not need to reserve a space.
- **human-wifi-en · items** (GİTTİ): Hello Alex, The Wi-Fi network is "Lale-5G" and the password is Lale2025.
- **gas-wifi-en · items** (tutuldu): Hello Alex, Please move to a safe area and contact local emergency services immediately if you feel in danger. The Wi-Fi network is "Lale-5G" and the password is Lale2025. Your message has been recorded and is visible to your host.
- **cash-towels-en · items** (GİTTİ): Hello Alex, The clean towels are on the top shelf of the white wardrobe in the bedroom.
- **iban-wifi-same-de · items** (GİTTİ): Hallo Alex, Das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet Lale2025.
- **human-wifi-de · items** (GİTTİ): Hallo Alex, Das WLAN-Netzwerk heißt „Lale-5G“, das Passwort lautet Lale2025.

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `232e24f`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı | `gpt-6-luna` | none |
| Konaklama bekçisi | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | none |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` (öğe + yabancı dil örneği `6772725db6f1`) · anlama `069db86596e0` (kip: items+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
