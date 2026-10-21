# Anlama ölçümü — understanding-e2e-probe-hazard.json — kol live (2026-10-21)

Durum: **GEÇERLİ** · senaryo 70/70 · istek 70 · denetçi gpt-5.1 · tahmini maliyet $0.27

Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.

### Anlama (modelin kendisi — ilişki işareti varsayılmadı)

| ölçü | değer |
|---|---|
| beklenen istek bulundu (niyet + mesaj) | 59/70 (84%) |
| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | 0/70 (0%) |
| 🚨 kaçan istek | 11/70 (16%) |
| fazla istek (beklenende karşılığı yok) | 90 |
| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | 52/59 (88%) |
| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | 0/0 · 0 |
| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | 0/0 · 0 · 0 |
| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | 0/0 · 0 |

### Son misafir sonucu (istek bazında)

| beklenen | sonuç | değer |
|---|---|---|
| cevap | doğru (olgu bağı doğrulandı) | — |
| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | — |
| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | — |
| cevap | gereksiz tutuldu — ev sahibinde açık | — |
| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | — |
| tut | doğru tutuldu — ev sahibinde açık | 22/22 (100%) |
| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | 0/22 (0%) |
| tut | 🚨 tutuldu ama sessiz düştü | 0/22 (0%) |
| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | 46/48 (96%) |
| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | 0 / 2 |
| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | — |
| senaryo | bütün istekleri doğru | 68/70 (97%) |
| 🚨 yasak dize misafire giden | 0 | |
| bilgi | ürün cevap modelini kullanmadı (not_model) | 4 |

### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)

| destek | sayı |
|---|---|
| supported | 0 |
| misbound | 0 |
| contradicted | 0 |
| unsupported | 0 |
| unverified | 0 |
| process | 0 |
| denetçi düştü | 0 |

### Etiket / dil kırılımı (istek doğru)

| kırılım | doğru |
|---|---|
| emergency | 46/48 (96%) |
| false_alarm_by_rules | 22/22 (100%) |
| missed_by_rules | 46/48 (96%) |
| probe | 68/70 (97%) |
| dil ar | 19/21 (90%) |
| dil de | 11/11 (100%) |
| dil en | 10/10 (100%) |
| dil es | 6/6 (100%) |
| dil fr | 1/1 (100%) |
| dil ru | 4/4 (100%) |
| dil tr | 17/17 (100%) |

### Model kullanımı

| model | çağrı | girdi | önbellek | çıktı | düşünme |
|---|---|---|---|---|---|
| text-embedding-3-small | 71 | 10656 | 0 | 0 | 0 |
| gpt-5.1-2025-11-13 | 123 | 213093 | 148096 | 12858 | 0 |
| gpt-6-luna | 61 | 1196618 | 1023378 | 18015 | 7145 |

## Hatalı istekler (ayrıntı)

### pz-miss-42 (ar) — durum new, gitti hayır, ai_unavailable (not_model) · risk low_confidence_or_risky
- mesaj: "السلام عليكم، وصلنا أمس متأخرين والحمد لله والشقة حلوة والموقع ممتاز، بس الواي فاي بطيء شوي والأطفال يبون يشوفون الكرتون، وكمان المنشفة الصغيرة ناقصة، وبالمناسبة الماء يتدفق من تحت المغسلة في الحمام والأرضية غرقانة الآن ومو قادرين نوقفه، المهم نبي حل للواي فاي بعد"
- model istekleri: complaint_issue/own_topic@1 "شكوى واي فاي بطيء منشفة ناقصة تسرب ماء من المغسلة" · wifi/fix_request@1 "حل الواي فاي البطيء للأطفال يشوفون الكرتون" · cleaning_linen/own_topic@1 "نقص منشفة صغيرة" · appliance_help/fix_request@1 "الماء يتدفق من تحت المغسلة في الحمام والأرضية غرقانة"
- öğeler: wifi:open@1 · cleaning_linen:open@1 · appliance_help:open@1 · complaint_issue:pending_host@1 · getirilen: wifi,tv,safety,transfer,boiler,laundry
- **r1** beklenen emergency/none → **emergency_missed** · çıkarım missed · denetçi - · öğe - · olgu - · yanlış bağ 0 · parça "السلام عليكم، وصلنا أمس متأخرين والحمد لله والشقة حلوة والموقع ممتاز، بس الواي فاي بطيء شوي والأطفال يبون يشوفون الكرتون، وكمان المنشفة الصغيرة ناقصة، وبالمناسبة الماء يتدفق من تحت المغسلة في الحمام والأرضية غرقانة الآن ومو قادرين نوقفه، المهم نبي حل للواي فاي بعد"

### pz-miss-47 (ar) — durum new, gitti hayır, ai_unavailable (not_model) · risk items_held
- mesaj: "السلام عليكم، رحلتنا كانت تعبانة والطقس حار، ما علينا، المهم من الجار اللي فوقنا ينزل ماء كثير من السقف في غرفة النوم وصار يقطر على المقبس والكهرباء والسقف منتفخ وكأنه بيسقط، طلعنا برا الغرفة، تعالوا بسرعة"
- model istekleri: complaint_issue/own_topic@1 "تسرب ماء من السقف على الكهرباء خطر" · appliance_help/fix_request@1 "مشكلة في مقبس الكهرباء بسبب الماء" · human_request/own_topic@1 "تعالوا بسرعة للمساعدة"
- öğeler: appliance_help:open@1 · complaint_issue:pending_host@1 · human_request:pending_host@1 · getirilen: fuse,boiler,safety,latecheckout,wifi,stove,dishwasher
- **r1** beklenen emergency/none → **emergency_missed** · çıkarım missed · denetçi - · öğe - · olgu - · yanlış bağ 0 · parça "السلام عليكم، رحلتنا كانت تعبانة والطقس حار، ما علينا، المهم من الجار اللي فوقنا ينزل ماء كثير من السقف في غرفة النوم وصار يقطر على المقبس والكهرباء والسقف منتفخ وكأنه بيسقط، طلعنا برا الغرفة، تعالوا بسرعة"


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `560b3cd5`

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
