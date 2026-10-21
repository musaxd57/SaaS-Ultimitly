# Anlama ölçümü — understanding-e2e-dev.json — kol live (2026-10-21)

Durum: **GEÇERLİ** · senaryo 54/54 · istek 75 · denetçi gpt-5.1 · tahmini maliyet $0.51

Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.

### Anlama (modelin kendisi — ilişki işareti varsayılmadı)

| ölçü | değer |
|---|---|
| beklenen istek bulundu (niyet + mesaj) | 68/73 (93%) |
| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | 2/73 (3%) |
| 🚨 kaçan istek | 3/73 (4%) |
| fazla istek (beklenende karşılığı yok) | 7 |
| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | 61/68 (90%) |
| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | 7/7 · 0 |
| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | 8/9 · 0 · 1 |
| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | 1/1 · 0 |

### Son misafir sonucu (istek bazında)

| beklenen | sonuç | değer |
|---|---|---|
| cevap | doğru (olgu bağı doğrulandı) | 34/44 (77%) |
| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | 2/44 (5%) |
| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | 2/44 (5%) |
| cevap | gereksiz tutuldu — ev sahibinde açık | 6/44 (14%) |
| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | 0/44 (0%) |
| tut | doğru tutuldu — ev sahibinde açık | 22/23 (96%) |
| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | 0/23 (0%) |
| tut | 🚨 tutuldu ama sessiz düştü | 1/23 (4%) |
| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | 6/6 (100%) |
| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | 0 / 0 |
| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | 6/8 (75%) |
| senaryo | bütün istekleri doğru | 44/53 (83%) |
| 🚨 yasak dize misafire giden | 0 | |

### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)

| destek | sayı |
|---|---|
| supported | 63 |
| misbound | 0 |
| contradicted | 0 |
| unsupported | 0 |
| unverified | 5 |
| process | 32 |
| denetçi düştü | 0 |

### Etiket / dil kırılımı (istek doğru)

| kırılım | doğru |
|---|---|
| complaint_ambiguous | 2/2 (100%) |
| complaint_dependent | 5/5 (100%) |
| complaint_independent | 14/14 (100%) |
| conditional | 4/6 (67%) |
| cross_language | 10/11 (91%) |
| emergency | 6/6 (100%) |
| fee | 9/10 (90%) |
| fix_hazard | 2/2 (100%) |
| fix_no_recipe | 2/2 (100%) |
| fix_recipe | 4/6 (67%) |
| human_request | 2/2 (100%) |
| kb_missing | 1/1 (100%) |
| kb_present | 1/1 (100%) |
| multi_message | 2/2 (100%) |
| multi_turn | 6/7 (86%) |
| neighbor_entity | 8/10 (80%) |
| permission | 3/5 (60%) |
| refund | 2/2 (100%) |
| relation_type | 4/6 (67%) |
| safety | 3/3 (100%) |
| same_words | 20/21 (95%) |
| stay_change | 3/3 (100%) |
| withdrawn | 1/1 (100%) |
| dil ar | 1/1 (100%) |
| dil de | 2/3 (67%) |
| dil en | 9/10 (90%) |
| dil es | 1/3 (33%) |
| dil fr | 0/1 (0%) |
| dil ru | 1/1 (100%) |
| dil tr | 50/54 (93%) |

### Model kullanımı

| model | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 56 | 4582 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 145 | 234665 | 177280 | 38571 | 18444 |
| gpt-6-luna | 93 | 1123356 | 984824 | 18511 | 6749 |

## Hatalı istekler (ayrıntı)

### d-sauna-notice-tr (tr) — durum new, gitti hayır, low_confidence_or_risky
- mesaj: "Saunayı kullanmak istiyoruz; ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz?"
- model istekleri: amenities/own_topic@1 "sauna kullanım süresi rezervasyon"
- öğeler: amenities:open@1 · getirilen: sauna,boiler,bike,checkout,checkin
- **r1** beklenen answer/none → **held_open** · çıkarım found (amenities/own_topic) · denetçi - · öğe open · olgu missing,missing · yanlış bağ 0 · parça "ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz"
- taslak (gitmedi): "Merhaba Alex,\n\nSauna için en az 2 saat önceden resepsiyona haber vermeniz gerekiyor. Her rezervasyon 1 saat sürüyor."

### d-loft-spa-de (de) — durum answered, gitti evet
- mesaj: "Wie lange im Voraus müssen wir eine Massage buchen und wie lange dauert sie?"
- model istekleri: amenities/own_topic@1 "Massage buchen Dauer Reservierung"
- öğeler: amenities:answered@1 · getirilen: spa
- **r1** beklenen answer/none → **wrong_info** · çıkarım found (amenities/own_topic) · denetçi answered · öğe answered · olgu ok,ok · yanlış bağ 1 · parça "Wie lange im Voraus müssen wir eine Massage buchen und wie lange dauert sie"
- giden: "Hallo Alex,\n\nEine Massage muss mindestens 3 Stunden im Voraus gebucht werden und dauert 60 Minuten.\n\n(Diese Antwort wurde von einem automatischen Assistenten erstellt.)"

### d-loft-garage-fr (fr) — durum new, gitti hayır, low_confidence_or_risky (low_confidence)
- mesaj: "Le parking est-il gratuit pendant la semaine ?"
- model istekleri: parking/own_topic@1 "parking gratuit en semaine"
- öğeler: parking:open@1 · getirilen: parking,latecheckout
- **r1** beklenen answer/none → **held_open** · çıkarım found (parking/own_topic) · denetçi - · öğe open · olgu missing · yanlış bağ 0 · parça "Le parking est-il gratuit pendant la semaine"
- taslak (gitmedi): "Bonjour Alex,\n\nVotre hôte pourra vous confirmer si le stationnement est gratuit en semaine."

### d-loft-bike-es (es) — durum new, gitti hayır, low_confidence_or_risky (items_nothing_answered)
- mesaj: "¿Hasta qué hora hay que devolver las bicicletas?"
- model istekleri: amenities/own_topic@1 "hora devolución bicicletas"
- öğeler: amenities:pending_host@1 · getirilen: bikes
- **r1** beklenen answer/none → **held_open** · çıkarım found (amenities/own_topic) · denetçi - · öğe pending_host · olgu missing · yanlış bağ 0 · parça "Hasta qué hora hay que devolver las bicicletas"
- taslak (gitmedi): "Hola Alex,\n\nHay que devolver las bicicletas antes de las 21:00."

### d-loft-quiet-en (en) — durum new, gitti hayır, low_confidence_or_risky (model_risk_label)
- mesaj: "Can we play some music on the balcony around 10:30 pm tonight?"
- model istekleri: house_rules/own_topic@1 "music on the balcony at 10:30 pm noise rules"
- öğeler: house_rules:pending_host@1 · getirilen: quiet,pets,breakfast,gym
- **r1** beklenen answer/none → **held_open** · çıkarım found (house_rules/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "Can we play some music on the balcony around 10:30 pm tonight"
- taslak (gitmedi): "Hello Alex,\n\nQuiet hours are from 22:00 to 07:00, and music on the balcony is not allowed during those hours."

### d-pets-big-tr (tr, çift P-pets) — durum new, gitti hayır, low_confidence_or_risky (reply_output_veto)
- mesaj: "25 kiloluk köpeğimizi de getirebilir miyiz?"
- model istekleri: pets/own_topic@1 "evcil hayvan köpek kabul politikası"
- öğeler: pets:pending_host@1 · getirilen: pets,terrace,quiet
- **r1** beklenen answer/none → **held_open** · çıkarım found (pets/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "25 kiloluk köpeğimizi de getirebilir miyiz"
- taslak (gitmedi): "Merhaba Alex,\n\nEvcil hayvanla konaklama bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."

### d-ac-cool-tr (tr, çift P-ac) — durum new, gitti hayır, low_confidence_or_risky (items_fix_unverified)
- mesaj: "Klima çalışmıyor, odayı nasıl soğutacağız?"
- model istekleri: complaint_issue/own_topic@1 "klima çalışmıyor şikayet" · appliance_help/fix_request@1 "klima çalışmıyor çözüm"
- öğeler: appliance_help:open@1 · complaint_issue:pending_host@1 · getirilen: ac,boiler,stove
- **r2** beklenen answer/dependent → **held_open** · çıkarım found (appliance_help/fix_request) · denetçi - · öğe open+pending_host · olgu missing · yanlış bağ 0 · parça "odayı nasıl soğutacağız"
- taslak (gitmedi): "Merhaba Alex,\n\nKlima kumandası komodinin çekmecesinde. Soğutma için MODE tuşuyla kar tanesi simgesini seçebilirsiniz; önerilen sıcaklık 22 derecedir. Pencereler açıkken klima otomatik olarak durur."

### d-fuse-fix-tr (tr, çift P-fix) — DÜŞTÜ  durum new, gitti hayır, ai_unavailable (not_model)
- mesaj: "Elektrikler gitti, sigortayı nasıl kaldırırız?"
- model istekleri: complaint_issue/own_topic@1 "elektrikler gitti sigorta" · appliance_help/fix_request@1 "sigortayı nasıl kaldırırız"
- öğeler: appliance_help:open@1 · complaint_issue:pending_host@1 · getirilen: fuse,stove,gym,trash,dishwasher

### d-mt-pool-gym-tr (tr) — durum answered, gitti evet
- mesaj: "Peki spor salonu?" · geçmiş 2
- model istekleri: amenities/own_topic@1 "spor salonu kullanım saatleri"
- öğeler: amenities:answered@1 · getirilen: gym,pets,quiet,sauna,checkin,transfer
- **r1** beklenen answer/none → **wrong_info** · çıkarım found (amenities/own_topic) · denetçi answered · öğe answered · olgu misattributed · yanlış bağ 0 · parça "Peki spor salonu"
- giden: "Spor salonu -1. kattadır ve 07:00–22:00 saatleri arasında açıktır. Giriş kartınızla kullanabilirsiniz; misafirler için ücretsizdir.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

### d-es-dishwasher (es) — durum answered, gitti evet
- mesaj: "El lavavajillas muestra un error y no arranca. ¿Cómo lo reiniciamos?"
- model istekleri: appliance_help/fix_request@1 "lavavajillas error reiniciar"
- öğeler: appliance_help:answered@1 · getirilen: dishwasher,laundry,wifi
- **r1** beklenen hold/none → **held_dropped** · çıkarım found (appliance_help/fix_request) · denetçi answered · öğe answered · olgu - · yanlış bağ 0 · parça "El lavavajillas muestra un error y no arranca"
- giden: "Hola Alex,\n\nMantenga pulsado el botón ON/OFF durante 3 segundos para reiniciar el lavavajillas.\n\n(Esta respuesta fue preparada por un asistente automático.)"


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `5a65ad01`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f09415b9f560` (öğe + yabancı dil örneği `4c65b500d6d3`) · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
