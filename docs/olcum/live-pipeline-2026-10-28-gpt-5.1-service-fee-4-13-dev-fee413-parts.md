# Canlı hat — misafire giden cevap — gpt-5.1 (2026-10-28)

Durum: **GEÇERLİ** · commit `b651c01c` · satır 22/22 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: `evals/service-fee-4-13-dev.json` · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 7/14 (50%) |
| doğru olgu MİSAFİRE GİDEN metinde | 7/14 (50%) |
| doğru olgu modelin taslağında (gitmese de) | 14/14 (100%) |
| doğru olgu MİSAFİRE GİDEN — KATI | 7/14 (50%) |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | 0/14 (0%) |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/7 (0%) |
| dil uyumu misafire giden (TR dışı) | 4/5 (80%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/8 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 8 · 8 |
| düşen / hata | 0/22 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 8.1 sn / 11.7 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.3228**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 23 | 4440 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 141 | 781704 | 700544 | 13365 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| fee_service | yes | 3 | 5 | 0 | 3/8 | 0 | 0 |
| fee_plain | yes | 4 | 2 | 0 | 4/6 | 0 | 0 |
| money_host | no | 0 | 6 | 0 | 0/0 | 0 | 0 |
| fee_unknown | no | 0 | 2 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_offplatform_payment: 6
- low_confidence_or_risky · items_held · reply_absence: 4
- low_confidence_or_risky · items_held · reply_offplatform_payment: 1
- low_confidence_or_risky · items_held · reply_output_veto: 1
- low_confidence_or_risky · handoff_notice · reply_absence: 1
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 1
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 1

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **svc-03** (fee_service/de): "Hallo Alex,\n\nEin privater Transfer kann organisiert werden; die einfache Fahrt kostet 950 TL für bis zu 4 Personen und 4 Koffer.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **svc-04** (fee_service/es): "Hola Alex,\n\nPodemos proporcionar una cuna de viaje para el bebé a partir de mañana; el servicio de cuna y trona juntos tiene un coste total de 250 TL por estancia.\n\n(Esta respuesta fue preparada por un asistente automático.)"
- **svc-08** (fee_service/tr): "Merhaba Alex,\n\nKonaklama sırasında ek temizlik ücretlidir, bedeli 700 TL’dir. Ek temizlik için en az bir gün önceden haber vermeniz gerekir; temizlik ekibi gün içinde gelip havlu ve çarşafları da yeniler.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **f-10** (fee_plain/tr): "Merhaba Alex,\n\nHavalimanı özel transfer ücreti tek yön 950 TL'dir ve 4 kişi ile 4 valize kadar geçerlidir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **f-11** (fee_plain/en): "Hello Alex,\n\nThe price for an extra cleaning during your stay is 700 TL. This includes a visit from the cleaning team during the day, with fresh towels and bed linens.\n\n(This reply was prepared by an automated assistant.)"
- **f-13** (fee_plain/ar): "مرحباً Alex،\n\nنوفر سرير أطفال قابل للطي مع كرسي طعام للأطفال عند الطلب، وسعرهما معاً 250 ليرة تركية لكل إقامة.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **f-14** (fee_plain/fr): "Bonjour Alex,\n\nHavalimanı için özel transfer tek yön 950 TL’dir; 4 kişi ve 4 valize kadar geçerlidir ve en az bir gün önceden haber vermeniz gerekir.\n\n(Cette réponse a été préparée par un assistant automatique.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `b651c01c`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=1` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `32aa7b5cb535` (öğe + yabancı dil örneği `d722acc7c376`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
