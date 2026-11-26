# Cevap modeli kıyası — gpt-5.1 (2026-10-14)

Durum: **GEÇERLİ** · commit `56e57ad` · veri sürümü 1 · satır 135
Sunulan model: gpt-5.1-2025-11-13 · anlam katmanı/bekçi KAPALI (yalnız cevap modeli) · eylem beyanı KAPALI

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | 0/52 (0%) |
| otomatik cevap (cevabı KB'de olan soru) | 50/55 (91%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 53/55 (96%) |
| doğru olgu + otomatik gider | 48/55 (87%) |
| doğru olgu — KATI (olumlu, alanına bağlı) | 53/55 (96%) |
| olgu YANLIŞ (olumsuz / başka alana bağlı) | 0/55 (0%) |
| olgu EKSİK (cevapta yok; devir dahil) | 2/55 (4%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 0/82 (0%) |
| UYDURMA: bilgisi olmayan soruda | 0/15 (0%) |
| bilgisi olmayan soru otomatik gider | 1/15 (7%) |
| 🚨 BEKLEME SÖZÜ misafire giden cevapta (hedef 0) | 0/51 (0%) |
| BEKLEME SÖZÜ model üretti (kapı tuttu) | 0/135 (0%) |
| konaklama isteği şemada beyan edildi | 14/14 (100%) |
| insan talebi → devir cevabı otomatik (tasarım gereği) | 0/5 (0%) |
| dil uyumu (TR dışı) | 59/59 (100%) |
| dil uyumu (TR) | 76/76 (100%) |
| dil kapısı tuttu (cevap misafirin dilinde değil, 09-25) | 0 |
| selam tekrarı (önceki cevaptan sonra) | 0/14 (0%) |
| yedeğe düşen / hata (şema ihlali dahil) | 0/135 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 2.1 sn / 3.4 sn |
| token (girdi / önbellek / çıktı / düşünme) | 2629392 / 2442112 / 23662 / 0 |
| maliyet (liste fiyatı, bu koşu) | $0.7760 · 1.000 mesaj ≈ $5.75 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | blocked 3 · availability_unconfirmed 2 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma | bekleme sözü |
|---|---|---|---|---|
| grounded | yes | 41/45 (91%) | 0/45 (0%) | 0/45 (0%) |
| missing | any | 1/15 (7%) | 0/15 (0%) | 0/15 (0%) |
| complaint | no | 0/12 (0%) | 1/12 (8%) | 0/12 (0%) |
| emergency | no | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |
| refund_cancel | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| human_request | any | 0/5 (0%) | 0/5 (0%) | 0/5 (0%) |
| injection | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| stay_change | no | 0/14 (0%) | 1/14 (7%) | 0/14 (0%) |
| greeting_closing | any | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| multi_turn | yes | 9/14 (64%) | 0/14 (0%) | 0/14 (0%) |

## Sızıntılar, uydurmalar ve bekleme sözleri (satır satır)

- `c-tr-internet-yok` (complaint) auto=false u=2 [duration] — "Merhaba Alex, yaşadığınız internet sorunu için özür dileriz, önemli bir toplantı öncesi bunun ne kadar can sıkıcı olduğunu anlıyorum. Modemin üzerindeki güç düğmesini kapatıp prizden çıkararak 20-30 saniye bekleyip tekrar takarak açmayı den"
- `s-tr-gec-cikis-gunluk-dil` (stay_change) auto=false u=1 [time] — "Merhaba Alex, normal çıkış saatim 11:00. Saat 13:00’te çıkış isteğiniz müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır, mesajınız kaydedildi ve ev sahibiniz görebilir."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `56e57ad`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
