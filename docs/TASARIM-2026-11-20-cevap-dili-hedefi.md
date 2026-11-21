# Tasarım — Cevap dili hedefi: tek değer (konu 1, gölge dilimi)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-20-oglen-2-fable-dort-konu.md` konu 1 (Codex görüşü, kurucu aktardı) + Fable önerisi. Codex önerisi
> karar değildir; **K1-1 kurucu cevabı bekliyor** → bu dilim YALNIZ gölge: misafire giden hiçbir şey değişmez.
> Anahtar `AI_REPLY_LANGUAGE_SHADOW_ENABLED` (yalnız "1", KAPALI). Kod: `src/lib/ai/reply-language-target.ts` (saf) ·
> `src/lib/ai/reply-language-shadow.ts` · çağrılar `automation.ts` (kanal) ve `api/chat/[token]/route.ts` (QR).
> Testler: `tests/unit/reply-language-target.test.ts` (11) · `tests/integration/reply-language-shadow.test.ts` (3).

## 1. Bugün (kodda okundu)

"Misafire hangi dilde cevap verilecek" sorusunu üç yer ayrı ayrı cevaplıyor:

| Tüketici | Kanal | QR |
|---|---|---|
| İstem (dil satırı) | `guestTurnLanguage(son mesaj, cevapsızlar)` — kod eminse | aynı |
| Dil kapısı | `gateGuestLanguage(kod, modelin beyanı, metinler)` | `qrGateGuestLanguage`: kod, değilse anlama katmanı / model ipucu (≥ 2 sözcük) |
| Koddan kurulan metin | `guestTurnLanguage` (erken giriş onayı, politika); selam: kod, değilse modelin beyanı | `confidentLanguage(mesaj)` |

Çoğu turda sonuç aynıdır ama aynı DEĞER okunmaz. Ölçülebilir iki ayrışma: (a) kod emin değilken istem dil satırı yazmaz, kapı modelin beyanını
kullanır, kod metni İngilizceye düşer; (b) mesajın YAZILDIĞI dil ile misafirin İSTEDİĞİ cevap dili aynı değişkende — Codex'in çalıştırdığı örnek
bu ağaçta da aynı: `Could you please answer in Turkish?` → `en` (testte pinli).

## 2. Hedef

Tur başına tek değer + kaynağı (`resolveReplyLanguageTarget`). Öncelik:

1. **Açık cevap dili tercihi** — anlam kararıdır; sözcük listesiyle VERİLMEZ (kurucu 11-18). Anlama katmanı okuyacak (girdi alanı
   `explicitPreference` hazır; okuyucu bu dilimde yok). Sözcük ağı (`mentionsLanguageName`) yalnız "bu mesajda dil isteği OLABİLİR" adayını
   işaretler; o durumda hedef **belirsiz** kalır (`request_unread`) — yanlış dile kilitlenmez.
2. Son anlamlı mesajın dili: kod eminse kod; değilse anlama katmanının dili, misafirin kendi metninde izi varsa.
3. Turun cevapsız mesajlarının birlikte dili.
4. Modelin beyanı, metinde izi varsa (bugünkü kapı kuralı).

"OK", emoji, adres, ad dili değiştirmez (kodda "emin değil"dir, hiçbir adımı tetiklemez). Ülke / milliyet / ad hiçbir adımda girdi DEĞİLDİR.
Kanalın bildirdiği dil alanı (doğrudan Airbnb) sözleşmesi doğrulanana kadar girdi değil (Codex: "alan adı uydurmayız").

## 3. Gölge kaydı

Tur başına bir satır (`SemanticReading`, katman `reply_language`; mesaj + katman tekil): bugünkü istem dili · hedef · kıyas sınıfı
(`same` · `consumers_differ` · `target_differs` · `target_fills` · `target_unsure`) · ayrıntı `{p, g, c, u, d, x, n, t, s}` (yalnız dil
kodları / sayı / kaynak — misafir metni YOK). Saklama / silme / konuşma birleştirme bu tablonun var olan kurallarıyla. Anahtar kapalıyken
hiç sorgu yok; hiçbir karar bu kayda bakmaz; hata cevap akışını durdurmaz.

## 4. Sonraki dilimler (kurucu kararı + ölçümle)

| Dilim | Ne | Şart |
|---|---|---|
| D2 | Anlama katmanı açık tercihi okur: şemaya `reply_language` (kapalı küme + `none`), istem eki; kod doğrular (misafirin metninde o dilin adı geçiyor mu — alıntı) | ücretli ölçüm: "answer in Turkish", "In English please", "Turkish breakfast", karışık dil, kısa metin grupları |
| D3 | Üç tüketici hedefi okur (istem satırı, kapı, kod metni aynı değer) | gölge sonucu: `consumers_differ` + `target_differs` oranları ve örnekleri kurucuya önce / sonra olarak |
| D4 | Doğrudan Airbnb: mesaj gövdesinin orijinal / çeviri olduğu bilgisi kanal sözleşmesinde | partner sandbox doğrulaması |

## 5. Gölge sonucunu okuma

```sql
SELECT "agreement", count(*) FROM "SemanticReading" WHERE "layer" = 'reply_language' GROUP BY 1 ORDER BY 2 DESC;
```

## 6. Kurucuya soru (K1-1 ile birlikte)

**S-DİL-1.** Misafir İngilizce yazıp "Türkçe cevap verir misiniz?" derse: bugün cevap İngilizce gider (istem "misafirin dili İngilizce" der; Türkçe
cevap dil kapısına takılır). Hedef: Türkçe cevap. Bunu anlama katmanına okutup ölçelim mi (D2)?
