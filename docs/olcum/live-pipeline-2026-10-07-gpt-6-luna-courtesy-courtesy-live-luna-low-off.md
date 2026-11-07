# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-07)

Durum: **GEÇERLİ** · commit `1af1756` · satır 12/12 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/courtesy.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=low`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 7/8 (88%) |
| doğru olgu MİSAFİRE GİDEN metinde | 3/3 (100%) |
| doğru olgu modelin taslağında (gitmese de) | 3/3 (100%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/8 (0%) |
| dil uyumu misafire giden (TR dışı) | 4/4 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/3 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 4 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| düşen / hata | 0/12 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 7.4 sn / 8.5 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.0450**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 9 | 2044 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 24 | 41253 | 33536 | 1986 | 0 |
| gpt-6-luna | 11 | 219924 | 137860 | 3268 | 1796 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| courtesy_only | yes | 3 | 1 | 0 | 0/0 | 1 | 0 |
| courtesy_question | yes | 2 | 0 | 0 | 2/2 | 2 | 0 |
| courtesy_repoke | yes | 2 | 0 | 0 | 1/1 | 1 | 0 |
| courtesy_repeat | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| courtesy_complaint | no | 0 | 1 | 0 | 0/0 | 0 | 0 |
| courtesy_sensitive | no | 0 | 1 | 0 | 0/0 | 0 | 0 |
| closing_control | no | 0 | 1 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1
- low_confidence_or_risky · items_held · reply_output_veto: 1
- low_confidence_or_risky · handoff_notice · reply_output_veto: 1
- closing_ack_open · closing_ack: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **c-en-ilk-selam** (courtesy_only/en): "Hello Alex,\n\nI'm doing well, thank you for asking.\n\n(This reply was prepared by an automated assistant.)"
- **c-de-ilk-selam** (courtesy_only/de): "Hallo Alex,\n\nDanke der Nachfrage.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **c-ru-ilk-selam** (courtesy_only/ru): "Здравствуйте, Alex!\n\nСпасибо, что спросили.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **c-tr-selam-soru** (courtesy_question/tr): "Merhaba Alex,\n\nİyiyiz, teşekkürler. Wi-Fi ağımız Lale-5G, şifresi Lale2025!.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-en-selam-soru** (courtesy_question/en): "Hello Alex,\n\nI'm doing well, thank you. Check-out is at 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **c-tr-yeniden-yoklama** (courtesy_repoke/tr): "Merhaba Alex,\n\nBinanın kendi otoparkı yok; 200 m ileride Gül Sokak üzerinde günlük 150 TL ücretli açık otopark bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-cevap-vermiyorsun** (courtesy_repoke/tr): "İyiyim, teşekkür ederim.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **c-tr-tekrar-halhatir** (courtesy_repeat/tr): "Teşekkür ederim, naziksiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `1af1756`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` (öğe + yabancı dil örneği `6772725db6f1`) · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
