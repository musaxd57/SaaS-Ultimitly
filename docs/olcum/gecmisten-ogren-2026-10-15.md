# Geçmişten öğren — 300 misafir mesajı ölçümü (2026-10-15)

Sentetik geçmiş: 303 misafir mesajı, 118 konuşma → 235 gerçek soru↔ev sahibi çifti
(yapay zekâ cevapları, otomatik şablonlar ve "sorunlu" konuşma eşleştirmede elendi). İstem kimliği `2dc4e62510cb` · [object Object]

| model | çaba | olgu (13) | otopark çelişkisi | en yeni otopark bilgisi | yasak sızıntı | saat olgusu (not) | taslak | düşen (kod kapısı) | çağrı / arıza | süre | maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6-luna | low | 13/13 | ✓ | ✓ | 0 | 0 | 12 | — | 11 / 0 | 98 sn | $0.0063 |

## gpt-6-luna — taslaklar

Kaçırılan olgular: yok
Sızıntılar: yok

| # | kategori | başlık | içerik | konuşma | çelişki | işaret |
|---|---|---|---|---|---|---|
| 1 | faq | Saç kurutma makinesi | Saç kurutma makinesi banyo dolabındadır. | 24 |  |  |
| 2 | local_tips | Yakındaki market | Köşede, 200 metre uzaklıkta bir market vardır. Taslaklarda marketin 23:00'e kadar açık olduğu da belirtilir. | 23 |  |  |
| 3 | location | Plaja ulaşım | Plaj yürüyerek 10 dakika uzaklıktadır. | 23 |  |  |
| 4 | cleaning | Havlular | Havlular yatak odasındaki dolapta veya gardıroptadır; kişi başı iki havlu bulunur. | 22 |  |  |
| 5 | parking | Otopark | Binanın arkasında otopark vardır. Otoparkın ücretli olduğuna dair taslaklarda günlük 100 TL bilgisi, ücretsiz olduğuna dair taslaklarda ise ücret alınmadığı bilgisi yer alır. | 22 | Otopark ücreti konusunda taslaklar çelişiyor: Bazılarında binanın arkasındaki otoparkın günlük 100 TL olduğu, bazılarında ise ücretsiz olduğu belirtiliyor. |  |
| 6 | checkin | Anahtarın alınması | Anahtar kapının sağındaki kutudadır. Kutu kodu giriş günü sabah mesajla gönderilir. | 20 |  |  |
| 7 | faq | Klima kumandası | Klima kumandası televizyonun yanındaki çekmecededir. | 18 |  |  |
| 8 | rules | Ev kuralları | Evde ve balkonda sigara içilmez, parti yapılmaz. 23:00'ten sonra sessizlik rica edilir. | 17 |  |  |
| 9 | faq | Çamaşır makinesi ve deterjan | Çamaşır makinesi banyodadır; deterjan lavabonun altındadır. | 15 |  |  |
| 10 | local_tips | Havalimanından ulaşım | Havaist otobüsüyle Kadıköy'e veya Kadıköy durağına gidip ardından 5 dakika yürüyebilirsiniz. | 14 |  |  |
| 11 | wifi | Wi-Fi bilgileri | Ağ adı: Lale_Ev. Şifre: lale2024. | 14 |  |  |
| 12 | trash | Çöp atma | Çöpler bina girişindeki yeşil konteynere atılabilir. | 12 |  |  |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `368ebec`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
