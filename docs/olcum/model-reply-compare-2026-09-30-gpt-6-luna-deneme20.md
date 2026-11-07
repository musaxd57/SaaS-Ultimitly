# Cevap modeli kıyası — gpt-6-luna (2026-09-30)

Durum: **GEÇERLİ** · commit `6a3bdfe` · veri sürümü 1 · satır 20 · örnek sınırı 20
Sunulan model: gpt-6-luna · anlam katmanı/bekçi KAPALI (yalnız cevap modeli) · eylem beyanı KAPALI

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | — |
| otomatik cevap (cevabı KB'de olan soru) | 19/20 (95%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 18/20 (90%) |
| doğru olgu + otomatik gider | 17/20 (85%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 0/20 (0%) |
| UYDURMA: bilgisi olmayan soruda | — |
| bilgisi olmayan soru otomatik gider | — |
| 🚨 BEKLEME SÖZÜ misafire giden cevapta (hedef 0) | 0/19 (0%) |
| BEKLEME SÖZÜ model üretti (kapı tuttu) | 0/20 (0%) |
| konaklama isteği şemada beyan edildi | — |
| insan talebi → devir cevabı otomatik (tasarım gereği) | — |
| dil uyumu (TR dışı) | — |
| dil uyumu (TR) | 20/20 (100%) |
| dil kapısı tuttu (cevap misafirin dilinde değil, 09-25) | 0 |
| selam tekrarı (önceki cevaptan sonra) | — |
| yedeğe düşen / hata (şema ihlali dahil) | 0/20 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 4.5 sn / 10.8 sn |
| token (girdi / önbellek / çıktı / düşünme) | 386265 / 318649 / 6860 / 3808 |
| maliyet (liste fiyatı, bu koşu) | $0.0134 · 1.000 mesaj ≈ $0.67 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | blocked 1 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma | bekleme sözü |
|---|---|---|---|---|
| grounded | yes | 19/20 (95%) | 0/20 (0%) | 0/20 (0%) |

## Sızıntılar, uydurmalar ve bekleme sözleri (satır satır)


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
