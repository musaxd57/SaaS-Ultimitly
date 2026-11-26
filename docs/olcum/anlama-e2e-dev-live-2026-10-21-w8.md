# Anlama ölçümü — understanding-e2e-dev.json — kol live (2026-10-21)

Durum: **GEÇERLİ** · senaryo 54/54 · istek 75 · denetçi gpt-5.1 · tahmini maliyet $0.53

Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.

### Anlama (modelin kendisi — ilişki işareti varsayılmadı)

| ölçü | değer |
|---|---|
| beklenen istek bulundu (niyet + mesaj) | 70/75 (93%) |
| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | 1/75 (1%) |
| 🚨 kaçan istek | 4/75 (5%) |
| fazla istek (beklenende karşılığı yok) | 6 |
| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | 68/70 (97%) |
| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | 6/6 · 0 |
| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | 7/11 · 0 · 4 |
| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | 0/1 · 1 |

### Son misafir sonucu (istek bazında)

| beklenen | sonuç | değer |
|---|---|---|
| cevap | doğru (olgu bağı doğrulandı) | 35/44 (80%) |
| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | 3/44 (7%) |
| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | 0/44 (0%) |
| cevap | gereksiz tutuldu — ev sahibinde açık | 6/44 (14%) |
| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | 0/44 (0%) |
| tut | doğru tutuldu — ev sahibinde açık | 24/25 (96%) |
| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | 0/25 (0%) |
| tut | 🚨 tutuldu ama sessiz düştü | 1/25 (4%) |
| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | 6/6 (100%) |
| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | 0 / 0 |
| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | 7/9 (78%) |
| senaryo | bütün istekleri doğru | 47/54 (87%) |
| 🚨 yasak dize misafire giden | 0 | |
| bilgi | ürün cevap modelini kullanmadı (not_model) | 1 |

### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)

| destek | sayı |
|---|---|
| supported | 53 |
| misbound | 0 |
| contradicted | 0 |
| unsupported | 0 |
| unverified | 14 |
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
| fix_hazard | 4/4 (100%) |
| fix_no_recipe | 2/2 (100%) |
| fix_recipe | 4/6 (67%) |
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
| same_words | 22/23 (96%) |
| stay_change | 3/3 (100%) |
| withdrawn | 1/1 (100%) |
| dil ar | 1/1 (100%) |
| dil de | 3/3 (100%) |
| dil en | 9/10 (90%) |
| dil es | 1/3 (33%) |
| dil fr | 0/1 (0%) |
| dil ru | 1/1 (100%) |
| dil tr | 53/56 (95%) |

### Model kullanımı

| model | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 56 | 4637 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 140 | 247173 | 196096 | 40397 | 20392 |
| gpt-6-luna | 89 | 1081787 | 928881 | 18110 | 6817 |

## Hatalı istekler (ayrıntı)

### d-sauna-notice-tr (tr) — durum new, gitti hayır, low_confidence_or_risky · risk availability_unconfirmed
- mesaj: "Saunayı kullanmak istiyoruz; ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz?"
- model istekleri: amenities/own_topic@1 "Saunayı kullanmak istiyoruz; ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz?"
- öğeler: amenities:open@1 · getirilen: sauna,boiler,bike,laundry,checkout,checkin,safety
- **r1** beklenen answer/none → **held_open** · çıkarım found (amenities/own_topic) · denetçi - · öğe open · olgu missing,missing · yanlış bağ 0 · parça "ne kadar önce haber vermemiz lazım, içeride ne kadar kalabiliyoruz"
- taslak (gitmedi): "Merhaba Alex,\n\nSaunayı kullanmak için en az 2 saat önceden resepsiyona haber vermeniz gerekiyor. Her rezervasyon 1 saat sürüyor."

### d-loft-garage-fr (fr) — durum new, gitti hayır, low_confidence_or_risky (low_confidence) · risk low_confidence_or_risky
- mesaj: "Le parking est-il gratuit pendant la semaine ?"
- model istekleri: parking/own_topic@1 "parking gratuit pendant la semaine"
- öğeler: parking:open@1 · getirilen: parking,latecheckout
- **r1** beklenen answer/none → **held_open** · çıkarım found (parking/own_topic) · denetçi - · öğe open · olgu missing · yanlış bağ 0 · parça "Le parking est-il gratuit pendant la semaine"
- taslak (gitmedi): "Bonjour Alex,\n\nVotre hôte pourra vous renseigner sur le stationnement en semaine."

### d-loft-bike-es (es) — durum new, gitti hayır, low_confidence_or_risky (items_nothing_answered) · risk items_held
- mesaj: "¿Hasta qué hora hay que devolver las bicicletas?"
- model istekleri: other/own_topic@1 "devolver las bicicletas hora límite"
- öğeler: other:pending_host@1 · getirilen: bikes
- **r1** beklenen answer/none → **held_open** · çıkarım found (other/own_topic) · denetçi - · öğe pending_host · olgu missing · yanlış bağ 0 · parça "Hasta qué hora hay que devolver las bicicletas"
- taslak (gitmedi): "Hola Alex,\n\nLas bicicletas deben devolverse antes de las 21:00."

### d-loft-quiet-en (en) — durum new, gitti hayır, low_confidence_or_risky (model_risk_label) · risk low_confidence_or_risky
- mesaj: "Can we play some music on the balcony around 10:30 pm tonight?"
- model istekleri: house_rules/own_topic@1 "play music on the balcony around 10:30 pm"
- öğeler: house_rules:pending_host@1 · getirilen: quiet,pets,breakfast,gym
- **r1** beklenen answer/none → **held_open** · çıkarım found (house_rules/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "Can we play some music on the balcony around 10:30 pm tonight"
- taslak (gitmedi): "Hello Alex,\n\nNo, please do not play music on the balcony at 10:30 pm. Quiet hours are from 10:00 pm to 7:00 am."

### d-pets-big-tr (tr, çift P-pets) — durum new, gitti hayır, low_confidence_or_risky (reply_output_veto) · risk items_held
- mesaj: "25 kiloluk köpeğimizi de getirebilir miyiz?"
- model istekleri: pets/own_topic@1 "25 kiloluk köpeğimizi de getirebilir miyiz?"
- öğeler: pets:pending_host@1 · getirilen: pets,terrace,quiet
- **r1** beklenen answer/none → **held_open** · çıkarım found (pets/own_topic) · denetçi - · öğe pending_host · olgu - · yanlış bağ 0 · parça "25 kiloluk köpeğimizi de getirebilir miyiz"
- taslak (gitmedi): "Merhaba Alex,\n\nBilgi tabanında yalnızca 10 kg altındaki köpeklerin kabul edildiği belirtiliyor. 25 kg'lık köpeğiniz için izin ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."

### d-ac-cool-tr (tr, çift P-ac) — durum new, gitti hayır, low_confidence_or_risky (items_fix_unverified) · risk low_confidence_or_risky
- mesaj: "Klima çalışmıyor, odayı nasıl soğutacağız?"
- model istekleri: complaint_issue/own_topic@1 "Klima çalışmıyor, odayı nasıl soğutacağız?" · appliance_help/fix_request@1 "Klima çalışmıyor, odayı nasıl soğutacağız?"
- öğeler: appliance_help:open@1 · complaint_issue:pending_host@1 · getirilen: ac,boiler,stove
- **r2** beklenen answer/dependent → **held_open** · çıkarım found (appliance_help/fix_request) · denetçi - · öğe open+pending_host · olgu missing · yanlış bağ 0 · parça "odayı nasıl soğutacağız"
- taslak (gitmedi): "Merhaba Alex,\n\nKlima kumandası komodinin çekmecesinde. Soğutma için MODE tuşuyla kar tanesi simgesini seçebilirsiniz; pencereler açıkken klima otomatik olarak durur."

### d-es-dishwasher (es) — durum answered, gitti evet · risk gate_passed
- mesaj: "El lavavajillas muestra un error y no arranca. ¿Cómo lo reiniciamos?"
- model istekleri: appliance_help/own_topic@1 "lavavajillas error no arranca reiniciar" · appliance_help/fix_request@1 "lavavajillas no arranca error"
- öğeler: appliance_help:answered@1 · getirilen: dishwasher,laundry,wifi
- **r1** beklenen hold/none → **held_dropped** · çıkarım found (appliance_help/own_topic) · denetçi answered · öğe answered · olgu - · yanlış bağ 0 · parça "El lavavajillas muestra un error y no arranca"
- giden: "Hola Alex,\n\nMantengan pulsado el botón ON/OFF durante 3 segundos para reiniciar el lavavajillas.\n\n(Esta respuesta fue preparada por un asistente automático.)"


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `a374bb37`

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

İstem kimliği (SHA-256 ilk 12): cevap `f09415b9f560` (öğe + yabancı dil örneği `4c65b500d6d3`) · anlama `696748a8de5b` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
