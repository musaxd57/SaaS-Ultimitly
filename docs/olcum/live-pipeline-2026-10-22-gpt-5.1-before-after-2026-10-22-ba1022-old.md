# Canlı hat — misafire giden cevap — gpt-5.1 (2026-10-22)

Durum: **GEÇERLİ** · commit `ebc20009` · satır 22/22 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/before-after-2026-10-22.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | 3/7 (43%) |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 7/9 (78%) |
| doğru olgu MİSAFİRE GİDEN metinde | 4/9 (44%) |
| doğru olgu modelin taslağında (gitmese de) | 8/9 (89%) |
| doğru olgu MİSAFİRE GİDEN — KATI | 4/9 (44%) |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | 0/9 (0%) |
| bilgisi olmayan soruda misafire giden | 0/2 (0%) |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/10 (0%) |
| dil uyumu misafire giden (TR dışı) | 3/3 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | 4/4 (100%) · 4/4 (100%) |
| acil: gitmedi / Sorunlu / e-posta | 3/3 (100%) · 3/3 (100%) · 3/3 (100%) |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/7 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/22 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 6.2 sn / 9.6 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.2823**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 23 | 2884 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 75 | 519150 | 396928 | 7986 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| grounded | yes | 7 | 2 | 0 | 4/7 | 0 | 0 |
| complaint | any/no | 3 | 1 | 0 | 0/0 | 0 | 0 |
| human_request | no | 0 | 4 | 0 | 0/0 | 0 | 0 |
| missing | any | 0 | 2 | 0 | 0/2 | 0 | 0 |
| emergency | no/any | 0 | 3 | 3 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · items_held · reply_output_veto: 3
- escalated_to_human · escalated_to_human · model_intent: 3
- low_confidence_or_risky · items_held · items_nothing_answered: 2
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 2
- low_confidence_or_risky · items_held · reply_absence: 1
- low_confidence_or_risky · low_confidence_or_risky · model_risk_label: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **h-tr-eriyoruz** (grounded/tr): "Merhaba Alex,\n\nKlima kumandası salondaki TV ünitesinin çekmecesindedir. MODE tuşuyla soğutma (kar tanesi) ya da ısıtma (güneş) modunu seçebilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-tr-acliktan-oluyoruz** (grounded/tr): "Merhaba Alex,\n\nEn yakın market köşedeki Kardelen Market, her gün sabah 07:00'de açılıyor ve 23:30'a kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-tr-dustan-cikmak-istemiyoruz** (grounded/tr): "Merhaba Alex,\n\nÇıkış saati 11:00. Çıkarken anahtarı tekrar anahtar kutusuna bırakıp rakamları karıştırmanız yeterli.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-tr-sarj-patlayacak** (grounded/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale-5G\", şifre ise Lale2025. Yatak odasında çekim zayıf olursa aynı şifreyle \"Lale-2G\" ağına da bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **h-en-dying-beach** (grounded/en): "Hello Alex,\n\nThe nearest beach is about 800 meters from the flat, roughly a 10-minute walk. You will also find beach towels and two umbrellas in the entrance closet.\n\n(This reply was prepared by an automated assistant.)"
- **h-en-heat-killing** (grounded/en): "Hello Alex,\n\nThe AC remote is in the living room, inside the TV unit drawer. You can use the MODE button to switch between cooling (snowflake symbol) and heating (sun symbol), and 24°C usually works well.\n\n(This reply was prepared by an automated assistant.)"
- **a-tr-leke-ve-wifi** (complaint/tr): "Merhaba Alex,\n\nWi-Fi ağ adı \"Lale-5G\", şifre ise \"Lale2025\". Yatak odasında çekim zayıfsa aynı şifreyle \"Lale-2G\" ağına da bağlanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **a-en-dirty-checkout** (complaint/en): "Hello Alex,\n\nCheckout time is at 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **a-tr-soguk-su-cop** (complaint/tr): "Merhaba Alex,\n\nÇöpleri binanın arka tarafındaki, otopark girişinin yanındaki konteynerlere bırakabilirsiniz; geri dönüşüm için mavi konteyneri kullanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **p-tr-otopark-nasil-odenir** (grounded/tr): "Merhaba Alex,\n\nOtopark ücreti Gül Sokak üzerindeki açık otoparkın gişesinde ödeniyor, nakit veya kart kullanabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `ebc20009`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f09415b9f560` (öğe + yabancı dil örneği `4c65b500d6d3`) · anlama `696748a8de5b` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
