# Geçmişten öğren — 300 misafir mesajı ölçümü (2026-10-15)

Sentetik geçmiş: 303 misafir mesajı, 118 konuşma → 236 gerçek soru↔ev sahibi çifti
(yapay zekâ cevapları, otomatik şablonlar ve "sorunlu" konuşma eşleştirmede elendi). İstem kimliği `9506cca4cef1` · kod `368ebec`

| model | çaba | olgu (14) | otopark çelişkisi / en yeni | Wi-Fi çelişkisi / en yeni | yasak sızıntı | saat olgusu (not) | taslak | işaretli taslak | düşen (kod kapısı) | çağrı / arıza | süre | maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6-luna | low | 13/14 | ✓ / ✓ | ✓ / ✓ | 0 | 0 | 12 | 1 | door_code 4 | 11 / 0 | 97 sn | $0.0053 |
| gpt-6-luna | low | 13/14 | ✓ / ✓ | ✓ / ✓ | 0 | 0 | 12 | 1 | door_code 4 | 11 / 0 | 87 sn | $0.0051 |

## gpt-6-luna — taslaklar

Kaçırılan olgular: wifi-guest-net
Sızıntılar: yok

| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |
|---|---|---|---|---|---|---|---|
| 1 | general | Saç kurutma makinesi | Saç kurutma makinesi banyo dolabındadır. | 24 | 2025-04…2025-07 |  |  |
| 2 | local_tips | Yakındaki market | Köşedeki market 200 metre ileridedir ve 23:00'e kadar açıktır. | 23 | 2025-04…2025-07 |  |  |
| 3 | location | Plajın uzaklığı | Plaj yürüyerek 10 dakika uzaklıktadır. | 23 | 2025-04…2025-07 |  |  |
| 4 | parking | Otopark ücreti | Binanın arkasındaki otopark günlük 100 TL'dir. | 23 | 2025-04…2025-07 | Otopark Mayıs 2025'te ücretsiz olarak belirtilmişken, Haziran ve Temmuz 2025'te günlük 100 TL ücretli olarak belirtilmiştir. |  |
| 5 | general | Havlular | Havlular yatak odasındaki dolaptadır; kişi başı iki havlu vardır. | 22 | 2025-04…2025-07 |  |  |
| 6 | checkin | Anahtarın alınması | Anahtar kapının sağındaki kutudadır. Kutu kodu giriş günü sabah mesajla gönderilir. | 18 | 2025-04…2025-07 |  | door_mention |
| 7 | general | Klima kumandası | Klima kumandası televizyonun yanındaki çekmecededir. | 18 | 2025-04…2025-07 |  |  |
| 8 | rules | Ev kuralları | Evde ve balkonda sigara içilmez, parti yapılmaz. 23:00'ten sonra sessizlik rica edilir. | 17 | 2025-04…2025-07 |  |  |
| 9 | general | Çamaşır makinesi ve deterjan | Çamaşır makinesi banyodadır; deterjan lavabonun altındadır. | 15 | 2025-04…2025-07 |  |  |
| 10 | local_tips | Havalimanından ulaşım | Havaist otobüsüyle Kadıköy'e gidip ardından 5 dakika yürüyebilirsiniz. | 14 | 2025-04…2025-07 |  |  |
| 11 | trash | Çöp atma yeri | Çöpleri bina girişindeki yeşil konteynere atabilirsiniz. | 12 | 2025-04…2025-07 |  |  |
| 12 | wifi | Wi-Fi bilgileri | Wi-Fi ağı Lale_Ev, şifresi lale2024'tür. Misafir Wi-Fi ağının adı Lale_Misafir'dir. | 9 | 2025-04…2025-07 | Ana Wi-Fi şifresi Nisan 2025'te lale2023, Mayıs ve Haziran 2025'te lale2024 olarak belirtilmiştir. Misafir Wi-Fi ağının adı Lale_Misafir olarak belirtilmiştir. |  |

## gpt-6-luna — taslaklar

Kaçırılan olgular: wifi-guest-net
Sızıntılar: yok

| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |
|---|---|---|---|---|---|---|---|
| 1 | general | Saç kurutma makinesi | Saç kurutma makinesi banyo dolabındadır. | 24 | 2025-04…2025-07 |  |  |
| 2 | location | Plajın konumu | Plaj yürüyerek 10 dakika uzaklıktadır. | 23 | 2025-04…2025-07 |  |  |
| 3 | parking | Otopark ücreti | Binanın arkasındaki otopark ücretlidir ve günlük 100 TL'dir. | 23 | 2025-04…2025-07 | Otopark Mayıs 2025 ve Nisan 2025'te ücretsiz olarak belirtilmiş; Haziran 2025 ve Temmuz 2025'te günlük 100 TL ücretli olduğu belirtilmiştir. |  |
| 4 | general | Havlular | Havlular yatak odasındaki dolapta veya gardıroptadır; kişi başı iki havlu vardır. | 22 | 2025-04…2025-07 |  |  |
| 5 | local_tips | Yakındaki market | Köşede yaklaşık 200 metre ileride bir market vardır; 23:00'e kadar açıktır. | 21 | 2025-04…2025-07 |  |  |
| 6 | checkin | Anahtarın alınması | Anahtar kapının sağındaki kilitli kutudadır. Kutu kodu giriş günü sabah mesajla gönderilir. | 19 | 2025-04…2025-07 |  | door_mention |
| 7 | general | Klima kumandası | Klima kumandası televizyonun yanındaki çekmecededir. | 18 | 2025-04…2025-07 |  |  |
| 8 | rules | Ev kuralları | Evde ve balkonda sigara içilmez ve parti yapılmaz. 23:00'ten sonra sessizlik rica edilir. | 17 | 2025-04…2025-07 |  |  |
| 9 | general | Çamaşır makinesi ve deterjan | Çamaşır makinesi banyodadır; deterjan lavabonun altındadır. | 15 | 2025-04…2025-07 |  |  |
| 10 | local_tips | Havalimanından ulaşım | Havaist otobüsüyle Kadıköy'e veya Kadıköy durağına gelin; ardından 5 dakika yürüyün. | 14 | 2025-04…2025-07 |  |  |
| 11 | trash | Çöp atma yeri | Çöpler bina girişindeki yeşil konteynere atılabilir. | 12 | 2025-04…2025-07 |  |  |
| 12 | wifi | Wi-Fi bilgileri | Wi-Fi ağı Lale_Ev, şifresi lale2024'tür. Lale_Misafir adlı bir misafir Wi-Fi ağı da vardır; şifresi belirtilmemiştir. | 7 | 2025-04…2025-07 | Ana Wi-Fi şifresi Mayıs 2025 ve Nisan 2025'te lale2023, Haziran 2025 ve Temmuz 2025'te lale2024 olarak belirtilmiştir. |  |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `368ebec`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `gpt-5.1` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
