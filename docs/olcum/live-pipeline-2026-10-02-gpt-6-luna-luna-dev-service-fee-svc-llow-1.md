# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-02)

Durum: **GEÇERLİ** · commit `b960f04` · satır 8/8 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/luna-dev-service-fee.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · düşünme: `OPENAI_REASONING_EFFORT=low`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 7/8 (88%) |
| doğru olgu MİSAFİRE GİDEN metinde | 7/8 (88%) |
| doğru olgu modelin taslağında (gitmese de) | 8/8 (100%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/7 (0%) |
| dil uyumu misafire giden (TR dışı) | 5/5 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/8 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 10.5 sn / 13.0 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0168**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 9 | 3921 | 0 | 0 | 0 |
| gpt-6-luna | 23 | 187102 | 149540 | 5491 | 2864 |
| gpt-5.1-2025-11-13 | 8 | 5346 | 0 | 206 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| fee_service | yes | 7 | 1 | 0 | 7/8 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **svc-01** (fee_service/tr): "Merhaba Alex,\n\nBebek yatağı ve mama sandalyesini yarından itibaren sağlayabiliriz. İkisi birlikte konaklama başına 250 TL’dir; bir gün önceden yazmanız yeterlidir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **svc-02** (fee_service/en): "Hello Alex,\n\nExtra cleaning costs 700 TL and must be requested at least one day in advance. The cleaning team comes during the day and also replaces the towels and sheets.\n\n(This reply was prepared by an automated assistant.)"
- **svc-03** (fee_service/de): "Hallo Alex,\n\nEin privater Flughafentransfer kann über den Gastgeber organisiert werden. Die einfache Fahrt kostet 950 TL für bis zu 4 Personen und 4 Gepäckstücke; die Anfrage muss mindestens einen Tag vorher erfolgen.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **svc-05** (fee_service/ru): "Здравствуйте, Alex!\n\nДополнительную уборку можно запросить не менее чем за день; она стоит 700 TL. Команда приходит в течение дня и меняет полотенца и постельное бельё.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **svc-06** (fee_service/ar): "مرحباً Alex،\n\nيمكن ترتيب النقل الخاص عبر المضيف، وتكلفته 950 ليرة تركية للاتجاه الواحد، لما يصل إلى 4 أشخاص و4 حقائب. يُرجى طلبه قبل يوم واحد على الأقل.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **svc-07** (fee_service/en): "Hello Alex,\n\nA portable baby cot and high chair together cost 250 TL per stay. Please request them one day in advance.\n\n(This reply was prepared by an automated assistant.)"
- **svc-08** (fee_service/tr): "Merhaba Alex,\n\nEk temizlik 700 TL’dir. Konaklamanız sırasında talep ederseniz en az bir gün önceden yazmanız gerekir; temizlik ekibi gün içinde gelir ve havlu ile çarşafları da yeniler.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `b960f04`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | — |
| Üslup özeti | `gpt-6-luna` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
