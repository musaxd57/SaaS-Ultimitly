# Canlı hat — misafire giden cevap — gpt-5.1 (2026-10-22)

Durum: **GEÇERLİ** · commit `daac5bf1` · satır 16/16 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/internal-source-2026-10-22.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 11/13 (85%) |
| doğru olgu MİSAFİRE GİDEN metinde | 10/12 (83%) |
| doğru olgu modelin taslağında (gitmese de) | 12/12 (100%) |
| doğru olgu MİSAFİRE GİDEN — KATI | 10/12 (83%) |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | 0/12 (0%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/12 (0%) |
| dil uyumu misafire giden (TR dışı) | 5/5 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/16 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 8.2 sn / 10.9 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2454**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 17 | 2455 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 92 | 425512 | 322560 | 7635 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| grounded | yes/any | 12 | 4 | 0 | 10/12 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · items_held · items_nothing_answered: 2
- low_confidence_or_risky · availability_claim: 1
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **is-tr-otopark-kart** (grounded/tr): "Merhaba Alex,\n\nBinanın kendi otoparkı yok, 200 metre ileride Gül Sokak üzerinde ücretli açık otopark bulunuyor. Günlük ücreti 150 TL ve ödemeyi gişede hem nakit hem de kartla yapabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **is-tr-wifi-emin** (grounded/tr): "Merhaba Alex,\n\nWi-Fi ağ adı Lale-5G, şifre Lale2025. Yatak odasında sinyal zayıf olursa aynı şifreyle Lale-2G ağına da bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **is-tr-havlu-kayit** (grounded/tr): "Merhaba Alex,\n\nKayıtlarımda havluların 3 günde bir ücretsiz değiştiği görünüyor. Ayrıca yatak odasındaki dolabın üst rafında yedek havlular da bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **is-tr-market-bilgi** (grounded/tr): "Merhaba Alex,\n\nEn yakın market, 100 metre ileride köşedeki Kardelen Market ve çalışma saatleri 07:00-23:30 olarak kayıtlı. Bu bilgiyi dairenin bilgi tabanındaki çevre olanakları bölümünden alıyorum.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **is-en-parking-system** (grounded/en): "Hello Alex,\n\nThere is no private parking for the building. About 200 meters away on Gül Sokak there is a paid open parking lot; the daily fee is 150 TL and payment is made at the booth by cash or card. Parking directly in front of the building is not allowed.\n\n(This reply was prepared by an automated assistant.)"
- **is-en-checkout-records** (grounded/en): "Hello Alex,\n\nCheckout time is 11:00 according to my records.\n\n(This reply was prepared by an automated assistant.)"
- **is-en-bot-how** (grounded/en): "Hello Alex,\n\nQuiet hours are from 23:00 to 08:00, so during this time please avoid loud music and speaking loudly on the balcony.\n\n(This reply was prepared by an automated assistant.)"
- **is-de-wlan-quelle** (grounded/de): "Hallo Alex,\n\nDas WLAN-Netz heißt \"Lale-5G\" und das Passwort lautet \"Lale2025\". Diese Informationen stammen aus den hinterlegten Unterkunftsdaten und sind so in meinen Unterlagen vermerkt.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **pn-tr-kurye** (grounded/tr): "Merhaba Alex,\n\nDaire 3. kattadır, kapı numarası 12.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-wifi** (grounded/tr): "Merhaba Alex,\n\nWi-Fi ağımız \"Lale-5G\", şifresi \"Lale2025\". Yatak odasında sinyal zayıf olursa aynı şifreyle \"Lale-2G\" ağına da bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-en-checkin** (grounded/en): "Hello Alex,\n\nStandard check-in time is 15:00.\n\n(This reply was prepared by an automated assistant.)"
- **c-tr-cop** (grounded/tr): "Merhaba Alex,\n\nÇöpleri binanın arka tarafındaki konteynerlere atabilirsiniz; otopark girişinin hemen yanında bulunuyor. Geri dönüşüm atıklarınız için de mavi konteyneri kullanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `daac5bf1`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=1` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `35b2a8c6b1b2` (öğe + yabancı dil örneği `1cf5a33cfbef`) · anlama `c4b7eed9ba25` (kip: items+rules+cfu+prv)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
