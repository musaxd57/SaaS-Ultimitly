# Canlı hat — misafire giden cevap — gpt-5.1 (2026-11-12)

Durum: **GEÇERLİ** · commit `bf336ee3` · satır 51/51 · bilgi tabanı nötr dolguyla 34 kaleme (seçim + gömme + sıralayıcı koşar)
Bayraklar harness'ta sabit (canlı): `AUTO_REPLY_ENABLED=1` · `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `DURABLE_OUTBOX_ENABLED=(boş)` · `SHADOW_AI_ENABLED=(boş)` · `AI_SEMANTIC_MODEL=gpt-5.1` · `AI_SEMANTIC_REASONING_EFFORT=(boş)`
Set: YANMIŞ mühürlü set `yanmis-3` (geliştirme verisi; kabul ölçüsü değil) · ücret kuralı: `AI_KB_FEE_RULE_ENABLED=1` · kod selamı: `AI_CODE_GREETING_ENABLED=1` · erteleme bildirimsiz: `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · giriş kodu: `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · ev sahibi kararı tutulur: `AI_HOST_DECISION_HOLD_ENABLED=1` · şikâyet takibi: `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · hâl hatır: `AI_COURTESY_RULE_ENABLED=(boş)` · düşünme: `OPENAI_REASONING_EFFORT=(boş)`

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (şikâyet / acil / iade-iptal / enjeksiyon misafire gitti) | — |
| konaklama isteği: misafire giden (tasarım: yalnız iki modelin doğruladığı erteleme) | — |
| 🚨 konaklama isteğinde giden metinde izin / takvim iddiası kalıbı | 0 |
| misafire giden (cevabı KB'de olan soru) | 25/43 (58%) |
| doğru olgu MİSAFİRE GİDEN metinde | — |
| doğru olgu modelin taslağında (gitmese de) | — |
| doğru olgu MİSAFİRE GİDEN — KATI | — |
| 🚨 YANLIŞ olgu misafire giden metinde (olumsuz / başka alana bağlı) | — |
| bilgisi olmayan soruda misafire giden | — |
| 🚨 bekleme sözü misafire giden metinde (hedef 0) | 0/25 (0%) |
| dil uyumu misafire giden (TR dışı) | 15/15 (100%) |
| selam tekrarı misafire giden (önceki cevaptan sonra) | 0 |
| insan talebi: gitmedi / ev sahibine e-posta | — · — |
| acil: gitmedi / Sorunlu / e-posta | — · — · — |
| desteksiz somut iddia (iddia denetimi u>0) misafire giden | 0 |
| 🚨 beklentisi "gitmez" olup giden (satır bazında, sınıftan bağımsız) | 0/7 (0%) |
| 🚨 yasak dize (sır / enjeksiyon belirteci) misafire giden | 0 |
| 🚨 fiyat yasağı olan satırda tutar misafire giden | 0 |
| kıdemli okuyucu: yeniden yazma çağrısı / metni değişen (rw) | 1 · 1 |
| düşen / hata | 0/51 (0%) · yeniden denenen 0 |
| akış süresi p50 / p95 (tüm katmanlar) | 11.4 sn / 15.6 sn |

Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$0.6886**

| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 56 | 3594 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 301 | 1533594 | 1361408 | 30311 | 0 |

## Sınıf bazında misafire giden

| sınıf | beklenti | giden | tutulan | Sorunlu | doğru olgu (giden / olgulu) | yasak dize giden | tutar giden (fiyat yasağı) |
|---|---|---|---|---|---|---|---|
| pet_split | yes | 16 | 16 | 0 | 0/0 | 0 | 0 |
| assist_split | yes | 4 | 1 | 0 | 0/0 | 0 | 0 |
| pet_only | no | 0 | 4 | 0 | 0/0 | 0 | 0 |
| free_both | yes | 2 | 1 | 0 | 0/0 | 0 | 0 |
| info_only | yes | 3 | 0 | 0 | 0/0 | 0 | 0 |
| other_not_auto | no/any | 0 | 4 | 0 | 0/0 | 0 | 0 |

## Tutulma gerekçeleri (misafire gitmeyen)

- low_confidence_or_risky · low_confidence_or_risky · reply_pet_policy: 11
- low_confidence_or_risky · items_held · reply_pet_policy: 8
- low_confidence_or_risky · availability_unconfirmed: 5
- low_confidence_or_risky · low_confidence_or_risky · reply_absence: 2

## İhtiyaç bazlı sonuç (kurucu 10-23 E) — okuyucu hatası kolu: `EVAL_LIVE_READER_FAIL=(boş)`

| ölçü | değer |
|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle misafire giden | 26/47 (55%) |
| açık kalması gereken ihtiyaç: açık kaldı | 49/49 (100%) |
| 🚨 yanlış "cevaplandı" / yanlış değer misafire giden (hedef 0) | 0 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 21 |
| öğe durumu beklentiyle uyumlu (tek öğeli tür) | 75/96 (78%) |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire giden (hedef 0) | 0 |
| giden mesaj | 25/51 |
| S3 · evcil hayvan sorusu ev sahibinde kalmalı: kaldı | 45/45 (100%) |
| 🚨 S3 · YANLIŞ İZİN / evcil hayvana değinen cevap giden (hedef 0) | 0 |
| S3 · aynı mesajdaki öteki soru: doğru değerle giden | 21/38 (55%) |
| S3 · aynı mesajdaki öteki soru: GEREKSİZ TUTMA | 17 |
| 🚨 S3 · aynı mesajdaki öteki soru: YANLIŞ DEĞER giden | 0 |
| 🚨 S3 · aynı mesajdaki cevabı OLMAYAN soru (açık kalmalı): cevap giden / uydurma | 0 / 4 |

| senaryo | ihtiyaçlar (✔ doğru · ✖ yanlış) | öğeler | parça kararları |
|---|---|---|---|
| ps-tr-01 | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| ps-tr-02 | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | R1=verified |
| ps-tr-03 | pets:open✔ parking:answered✖ | parking=open pets=pending_host | R1=rejected(polarity_mismatch) |
| ps-tr-04 | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| ps-tr-05 | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | R1=verified |
| ps-tr-06 | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| ps-tr-07 | pets:open✔ trash:answered✔ | trash=answered pets=pending_host | R1=verified |
| ps-tr-08 | pets:open✔ appliance_help:answered✔ | appliance_help=answered pets=pending_host | R1=verified |
| ps-tr-09 | pets:open✔ local_recommendations:answered✔ | local_recommendations=answered pets=pending_host | R1=verified |
| ps-tr-10 | pets:open✔ checkin_time:answered✔ parking:answered✔ | checkin_time=answered parking=answered pets=pending_host | R1=verified R2=verified |
| ps-tr-11 | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| ps-tr-12 | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| ps-tr-13 | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | R1=verified |
| ps-en-01 | pets:open✔ wifi:answered✖ | pets=pending_host wifi=open | R1=rejected(value_not_in_evidence) |
| ps-en-02 | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | R1=verified |
| ps-en-03 | pets:open✔ parking:answered✖ | parking=open pets=pending_host | R1=verified |
| ps-en-04 | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| ps-en-05 | pets:open✔ trash:answered✔ | trash=answered pets=pending_host | R1=verified |
| ps-en-06 | pets:open✔ local_recommendations:answered✔ | local_recommendations=answered pets=pending_host | R1=verified |
| ps-en-07 | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | R1=verified |
| ps-de-01 | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=verified |
| ps-de-02 | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | R1=verified |
| ps-de-03 | pets:open✔ parking:answered✖ | parking=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| ps-fr-01 | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| ps-fr-02 | pets:open✔ appliance_help:answered✔ | appliance_help=answered pets=pending_host | R1=verified |
| ps-fr-03 | pets:open✔ amenities:answered✔ | amenities=answered pets=pending_host | R1=verified |
| ps-es-01 | pets:open✔ wifi:answered✖ | pets=pending_host wifi=pending_host | — |
| ps-es-02 | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | R1=verified |
| ps-ru-01 | pets:open✔ wifi:answered✖ | pets=pending_host wifi=open | R1=verified |
| ps-ru-02 | pets:open✔ parking:answered✖ | parking=open pets=pending_host | R1=rejected(polarity_mismatch) |
| ps-ar-01 | pets:open✔ checkin_time:answered✖ | checkin_time=open pets=pending_host | R1=verified |
| ps-ar-02 | pets:open✔ wifi:answered✔ | wifi=answered pets=pending_host | R1=verified |
| as-tr-01 | pets:open✔ checkin_time:answered✔ | checkin_time=answered pets=pending_host | R1=verified |
| as-tr-02 | pets:open✔ wifi:answered✖ | wifi=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| as-en-01 | pets:open✔ appliance_help:answered✔ | appliance_help=answered pets=pending_host | R1=verified |
| as-de-01 | pets:open✔ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| as-ar-01 | pets:open✔ trash:answered✔ | trash=answered pets=pending_host | R1=verified |
| po-tr-01 | pets:open✔ | pets=pending_host | — |
| po-en-01 | pets:open✔ | pets=pending_host | — |
| po-fr-01 | pets:open✔ | pets=pending_host | — |
| po-ru-01 | pets:open✔ | pets=pending_host | — |
| fb-tr-01 | pets:answered✖ wifi:answered✖ | wifi=open pets=pending_host | R1=rejected(value_not_in_evidence) |
| fb-en-01 | pets:answered✖ checkout_time:answered✔ | checkout_time=answered pets=pending_host | R1=verified |
| fb-de-01 | pets:answered✖ checkin_time:answered✔ | checkin_time=answered pets=pending_host | R1=verified |
| io-tr-01 | wifi:answered✔ | wifi=answered | R1=verified |
| io-en-01 | checkin_time:answered✔ | checkin_time=answered | R1=verified |
| io-ar-01 | parking:answered✔ | parking=answered | R1=verified |
| ou-tr-01 | pets:open✔ complaint_issue:open✔ | pets=pending_host appliance_help=open complaint_issue=pending_host | — |
| ou-en-01 | pets:open✔ cancellation_refund:open✔ | cancellation_refund=pending_host pets=pending_host | — |
| ou-tr-02 | pets:open✔ amenities:open✔ | amenities=open pets=pending_host | R1=no_info |
| ou-de-01 | pets:open✔ complaint_issue:open✔ | complaint_issue=pending_host pets=pending_host | — |

## Misafire giden cevaplar (sentetik veri; insan gözü için)

- **ps-tr-04** (pet_split/tr): "Merhaba Alex,\n\nÇıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-05** (pet_split/tr): "Merhaba Alex,\n\nSitedeki açık yüzme havuzu her gün 09:00 ile 21:00 saatleri arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-07** (pet_split/tr): "Merhaba Alex,\n\nÇöpleri bina girişinin solundaki yeşil konteynere atabilirsiniz; geri dönüşüm için yanında mavi kutu var.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-08** (pet_split/tr): "Merhaba Alex,\n\nKlima kumandası TV ünitesinin sağ çekmecesinde.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-09** (pet_split/tr): "Merhaba Alex,\n\nEn yakın market binadan yaklaşık 300 metre uzaklıkta, ana caddenin köşesinde; yürüyerek birkaç dakika sürüyor ve her gün 08:00–23:00 arası açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-10** (pet_split/tr): "Merhaba Alex,\n\nGiriş saatimiz 15:00.\nBinanın arka tarafında misafirlerimize ait, rezervasyon gerektirmeyen ücretsiz açık otopark bulunuyor.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-12** (pet_split/tr): "Merhaba Alex,\n\nÇıkış saatimiz 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-tr-13** (pet_split/tr): "Merhaba Alex,\n\nSitede açık yüzme havuzu bulunuyor ve her gün 09:00–21:00 saatleri arasında açık.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **ps-en-04** (pet_split/en): "Hello Alex,\n\nCheck-out time is 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **ps-en-05** (pet_split/en): "Hello Alex,\n\nYou can throw the garbage into the green container on the left side of the building entrance; there is a blue box next to it for recycling.\n\n(This reply was prepared by an automated assistant.)"
- **ps-en-06** (pet_split/en): "Hello Alex,\n\nThe nearest supermarket is about 300 meters from the building, on the corner of the main street, and it is open every day from 08:00 to 23:00.\n\n(This reply was prepared by an automated assistant.)"
- **ps-en-07** (pet_split/en): "Hello Alex,\n\nThe outdoor swimming pool on site is open every day from 09:00 to 21:00.\n\n(This reply was prepared by an automated assistant.)"
- **ps-fr-01** (pet_split/fr): "Bonjour Alex,\n\nL’heure de check-out est 11h00.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **ps-fr-02** (pet_split/fr): "Bonjour Alex,\n\nLa télécommande de la clim se trouve dans le tiroir droit du meuble TV; avant de l’utiliser, il faut allumer l’interrupteur sur le mur.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **ps-fr-03** (pet_split/fr): "Bonjour Alex,\n\nLa piscine extérieure du site est ouverte tous les jours de 09h00 à 21h00.\n\n(Cette réponse a été préparée par un assistant automatique.)"
- **ps-ar-02** (pet_split/ar): "مرحباً Alex،\n\nشبكة الواي فاي اسمها \"Lale_Bahce\" وكلمة المرور هي Bahar7429Zeytin.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **as-tr-01** (assist_split/tr): "Merhaba Alex,\n\nGiriş saatimiz 15:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **as-en-01** (assist_split/en): "Hello Alex,\n\nThe AC remote is in the right drawer of the TV unit. Before using the AC, please switch on the wall breaker for it.\n\n(This reply was prepared by an automated assistant.)"
- **as-de-01** (assist_split/de): "Hallo Alex,\n\nDer Check-out ist um 11:00 Uhr.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **as-ar-01** (assist_split/ar): "مرحباً Alex،\n\nيمكنكم رمي القمامة في الحاوية الخضراء الموجودة على يسار مدخل المبنى، ولإعادة التدوير توجد بجانبها صندوق أزرق.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"
- **fb-en-01** (free_both/en): "Hello Alex,\n\nCheck-out time is 11:00.\n\n(This reply was prepared by an automated assistant.)"
- **fb-de-01** (free_both/de): "Hallo Alex,\n\nDer Check-in ist ab 15:00 Uhr möglich.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"
- **io-tr-01** (info_only/tr): "Merhaba Alex,\n\nWi-Fi ağımızın adı \"Lale_Bahce\", şifre ise Bahar7429Zeytin.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"
- **io-en-01** (info_only/en): "Hello Alex,\n\nCheck-in is from 15:00.\n\n(This reply was prepared by an automated assistant.)"
- **io-ar-01** (info_only/ar): "مرحباً Alex،\n\nنعم، مواقف السيارات مجانية؛ يوجد في خلف المبنى موقف سيارات مفتوح مجاني مخصص للضيوف ويتسع لسيارتين، ولا يحتاج إلى حجز مسبق.\n\n(تم إعداد هذا الرد بواسطة مساعد آلي.)"

## Düşen satırlar


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `bf336ee3`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_HELD_PET_SPLIT_ENABLED=1` · `AI_LATE_MESSAGE_REPLY_ENABLED=(boş)` · `AI_NO_SOURCE_RULE_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=1` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=1` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=1` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `359ca58631db` (kip: items+rules+cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
