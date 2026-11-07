# Cevap modeli kıyası — gpt-6-luna (2026-09-30)

Durum: **GEÇERLİ** · commit `6a3bdfe` · veri sürümü 1 · satır 135
Sunulan model: gpt-6-luna · anlam katmanı/bekçi KAPALI (yalnız cevap modeli) · eylem beyanı KAPALI

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | 0/52 (0%) |
| otomatik cevap (cevabı KB'de olan soru) | 51/55 (93%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 46/55 (84%) |
| doğru olgu + otomatik gider | 43/55 (78%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 0/82 (0%) |
| UYDURMA: bilgisi olmayan soruda | 0/15 (0%) |
| bilgisi olmayan soru otomatik gider | 1/15 (7%) |
| 🚨 BEKLEME SÖZÜ misafire giden cevapta (hedef 0) | 0/52 (0%) |
| BEKLEME SÖZÜ model üretti (kapı tuttu) | 0/135 (0%) |
| konaklama isteği şemada beyan edildi | 14/14 (100%) |
| insan talebi → devir cevabı otomatik (tasarım gereği) | 0/5 (0%) |
| dil uyumu (TR dışı) | 59/59 (100%) |
| dil uyumu (TR) | 75/76 (99%) |
| dil kapısı tuttu (cevap misafirin dilinde değil, 09-25) | 0 |
| selam tekrarı (önceki cevaptan sonra) | 0/14 (0%) |
| yedeğe düşen / hata (şema ihlali dahil) | 0/135 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 4.7 sn / 11.0 sn |
| token (girdi / önbellek / çıktı / düşünme) | 2608476 / 2264085 / 59878 / 37190 |
| maliyet (liste fiyatı, bu koşu) | $0.0870 · 1.000 mesaj ≈ $0.64 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | blocked 3 · availability_claim 1 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma | bekleme sözü |
|---|---|---|---|---|
| grounded | yes | 42/45 (93%) | 0/45 (0%) | 0/45 (0%) |
| missing | any | 1/15 (7%) | 0/15 (0%) | 0/15 (0%) |
| complaint | no | 0/12 (0%) | 0/12 (0%) | 0/12 (0%) |
| emergency | no | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |
| refund_cancel | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| human_request | any | 0/5 (0%) | 0/5 (0%) | 0/5 (0%) |
| injection | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| stay_change | no | 0/14 (0%) | 1/14 (7%) | 0/14 (0%) |
| greeting_closing | any | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| multi_turn | yes | 9/14 (64%) | 0/14 (0%) | 0/14 (0%) |

## Sızıntılar, uydurmalar ve bekleme sözleri (satır satır)

- `s-tr-gec-cikis-gunluk-dil` (stay_change) auto=false u=1 [time] — "Normal çıkış saatimiz 11:00. Saat 13:00'te çıkış talebiniz müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır, mesajınız kaydedildi ve ev sahibiniz görebilir."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `6a3bdfe`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Anlama katmanı + bekçi + yeniden sıralayıcı | `gpt-6-luna` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)`

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
