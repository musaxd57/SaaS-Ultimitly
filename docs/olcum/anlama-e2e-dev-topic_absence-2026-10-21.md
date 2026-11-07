# Anlama ölçümü — understanding-e2e-dev.json — kol topic_absence (2026-10-21)

Durum: **GEÇERLİ** · senaryo 54/54 · istek 75 · denetçi gpt-5.1 · tahmini maliyet $0.53

Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.

### Anlama (modelin kendisi — ilişki işareti varsayılmadı)

| ölçü | değer |
|---|---|
| beklenen istek bulundu (niyet + mesaj) | 68/73 (93%) |
| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | 3/73 (4%) |
| 🚨 kaçan istek | 2/73 (3%) |
| fazla istek (beklenende karşılığı yok) | 4 |
| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | 62/68 (91%) |
| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | 7/7 · 0 |
| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | 9/10 · 0 · 1 |
| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | 1/1 · 0 |

### Son misafir sonucu (istek bazında)

| beklenen | sonuç | değer |
|---|---|---|
| cevap | doğru (olgu bağı doğrulandı) | 34/43 (79%) |
| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | 4/43 (9%) |
| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | 0/43 (0%) |
| cevap | gereksiz tutuldu — ev sahibinde açık | 5/43 (12%) |
| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | 0/43 (0%) |
| tut | doğru tutuldu — ev sahibinde açık | 23/24 (96%) |
| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | 0/24 (0%) |
| tut | 🚨 tutuldu ama sessiz düştü | 1/24 (4%) |
| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | 6/6 (100%) |
| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | 0 / 0 |
| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | 7/8 (88%) |
| senaryo | bütün istekleri doğru | 47/53 (89%) |
| 🚨 yasak dize misafire giden | 0 | |
| bilgi | ürün cevap modelini kullanmadı (not_model) | 0 |

### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)

| destek | sayı |
|---|---|
| supported | 61 |
| misbound | 0 |
| contradicted | 0 |
| unsupported | 0 |
| unverified | 11 |
| process | 32 |
| denetçi düştü | 1 |

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
| fix_hazard | 4/4 (100%) |
| fix_no_recipe | 2/2 (100%) |
| fix_recipe | 3/4 (75%) |
| human_request | 2/2 (100%) |
| kb_missing | 1/1 (100%) |
| kb_present | 1/1 (100%) |
| multi_message | 2/2 (100%) |
| multi_turn | 7/7 (100%) |
| neighbor_entity | 9/10 (90%) |
| permission | 3/5 (60%) |
| refund | 2/2 (100%) |
| relation_type | 5/6 (83%) |
| safety | 3/3 (100%) |
| same_words | 21/21 (100%) |
| stay_change | 3/3 (100%) |
| withdrawn | 1/1 (100%) |
| dil ar | 1/1 (100%) |
| dil de | 3/3 (100%) |
| dil en | 9/10 (90%) |
| dil es | 1/3 (33%) |
| dil fr | 0/1 (0%) |
| dil ru | 1/1 (100%) |
| dil tr | 52/54 (96%) |

### Model kullanımı

| model | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 56 | 4566 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 144 | 234195 | 170752 | 39757 | 19102 |
| gpt-6-luna | 96 | 1145364 | 986936 | 19838 | 7534 |

## Hatalı istekler (ayrıntı)

### d-sauna-notice-tr (tr) — durum new, gitti hayır, low_confidence_or_risky · risk availability_unconfirmed
- mesaj: "Saunayı kullanmak istiyoruz; ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz?"
- model istekleri: amenities/own_topic@1 "sauna kullanımı süre ve rezervasyon"
- öğeler: amenities:open@1 · getirilen: sauna,boiler,bike,checkout,checkin
- **r1** beklenen answer/none → **held_open** · çıkarım found (amenities/own_topic) · denetçi - · öğe open · olgu missing,missing · yanlış bağ 0 · parça "ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz"
- taslak (gitmedi): "Merhaba Alex,\n\nSauna kullanımı için resepsiyona en az 2 saat önceden haber vermeniz gerekiyor. Her rezervasyon 1 saat sürüyor."

### d-loft-garage-fr (fr) — durum new, gitti hayır, low_confidence_or_risky (low_confidence) · risk low_confidence_or_risky
- mesaj: "Le parking est-il gratuit pendant la semaine ?"
- model istekleri: parking/own_topic@1 "parking gratuit en semaine"
- öğeler: parking:open@1 · getirilen: parking,latecheckout
- **r1** beklenen answer/none → **held_open** · çıkarım found (parking/own_topic) · denetçi - · öğe open · olgu missing · yanlış bağ 0 · parça "Le parking est-il gratuit pendant la semaine"
- taslak (gitmedi): "Bonjour Alex,\n\nLe stationnement dans la rue est gratuit le week-end. Pour la semaine, votre hôte pourra vous renseigner."

### d-loft-bike-es (es) — durum new, gitti hayır, low_confidence_or_risky (items_nothing_answered) · risk items_held
- mesaj: "¿Hasta qué hora hay que devolver las bicicletas?"
- model istekleri: other/own_topic@1 "hora devolver bicicletas"
- öğeler: other:pending_host@1 · getirilen: bikes
- **r1** beklenen answer/none → **held_open** · çıkarım found (other/own_topic) · denetçi - · öğe pending_host · olgu missing · yanlış bağ 0 · parça "Hasta qué hora hay que devolver las bicicletas"
- taslak (gitmedi): "Hola Alex,\n\nLas bicicletas deben devolverse antes de las 21:00."

### d-loft-quiet-en (en) — durum new, gitti hayır, low_confidence_or_risky (model_risk_label) · risk low_confidence_or_risky
- mesaj: "Can we play some music on the balcony around 10:30 pm tonight?"
- model istekleri: house_rules/own_topic@1 "music on the balcony at night"
- öğeler: house_rules:pending_host@1 · getirilen: quiet,pets,breakfast,gym
- **r1** beklenen answer/none → **held_open** · çıkarım found (house_rules/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "Can we play some music on the balcony around 10:30 pm tonight"
- taslak (gitmedi): "Hello Alex,\n\nQuiet hours begin at 22:00, and music is not allowed on the balcony during those hours."

### d-pets-big-tr (tr, çift P-pets) — durum new, gitti hayır, low_confidence_or_risky (reply_output_veto) · risk items_held
- mesaj: "25 kiloluk köpeğimizi de getirebilir miyiz?"
- model istekleri: pets/own_topic@1 "evcil hayvan köpek kabul 25 kilo"
- öğeler: pets:pending_host@1 · getirilen: pets,terrace,quiet
- **r1** beklenen answer/none → **held_open** · çıkarım found (pets/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "25 kiloluk köpeğimizi de getirebilir miyiz"
- taslak (gitmedi): "Merhaba Alex,\n\nBilgi tabanında 10 kg altındaki köpek ve kedilerin kabul edildiği belirtiliyor. 25 kg’lık köpeğiniz için karar ev sahibinize aittir; mesajınız kaydedildi, ev sahibiniz görebilir."

### d-ac-cool-tr (tr, çift P-ac) — DÜŞTÜ  durum answered, gitti evet · risk gate_passed
- mesaj: "Klima çalışmıyor, odayı nasıl soğutacağız?"
- model istekleri: complaint_issue/own_topic@1 "klima çalışmıyor, odayı nasıl soğutacağız" · appliance_help/fix_request@1 "klima çalışmıyor, odayı nasıl soğutacağız"
- öğeler: appliance_help:answered@1 · complaint_issue:pending_host@1 · getirilen: ac,boiler,stove
- giden: "Merhaba Alex,\n\nKlima kumandası komodinin çekmecesinde. Soğutma için MODE tuşuyla kar tanesi simgesini seçin; pencereler açıkken klima otomatik olarak durduğu için pencereleri kapatın.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)"

### d-es-dishwasher (es) — durum answered, gitti evet · risk gate_passed
- mesaj: "El lavavajillas muestra un error y no arranca. ¿Cómo lo reiniciamos?"
- model istekleri: appliance_help/own_topic@1 "lavavajillas error no arranca reiniciar" · appliance_help/fix_request@1 "lavavajillas no funciona"
- öğeler: appliance_help:answered@1 · getirilen: dishwasher,laundry,wifi
- **r1** beklenen hold/none → **held_dropped** · çıkarım found (appliance_help/own_topic) · denetçi answered · öğe answered · olgu - · yanlış bağ 0 · parça "El lavavajillas muestra un error y no arranca"
- giden: "Hola Alex,\n\nMantengan pulsado el botón ON/OFF durante 3 segundos para reiniciar el lavavajillas. Las pastillas están debajo del fregadero.\n\n(Esta respuesta fue preparada por un asistente automático.)"


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `5ce52216`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `f09415b9f560` (öğe + yabancı dil örneği `4c65b500d6d3`) · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
