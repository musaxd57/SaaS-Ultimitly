# Haiku 5.5 ↔ gpt-5.1 — cevap katmanı (kurucu 10-31)

Aynı 135 senaryo (`evals/model-reply-compare.json`), aynı istem (ürünün `suggestReply`i), aynı STRICT çözüm ve aynı gönderim kapısı
(`autoReplyGateFailure`). Değişen yalnız cevabı yazan model: Haiku kolu GitHub Actions'ta (`claude-eval.yml`, iş 124542495718, commit
`01367d3`), gpt-5.1 tabanı aynı commit ailesinde yerelde (`model-reply-compare-2026-10-31-gpt-5.1-haiku-taban.md`). Anlama katmanı / bekçi
KAPALI (yalnız cevap modeli). Köprü: `tests/eval/anthropic-reply-shim.ts` (ürün kodu değişmedi).

| ölçü | gpt-5.1 | Haiku düşünme KAPALI (low) | Haiku adaptive low | Haiku adaptive medium | Haiku adaptive high |
|---|---|---|---|---|---|
| 🚨 sızıntı (gitmemesi gereken gitti) | 1/52 | 0/51 | 0/51 | 0/51 | 0/51 |
| KB'de cevabı olan soru otomatik gider | 50/55 | 48/55 | 47/55 | 49/55 | 46/55 |
| doğru olgu (katı) | 50/55 | **55/55** | 53/55 | 52/55 | 51/55 |
| olgu yanlış | 0 | 0 | 0 | 0 | 0 |
| uydurma (bilgi sorusu / bilgisi olmayan) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| bilgisi olmayan soru otomatik gider | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| 🚨 bekleme sözü misafire | 0 | 0 | 0 | 0 | 0 |
| dil uyumu TR dışı / TR | 59/59 · 75/76 | 57/58 · 76/76 | 57/58 · 75/76 | 58/58 · 74/76 | 58/58 · 75/76 |
| selam tekrarı | 0/14 | **3/14** | 0/14 | 0/14 | 0/14 |
| yedeğe düşen | 0 | 1 (base64 enjeksiyonunu reddetti → gitmedi, güvenli) | 1 | 1 | 1 |
| gecikme p50 / p95 | 3,3 / 7,0 sn | **1,6 / 2,4 sn** | 4,3 / 6,3 sn | 4,8 / 8,2 sn | 6,5 / 12,0 sn |
| maliyet (135 mesaj) | $0,970 | **$0,134** | $0,169 | $0,170 | $0,198 |
| 1.000 mesaj ≈ | $7,19 | **$0,99** | $1,25 | $1,26 | $1,46 |
| gitmeyen bilgi sorusunda kapı | müsaitlik 2 · blocked 3 | blocked 5 · müsaitlik 2 | blocked 8 | blocked 5 · müsaitlik 1 | blocked 9 |

## Okuma

- **Güvenlik:** dört kolun hiçbirinde sızıntı, uydurma, yanlış olgu, misafire bekleme sözü yok. gpt-5.1'in 1 "sızıntısı" zararsız bir ret
  cümlesiydi (`i-tr-baska-daire-kodu`); ölçü yine de sayar.
- **Bilgi doğruluğu:** düşünme KAPALI Haiku 55/55 (5.1: 50/55). Düşünme arttıkça doğru olgu AZALIYOR (53 → 52 → 51) — fazla düşünen Haiku
  bilgiyi vermek yerine "ev sahibinizin kararı" / "mesajınız kaydedildi" cümlesine kaçıyor.
- **Kural uyumu (asıl fark):** Haiku istemdeki üç kuralı 5.1'den sık çiğniyor: (1) **özür** ("özür dileriz", "das tut mir leid" — kurucu
  T-a: özür misafire gitmez), (2) **devir cümlesi** ("Mesajınız kaydedildi; ev sahibiniz görebilir" — K10), (3) **"ev sahibinizin kararı"**.
  Kod kapıları bunları TUTTU (misafire hiçbiri gitmedi), ama bedeli: cevabı bilgi tabanında olan soruların bir kısmı gitmedi ("blocked"
  5–9, 5.1'de 3). Düşünme kapalı kolda ayrıca 3 selam tekrarı.
- **Biçim:** düşünme açıkken Haiku JSON'u neredeyse her zaman ```json çitine sarıyor (124–129/136); köprü söküyor. Üretimde Anthropic'in
  yapılandırılmış çıktısı (`output_config.format` + şema) kullanılmalı.
- **Hız / fiyat:** düşünme kapalı Haiku 5.1'in yarı gecikmesi, ~7 kat ucuz.

## Öneri (karar kurucunun)

Haiku 5.5 cevap katmanında **düşünme kapalı** kipte güvenlik ve bilgi doğruluğunda 5.1'e denk / daha iyi, çok daha hızlı ve ucuz; ama kural
uyumu (özür / devir / "kararı") daha zayıf → daha çok cevap kapıda kalıyor. Geçmeden önce: (1) istemde Haiku için bu üç kuralın örnekli
pekiştirilmesi + yapılandırılmış çıktı, (2) yeniden ölçüm (aynı 135 + kör set), (3) diğer 5.1 katmanları (anlama, çeviri, üslup) ayrı ölçüm.
Ürün kodunda Anthropic sağlayıcısı YOK — bugün yalnız ölçüm köprüsü var; üretim geçişi ayrı iş + kurucu onayı.
