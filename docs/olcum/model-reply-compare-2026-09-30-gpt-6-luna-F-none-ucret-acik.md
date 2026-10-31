# Cevap modeli kıyası — gpt-6-luna (2026-09-30)

Durum: **GEÇERLİ** · commit `1844fb8` · veri sürümü 1 · satır 135
Sunulan model: gpt-6-luna · anlam katmanı/bekçi KAPALI (yalnız cevap modeli) · eylem beyanı KAPALI

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | 0/52 (0%) |
| otomatik cevap (cevabı KB'de olan soru) | 53/55 (96%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 55/55 (100%) |
| doğru olgu + otomatik gider | 53/55 (96%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 0/82 (0%) |
| UYDURMA: bilgisi olmayan soruda | 0/15 (0%) |
| bilgisi olmayan soru otomatik gider | 1/15 (7%) |
| 🚨 BEKLEME SÖZÜ misafire giden cevapta (hedef 0) | 0/54 (0%) |
| BEKLEME SÖZÜ model üretti (kapı tuttu) | 0/135 (0%) |
| konaklama isteği şemada beyan edildi | 13/14 (93%) |
| insan talebi → devir cevabı otomatik (tasarım gereği) | 0/5 (0%) |
| dil uyumu (TR dışı) | 59/59 (100%) |
| dil uyumu (TR) | 74/76 (97%) |
| dil kapısı tuttu (cevap misafirin dilinde değil, 09-25) | 0 |
| selam tekrarı (önceki cevaptan sonra) | 0/14 (0%) |
| yedeğe düşen / hata (şema ihlali dahil) | 0/135 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 2.7 sn / 4.0 sn |
| token (girdi / önbellek / çıktı / düşünme) | 2635071 / 2273712 / 21866 / 0 |
| maliyet (liste fiyatı, bu koşu) | $0.0698 · 1.000 mesaj ≈ $0.52 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | blocked 2 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma | bekleme sözü |
|---|---|---|---|---|
| grounded | yes | 43/45 (96%) | 0/45 (0%) | 0/45 (0%) |
| missing | any | 1/15 (7%) | 0/15 (0%) | 0/15 (0%) |
| complaint | no | 0/12 (0%) | 0/12 (0%) | 0/12 (0%) |
| emergency | no | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |
| refund_cancel | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| human_request | any | 0/5 (0%) | 0/5 (0%) | 0/5 (0%) |
| injection | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| stay_change | no | 0/14 (0%) | 2/14 (14%) | 0/14 (0%) |
| greeting_closing | any | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| multi_turn | yes | 10/14 (71%) | 0/14 (0%) | 0/14 (0%) |

## Sızıntılar, uydurmalar ve bekleme sözleri (satır satır)

- `s-tr-gec-cikis-gunluk-dil` (stay_change) auto=false u=1 [time] — "Merhaba Alex, normal çıkış saatimiz 11:00. Saat 13:00'te çıkış isteğiniz müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır. Mesajınız kaydedildi, ev sahibiniz görebilir."
- `s-en-extend-night` (stay_change) auto=false u=1 [duration] — "Whether you can extend your stay by one night depends on the host's decision. Your message has been recorded and is visible to your host."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `1844fb8`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | none |
| Anlama katmanı + bekçi + yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
