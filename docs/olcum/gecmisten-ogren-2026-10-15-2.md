# Geçmişten öğren — 300 misafir mesajı ölçümü (2026-10-15)

Sentetik geçmiş: 303 misafir mesajı, 118 konuşma → 236 gerçek soru↔ev sahibi çifti
(yapay zekâ cevapları, otomatik şablonlar ve "sorunlu" konuşma eşleştirmede elendi). İstem kimliği `82794c2da5ff` · kod `368ebec`

| model | çaba | olgu (14) | otopark çelişkisi / en yeni | Wi-Fi çelişkisi / en yeni | yasak sızıntı | saat olgusu (not) | taslak | işaretli taslak | düşen (kod kapısı) | çağrı / arıza | süre | maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6-luna | low | 13/14 | ✓ / ✓ | ✓ / ✓ | 0 | 0 | 13 | 2 | door_code 5 | 11 / 0 | 96 sn | $0.0069 |
| gpt-6-luna | low | 13/14 | ✓ / ✓ | ✓ / ✓ | 1 | 0 | 12 | 2 | door_code 3 | 11 / 0 | 94 sn | $0.0055 |
| gpt-5.1 | low | 13/14 | ✓ / ✓ | ✓ / ✓ | 1 | 0 | 13 | 2 | door_code 4 | 11 / 0 | 84 sn | $0.1436 |

## gpt-6-luna — taslaklar

Kaçırılan olgular: wifi-guest-net
Sızıntılar: yok

| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |
|---|---|---|---|---|---|---|---|
| 1 | general | Saç kurutma makinesi | Saç kurutma makinesi banyo dolabındadır. | 24 | 2025-04…2025-07 |  |  |
| 2 | local_tips | Yakındaki market | Köşedeki market 200 metre uzaklıktadır ve 23:00'e kadar açıktır. | 23 | 2025-04…2025-07 |  |  |
| 3 | location | Plajın uzaklığı | Plaj yürüyerek 10 dakika uzaklıktadır. | 23 | 2025-04…2025-07 |  |  |
| 4 | general | Havlular | Havlular yatak odasındaki dolaptadır; kişi başı iki havlu vardır. | 22 | 2025-04…2025-07 |  |  |
| 5 | checkin | Anahtarın alınması | Anahtar kapının sağındaki kutudadır. Kutu kodu giriş günü sabah mesajla gönderilir. | 18 | 2025-04…2025-07 |  | door_mention |
| 6 | general | Klima kumandası | Klima kumandası televizyonun yanındaki çekmecededir. | 18 | 2025-04…2025-07 |  |  |
| 7 | rules | Ev kuralları | Evde ve balkonda sigara içilmez, parti yapılmaz. 23:00'ten sonra sessizlik rica edilir. | 17 | 2025-04…2025-07 |  |  |
| 8 | general | Çamaşır makinesi ve deterjan | Çamaşır makinesi banyodadır; deterjan lavabonun altındadır. | 15 | 2025-04…2025-07 |  |  |
| 9 | local_tips | Havalimanından ulaşım | Havalimanından Havaist otobüsüyle Kadıköy durağına gelip oradan 5 dakika yürüyebilirsiniz. | 14 | 2025-04…2025-07 |  |  |
| 10 | parking | Otopark ücreti | Binanın arkasındaki otopark günlük 100 TL'dir. | 14 | 2025-05…2025-07 | Mayıs 2025 tarihli sürümlerde otoparkın ücretsiz olduğu belirtilirken, en yeni sürüm olan Temmuz 2025'te günlük 100 TL olduğu belirtiliyor. |  |
| 11 | trash | Çöp atma | Çöpler bina girişindeki yeşil konteynere atılabilir. | 12 | 2025-04…2025-07 |  |  |
| 12 | parking | Ücretsiz otopark | Binanın arkasında ücretsiz otopark vardır. | 8 | 2025-04…2025-05 | Nisan-Mayıs 2025 tarihli sürümlerde otoparkın ücretsiz olduğu belirtilirken, en yeni sürüm olan Temmuz 2025'te günlük 100 TL olduğu belirtiliyor. |  |
| 13 | wifi | Wi-Fi bilgileri | Wi-Fi ağı Lale_Ev, şifresi lale2024'tür. Misafir Wi-Fi ağının adı Lale_Misafir'dir. | 6 | 2025-04…2025-07 | ✓ | needs_edit |

## gpt-6-luna — taslaklar

Kaçırılan olgular: wifi-guest-net
Sızıntılar: door-code-letters (taslak 8: "kilit")

| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |
|---|---|---|---|---|---|---|---|
| 1 | general | Saç kurutma makinesi | Saç kurutma makinesi banyo dolabındadır. | 24 | 2025-04…2025-07 |  |  |
| 2 | local_tips | Yakındaki market | Köşedeki market 200 metre ileridedir ve gece 23:00'e kadar açıktır. | 23 | 2025-04…2025-07 |  |  |
| 3 | location | Plajın mesafesi | Plaj yürüyerek 10 dakika uzaklıktadır. | 23 | 2025-04…2025-07 |  |  |
| 4 | parking | Otopark ücreti | Binanın arkasındaki otopark günlük 100 TL'dir. | 23 | 2025-04…2025-07 | Otoparkın ücretli olduğu ve günlük 100 TL tuttuğu bilgisi 2025-06 ve 2025-07 aylarında; ücretsiz olduğu bilgisi 2025-04 ve 2025-05 aylarında yer alıyor. En yeni bilgiye göre otopark ücretlidir. |  |
| 5 | general | Havlular | Havlular yatak odasındaki dolaptadır; kişi başı iki havlu vardır. | 22 | 2025-04…2025-07 |  |  |
| 6 | general | Klima kumandası | Klima kumandası televizyonun yanındaki çekmecededir. | 18 | 2025-04…2025-07 |  |  |
| 7 | rules | Ev kuralları | Evde ve balkonda sigara içilmez, parti yapılmaz. 23:00'ten sonra sessizlik rica edilir. | 17 | 2025-04…2025-07 |  |  |
| 8 | checkin | Anahtarın alınması | Anahtar kapının sağındaki kilitli kutudadır. Kutu kodu giriş günü sabah mesajla gönderilir. | 16 | 2025-04…2025-07 |  | door_mention |
| 9 | general | Çamaşır makinesi ve deterjan | Çamaşır makinesi banyodadır; deterjan lavabonun altındadır. | 15 | 2025-04…2025-07 |  |  |
| 10 | local_tips | Havalimanından ulaşım | Havaist otobüsüyle Kadıköy'e gelin; ardından 5 dakika yürüyün. | 14 | 2025-04…2025-07 |  |  |
| 11 | trash | Çöp atma yeri | Çöpler bina girişindeki yeşil konteynere atılabilir. | 12 | 2025-04…2025-07 |  |  |
| 12 | wifi | Wi-Fi bilgileri | Wi-Fi ağı Lale_Ev, şifresi lale2024'tür. Misafir Wi-Fi ağının adı Lale_Misafir'dir. | 9 | 2025-04…2025-07 | ✓ | needs_edit |

## gpt-5.1 — taslaklar

Kaçırılan olgular: wifi-guest-net
Sızıntılar: door-code-letters (taslak 6: "kilit")

| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |
|---|---|---|---|---|---|---|---|
| 1 | general | Saç kurutma makinesi konumu | Saç kurutma makinesi banyodaki dolabın içinde bulunur. | 24 | 2025-04…2025-07 |  |  |
| 2 | local_tips | En yakın marketin yeri ve çalışma saatleri | Köşede, daireye yaklaşık 200 metre mesafede bir market vardır ve gece 23:00’e kadar açıktır. | 23 | 2025-04…2025-07 |  |  |
| 3 | location | Plaja yürüme mesafesi | Plaj, evden yürüyerek yaklaşık 10 dakika mesafededir. | 23 | 2025-04…2025-07 |  |  |
| 4 | parking | Bina arkasındaki otopark ücreti | Binanın arkasındaki otopark ücretlidir ve günlük ücreti 100 TL’dir. | 23 | 2025-04…2025-07 | Nisan 2025 ve öncesine ait bazı kayıtlarda binanın arkasındaki otoparkın ücretsiz olduğu, Mayıs 2025 ve sonrasına ait daha yeni kayıtlarda ise otoparkın ücretli olduğu ve günlük 100 TL alındığı belirtilmiştir. |  |
| 5 | cleaning | Havluların sağlanması ve konumu | Havlular sağlanır; yatak odasındaki dolap/gardıropta bulunur ve kişi başı iki havlu verilir. | 22 | 2025-04…2025-07 |  |  |
| 6 | checkin | Anahtar teslimi ve kilit kutusu | Anahtar, daire kapısının sağındaki şifreli kilit kutusundadır; kutunun kodu misafirlere giriş günü sabah mesajla gönderilir. | 21 | 2025-04…2025-07 |  | door_mention |
| 7 | general | Klima kumandasının konumu | Klima kumandası televizyonun yanındaki çekmecede bulunur. | 18 | 2025-04…2025-07 |  |  |
| 8 | rules | Sigara, parti ve sessizlik kuralları | Evde ve balkonda sigara içilmez, parti yapılmaz ve 23:00’ten sonra sessizlik rica edilir. | 17 | 2025-04…2025-07 |  |  |
| 9 | cleaning | Çamaşır makinesi ve deterjanın yeri | Çamaşır makinesi banyodadır; deterjan banyo lavabosunun altındaki dolapta bulunur. | 15 | 2025-04…2025-07 |  |  |
| 10 | location | Havalimanından daireye ulaşım | Havalimanından Havaist otobüsüyle Kadıköy durağına gelip oradan yaklaşık 5 dakika yürüyerek daireye ulaşılabilir. | 14 | 2025-04…2025-07 |  |  |
| 11 | trash | Çöplerin atılacağı yer | Çöpler bina girişindeki yeşil konteynere atılmalıdır. | 12 | 2025-04…2025-07 |  |  |
| 12 | wifi | Ana Wi-Fi ağı adı ve şifresi | Ana Wi-Fi ağı "Lale_Ev" adını taşır ve şifresi "lale2024"tür. | 9 | 2025-04…2025-07 | ✓ | needs_edit |
| 13 | wifi | Misafir Wi-Fi ağı | Misafirler için "Lale_Misafir" adında ayrı bir Wi-Fi ağı bulunmaktadır. | 5 | 2025-04…2025-07 |  |  |

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
