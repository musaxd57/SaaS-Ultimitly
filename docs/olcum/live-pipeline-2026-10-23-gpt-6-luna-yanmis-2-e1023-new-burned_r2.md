# Canlı hat — misafire giden cevap — gpt-6-luna (2026-10-23)

Durum: **GEÇERLİ** · commit `f38da6b2` · satır 50/50 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: YANMIŞ mühürlü set `yanmis-2` (geliştirme verisi; kabul ölçüsü değil) · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=low`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | — |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/34 (0%) |
| dil uyumu misafire giden (TR dışı) | 3/3 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | — |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 1 · 1 |
| düşen / hata | 0/50 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 22.6 sn / 35.4 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.1902**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 55 | 5083 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 98 | 181668 | 141440 | 7550 | 0 |
| gpt-6-luna | 209 | 1277314 | 1083916 | 32893 | 9623 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| rule_exception | any | 5 | 0 | 0 | 0/0 | 0 | 0 |
| two_needs | any | 2 | 1 | 0 | 0/0 | 0 | 0 |
| season_stay | any | 5 | 1 | 0 | 0/0 | 0 | 0 |
| topic_only | any | 1 | 4 | 0 | 0/0 | 0 | 0 |
| cross_item | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| source_question | any | 1 | 3 | 0 | 0/0 | 0 | 0 |
| plain | any | 3 | 1 | 0 | 0/0 | 0 | 0 |
| closed_note | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| multi_lang | any | 3 | 3 | 0 | 0/0 | 0 | 0 |
| prior_context | any | 1 | 1 | 0 | 0/0 | 0 | 0 |
| three_needs | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| season_named_date | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| polarity | any | 3 | 1 | 0 | 0/0 | 0 | 0 |
| exception_day_asked | any | 2 | 0 | 0 | 0/0 | 0 | 0 |
| negative_kb | any | 0 | 1 | 0 | 0/0 | 0 | 0 |
| charged_note | any | 1 | 0 | 0 | 0/0 | 0 | 0 |
| only_exception | any | 1 | 0 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · items_nothing_answered: 11
- low_confidence_or_risky · low_confidence_or_risky · low_confidence: 2
- low_confidence_or_risky · items_held · items_nothing_answered: 2
- low_confidence_or_risky · items_held · reply_output_veto: 1

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 40/55 (73%) |
| açık kalması gereken ihtiyaç: açık kaldı | 16/16 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 1 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 14 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 52/66 (79%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 34/50 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| k-tr-001 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-002 | wifi:answered✔ amenities:open✔ | amenities=open wifi=answered | R1=verified R2=no_info |
| k-tr-003 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-004 | amenities:open✔ | amenities=open | R1=no_info |
| k-tr-005 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-006 | about_assistant:open✔ wifi:answered✖ | about_assistant=pending_host wifi=open | R1=rejected(reader_unread) |
| k-tr-007 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-008 | checkin_time:answered✔ | checkin_time=answered | R1=verified |
| k-tr-009 | amenities:answered✔ | amenities=answered | R1=verified |
| k-en-001 | amenities:answered✖ wifi:answered✖ | amenities=open wifi=open | R1=rejected(reader_unread) R2=rejected(reader_unread) |
| k-tr-010 | amenities:answered✖ | amenities=open | R1=rejected(reader_unread) |
| k-tr-011 | parking:answered✔ local_recommendations:open✔ checkout_time:answered✔ | checkout_time=answered local_recommendations=open parking=answered | R1=verified R2=no_info R3=verified |
| k-tr-012 | amenities:open✔ | amenities=open | R1=no_info |
| k-tr-013 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-014 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-015 | amenities:answered✔ | amenities=answered | R1=verified |
| k-de-001 | amenities:answered✖ local_recommendations:open✔ | amenities=open local_recommendations=open | R1=verified R2=no_info |
| k-tr-016 | about_assistant:open✔ amenities:answered✖ | amenities=open about_assistant=pending_host | R1=rejected(reader_binding) |
| k-tr-017 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-018 | amenities:answered✔ other:open✔ | amenities=open amenities=answered | R1=verified R2=no_info |
| k-tr-019 | directions_transport:answered✔ | directions_transport=answered | R1=verified |
| k-tr-020 | amenities:open✔ | local_recommendations=open | R1=no_info |
| k-tr-021 | house_rules:answered✔ | house_rules=answered | R1=verified |
| k-tr-022 | amenities:answered✔ wifi:answered✔ | amenities=answered wifi=answered | R1=verified R2=verified |
| k-ru-001 | amenities:answered✖ wifi:answered✔ | amenities=open wifi=answered | R1=rejected(value_not_in_evidence) R2=verified |
| k-tr-023 | house_rules:answered✔ wifi:answered✔ | house_rules=answered wifi=answered | R1=verified R2=verified |
| k-tr-024 | appliance_help:answered✔ | appliance_help=answered | R1=verified |
| k-tr-025 | amenities:answered✖ local_recommendations:open✔ | amenities=open local_recommendations=open | R1=rejected(reader_unread) R2=no_info |
| k-tr-026 | amenities:answered✔ | local_recommendations=answered | R1=verified |
| k-tr-027 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-028 | amenities:open✔ | amenities=open | R1=no_info |
| k-es-001 | amenities:answered✔ checkout_time:answered✔ | amenities=answered checkout_time=answered | R1=verified R2=verified |
| k-tr-029 | parking:answered✔ | parking=answered | R1=verified |
| k-tr-030 | about_assistant:open✔ amenities:answered✔ | about_assistant=pending_host amenities=answered | R1=verified |
| k-tr-031 | house_rules:answered✔ | house_rules=answered | R1=verified |
| k-tr-032 | amenities:answered✖ local_recommendations:open✔ | amenities=open local_recommendations=open | R1=verified R2=no_info |
| k-tr-033 | amenities:answered✖ | amenities=open | R1=rejected(reader_unread) |
| k-tr-034 | parking:answered✔ | parking=answered | R1=verified |
| k-fr-001 | amenities:answered✖ wifi:answered✔ | amenities=answered wifi=answered | R1=verified R2=verified |
| k-tr-035 | amenities:answered✔ checkin_time:answered✔ | amenities=open checkin_time=answered | R1=verified R2=verified |
| k-tr-036 | directions_transport:open✔ wifi:answered✔ | directions_transport=open wifi=answered | R1=no_info R2=verified |
| k-tr-037 | house_rules:answered✖ | house_rules=pending_host | — |
| k-en-002 | about_assistant:open✔ checkout_time:answered✖ | about_assistant=pending_host checkout_time=pending_host | — |
| k-tr-038 | trash:answered✔ | trash=answered | R1=verified |
| k-tr-039 | directions_transport:answered✔ | directions_transport=answered | R1=verified |
| k-tr-040 | amenities:answered✔ | amenities=answered | R1=verified |
| k-tr-041 | house_rules:answered✔ directions_transport:answered✔ local_recommendations:open✔ | local_recommendations=open house_rules=answered directions_transport=answered | R1=verified R2=verified R3=no_info |
| k-en-003 | directions_transport:answered✖ | directions_transport=open | R1=rejected(reader_unread) |
| k-tr-042 | other:answered✖ | payment_invoice=pending_host | — |
| k-tr-043 | amenities:answered✔ | amenities=answered | R1=verified |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **k-tr-001** (rule_exception/tr): "Merhaba Alex,\n\nHafta içi havuz 22:00'ye kadar açık. Cumartesi ve pazar günleri ise 23:00'e kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-002** (two_needs/tr): "Merhaba Alex,\n\nWi-Fi ağının adı Lale_Ev, şifresi menekse2026.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-003** (season_stay/tr): "Merhaba Alex,\n\nYarın açık havuz 10:00–17:00 arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-005** (cross_item/tr): "Merhaba Alex,\n\nSauna her gün 15:00–21:00 arası açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-007** (rule_exception/tr): "Merhaba Alex,\n\nHavuz her gün 09:00'da açılıyor; pazartesi günleri temizlik nedeniyle 13:00'te açılıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-008** (plain/tr): "Merhaba Alex,\n\nGiriş saatimiz 15:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-009** (closed_note/tr): "Merhaba Alex,\n\nSauna 20 Ekim–5 Kasım 2026 tarihleri arasında bakım nedeniyle kapalı. Normalde her gün 16:00–22:00 arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-011** (three_needs/tr): "Merhaba Alex,\n\nOtopark misafirlerimiz için ücretsizdir; dairenize ayrılan yer 12 numaralıdır.\nÇıkış saati 11:00’dir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-013** (season_named_date/tr): "Temmuzda açık havuz 20:00'ye kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-014** (polarity/tr): "Merhaba Alex,\n\nHamam kullanımı kişi başı 200 TL'dir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-015** (rule_exception/tr): "Merhaba Alex,\n\nSpor salonu her gün 22:00'ye kadar; pazar günleri 18:00'e kadar açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-017** (exception_day_asked/tr): "Merhaba Alex,\n\nCumartesi günleri havuz 23:00'e kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-018** (two_needs/tr): "Merhaba Alex,\n\nHavuz her gün 08:00–20:00 arası açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-019** (season_stay/tr): "Merhaba Alex,\n\nEkim–Mayıs arasında plaj servisi 10:00 ve 16:00'da kalkıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-021** (polarity/tr): "Merhaba Alex,\n\nBalkonda mangal yapmak yasak.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-022** (closed_note/tr): "Merhaba Alex,\n\nKurutma makinesi şu an arızalı, yalnızca yıkama yapılabiliyor.\nWi-Fi şifresi portakal55.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-ru-001** (multi_lang/ru): "Здравствуйте, Alex!\n\nПароль Wi-Fi: portakal55.\n\n(Этот ответ подготовлен автоматическим ассистентом.)"
- **k-tr-023** (rule_exception/tr): "Merhaba Alex,\n\nSessizlik kuralı her gece 22:00'de, cuma ve cumartesi geceleri ise 23:30'da başlıyor.\nWi-Fi şifresi gunes7788.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-024** (plain/tr): "Merhaba Alex,\n\nKlima kumandası yatak odasındaki komodinin çekmecesindedir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-026** (season_stay/tr): "Merhaba Alex,\n\nPlaj barı yalnızca 15 Mayıs–15 Ekim arasında hizmet veriyor; şu an açık değil.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-027** (exception_day_asked/tr): "Merhaba Alex,\n\nPazar günleri spor salonu 10:00'da açılıyor ve 18:00'e kadar açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-es-001** (multi_lang/es): "Hola Alex,\n\nLa sauna es gratuita para los huéspedes.\nLa hora de salida es a las 11:00.\n\n(Esta respuesta fue preparada por un asistente automático.)"
- **k-tr-029** (polarity/tr): "Merhaba Alex,\n\nHayır, daireye ait otopark yoktur. Sokakta ücretli park alanı vardır, saatlik ücret 30 TL'dir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-030** (source_question/tr): "Merhaba Alex,\n\nSpor salonu her gün 06:00–23:00 arası açıktır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-031** (prior_context/tr): "Sessizlik kuralı her gece 22:00'de başlıyor; cuma ve cumartesi geceleri ise 23:30'da başlıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-034** (charged_note/tr): "Merhaba Alex,\n\nKapalı otoparkta daireniz için bir araçlık yer ücretsiz; ikinci araç için günlük 100 TL ücret alınır.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-fr-001** (multi_lang/fr): "Bonjour Alex,\n\nLa résidence ne dispose ni de sauna ni de hammam.\nLe mot de passe du Wi-Fi est deniz4821.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **k-tr-035** (only_exception/tr): "Merhaba Alex,\n\nSite kafesi pazar günleri 12:00'de açılır.\nGiriş saati 15:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-036** (topic_only/tr): "Merhaba Alex,\n\nWi-Fi şifresi: menekse2026.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-038** (rule_exception/tr): "Merhaba Alex,\n\nÇöpleri her akşam 20:00'den sonra kapınızın önüne bırakabilirsiniz; görevli topluyor. Pazar günleri çöp toplanmadığı için çöpleri otoparktaki büyük konteynere atabilirsiniz.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-039** (plain/tr): "Merhaba Alex,\n\nHavalimanı otobüsü site önündeki duraktan kalkıyor; bilet 120 TL.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-040** (season_stay/tr): "Merhaba Alex,\n\nHaziranda açık havuz 08:00'de açılıyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-041** (three_needs/tr): "Merhaba Alex,\n\nÇatı terasında cam şişe kullanmak yasaktır.\nHavalimanı otobüsünün bileti 120 TL'dir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **k-tr-043** (season_stay/tr): "Merhaba Alex,\n\nSauna normalde her gün 16:00–22:00 arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `f38da6b2`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-6-luna` | low |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=1` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=1` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=1` · `AI_SENIOR_READER_ENABLED=1` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `2b496c12ffea` (öğe + yabancı dil örneği `25e9d9671cd2`) · anlama `dbf61aecd3d8` (kip: items+rules+cfu+prv)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
