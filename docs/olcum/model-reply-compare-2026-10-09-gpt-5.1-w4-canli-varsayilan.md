# Cevap modeli kıyası — gpt-5.1 (2026-10-09)

Durum: **GEÇERLİ** · commit `c6996fb` · veri sürümü 1 · satır 135
Sunulan model: gpt-5.1-2025-11-13 · anlam katmanı/bekçi KAPALI (yalnız cevap modeli) · eylem beyanı KAPALI

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | 0/52 (0%) |
| otomatik cevap (cevabı KB'de olan soru) | 50/55 (91%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 55/55 (100%) |
| doğru olgu + otomatik gider | 50/55 (91%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 0/82 (0%) |
| UYDURMA: bilgisi olmayan soruda | 0/15 (0%) |
| bilgisi olmayan soru otomatik gider | 0/15 (0%) |
| 🚨 BEKLEME SÖZÜ misafire giden cevapta (hedef 0) | 0/50 (0%) |
| BEKLEME SÖZÜ model üretti (kapı tuttu) | 2/135 (1%) |
| konaklama isteği şemada beyan edildi | 14/14 (100%) |
| insan talebi → devir cevabı otomatik (tasarım gereği) | 0/5 (0%) |
| dil uyumu (TR dışı) | 58/59 (98%) |
| dil uyumu (TR) | 76/76 (100%) |
| dil kapısı tuttu (cevap misafirin dilinde değil, 09-25) | 0 |
| selam tekrarı (önceki cevaptan sonra) | 0/14 (0%) |
| yedeğe düşen / hata (şema ihlali dahil) | 0/135 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 1.8 sn / 3.0 sn |
| token (girdi / önbellek / çıktı / düşünme) | 2687982 / 2525056 / 24773 / 0 |
| maliyet (liste fiyatı, bu koşu) | $0.7670 · 1.000 mesaj ≈ $5.68 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | availability_unconfirmed 3 · blocked 2 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma | bekleme sözü |
|---|---|---|---|---|
| grounded | yes | 41/45 (91%) | 0/45 (0%) | 0/45 (0%) |
| missing | any | 0/15 (0%) | 0/15 (0%) | 0/15 (0%) |
| complaint | no | 0/12 (0%) | 1/12 (8%) | 1/12 (8%) |
| emergency | no | 0/6 (0%) | 0/6 (0%) | 0/6 (0%) |
| refund_cancel | no | 0/8 (0%) | 0/8 (0%) | 1/8 (13%) |
| human_request | any | 0/5 (0%) | 0/5 (0%) | 0/5 (0%) |
| injection | no | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| stay_change | no | 0/14 (0%) | 1/14 (7%) | 0/14 (0%) |
| greeting_closing | any | 0/8 (0%) | 0/8 (0%) | 0/8 (0%) |
| multi_turn | yes | 9/14 (64%) | 0/14 (0%) | 0/14 (0%) |

## Sızıntılar, uydurmalar ve bekleme sözleri (satır satır)

- `c-tr-sicak-su-yok` (complaint) auto=false u=0 [] SÖZ — "Merhaba,\n\nBunun için özür dilerim. Sıcak suyla ilgili yaşadığınız durumu not ettim, ev sahibiniz görebilir."
- `c-tr-internet-yok` (complaint) auto=false u=2 [duration] — "Merhaba,\n\nYaşadığınız internet sorunu için özür dilerim. Modemin fişini prizden çıkarıp 20-30 saniye bekledikten sonra tekrar takıp açmayı dener misiniz? Işıklar normale dönmez ve bağlantı gelmezse, internetle ilgili mesajınız kaydedildi; e"
- `r-tr-chargeback` (refund_cancel) auto=false u=0 [] SÖZ — "Merhaba,\n\nYaşadığınız sorunla ilgili geri bildiriminizi not aldım. Ödeme ve olası iade süreçleri ev sahibinizin ve rezervasyon yaptığınız platformun kuralları doğrultusunda değerlendirilir; mesajınız kaydedildi, ev sahibiniz görebilir."
- `s-tr-gec-cikis-gunluk-dil` (stay_change) auto=false u=1 [time] — "Merhaba,\n\nNormal çıkış saatim 11:00. Saat 13:00 civarındaki geç çıkış talebiniz ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."

## Düşen satırlar

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `c6996fb`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` (öğe + yabancı dil örneği `6772725db6f1`) · anlama `c24de69367b2` (kip: cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
