# Doğrulanmış cevap tekrarı — tasarım (kurucu fikri 10-23 gece + Codex notu)

> Kurucu (aynen özet): "Aynı soru farklı kelimelerle geldi diyelim, anlam aynı, embedding anladı … 3'ten fazla aynı soru gelirse o host
> için o daire için tutar, 4. kez aynı soru geldiğinde otomatik doğru yanıt gider tekrar aramadan; veri eskide kalmasın diye sadece o
> cevabın verildiği dosyadaki veri kontrol edilir (değiştirilme tarihi ve gidecek cevabın bilgisi değişti mi)." · "En iyi fikri sen seç,
> en iyisini yap, acele etme." (gece kipi — soru sormadan).
>
> Codex (aynen özet): tekrar sayısı doğruluk kanıtı değildir · embedding benzerliği aynı cevabın verilebileceğini kanıtlamaz
> ("Çıkış kaçta?" ↔ "13:00'te çıkabilir miyiz?") · yalnız eski dosyanın tarihi yetmez (değişmeyen kalemin yanına yeni istisna kalemi,
> süresi dolan "bu hafta", onayı kalkan kalem) · tekrarlayan ARIZA ayrı konu · önce gönderimsiz ölç, onayla aç.

## 1. Kısaca — seçtiğim yol

**Birim = doğrulanmış cevap PARÇASI** (10-23 A'nın parçası; bütün mesaj değil), **kapsam = tek daire**, **dil = aynı dil**. Bir parça yalnız
şu üçü birden varsa tekrar kullanılır:

1. **Aynı ihtiyaç** — benzerlik ADAY bulur, izni KOD verir (`reuseGate`): aynı tür · konaklama değişikliği yok · aynı koşul (gün / mevsim) ·
   yeni sorunun her ayırt edici sözcüğü kayıtlı soruda ya da kayıtlı cevapta · sorunun yönü (saat / ücret / yer / izin / nasıl) cevapta var.
2. **Kararlılık (kurucunun "3 kez"i)** — aynı ihtiyaca BAĞIMSIZ üç taze cevap üretilmiş, üçü de doğrulayıcıdan geçmiş ve üçü AYNI bilgiyi
   (aynı değerler + aynı olumluluk) vermiş. Dördüncü soru kayıttan cevaplanır. Codex'in itirazı burada karşılanır: sayı tek başına doğruluk
   değil; her biri kodla doğrulanmış üç cevabın aynı bilgide buluşması **kararlılıktır** (modelin bir seferlik tuhaf okuması kayda girmez).
3. **Bugün hâlâ doğru** — dosya tarihine güvenilmez, içerik BUGÜNKÜ metinle yeniden sınanır (`revalidateEntry`): dayanak kalem duruyor ve
   onaylı · cevabın konusunu anan kalemlerin parmak izi aynı (ilgili kalem eklendi / değişti / silindi / onayı kalktı → geçersiz; ilgisiz
   kalem değişirse bozulmaz) · parça güncel kalemle yeni sorunun sözcükleriyle doğrulayıcıdan yeniden geçiyor (değer ↔ konu ↔ koşul ↔
   olumluluk ↔ yön + öteki kalemlerde değişke) · kayıt 30 günden eski değil (kalemde yazan "bu hafta" gibi süreli bilgi kalıcılaşmasın).

Ardından bugünkü BÜTÜN gönderim kapıları aynen (iç kaynak, sır, kod, okuyucu…). Tekrar kullanım bir kapıyı atlatmaz; yalnız cevap
modelinin yeniden yazmasını atlar.

## 2. Bugün kodda olan (envanter, Haiku + kodla doğrulandı)

| var | yer | bu iş için anlamı |
|---|---|---|
| Parça doğrulayıcısı (değer ↔ konu ↔ koşul ↔ olumluluk ↔ yön, öteki kalemlerde değişke) | `ai/answer-binding.ts` | yeniden doğrulamanın kendisi — yeni kod yok |
| Parça kipi (ihtiyaç başına cevap + alıntı) | `ai/answer-parts.ts`, `AI_ANSWER_PARTS_ENABLED` | kayda girecek birim |
| Anlama katmanı: istek türü + **Türkçe** sorgu (`query_tr`) | `ai/semantic/understand.ts` | misafir hangi dilde yazarsa yazsın kıyas Türkçe sözcükle |
| Gömme: `text-embedding-3-small`, 1536, **yalnız bellekte** | `ai/embeddings/provider.ts` | veritabanında vektör deposu YOK |
| Kalem parmak izi (`fingerprintItems`), kopya içerik izi | `retrieval/index-cache.ts`, `kb/copy-fingerprint.ts` | ilgili kalem izi aynı yöntemle |
| Tekrarlayan şikâyet örüntüsü (≥3 olumsuz / 180 gün → Mülk Hafızası) | `intelligence/memory/patterns.ts` | Codex'in "TV 4 kez bozuk" maddesi ZATEN ayrı yolda |
| Sık sorulan / bilgi tabanında olmayan (Signal, ≥3 soru) | `intelligence/recommendations/kb-gaps.ts` | panel tarafı için hazır sayaç |
| Farklı sözcükle aynı soruyu sayan bir şey | — | YOK (bu iş) |

## 3. Kayda ne girer, ne asla girmez

**Girer (ilk dilim):** giriş / çıkış saati, Wi-Fi, otopark, ulaşım tarifi, olanaklar, ev kuralları, evcil hayvan, çöp — mülke ait, kişiden
bağımsız, sabit bilgi.

**Asla girmez:** konaklama değişikliği / müsaitlik / bavul (karar ister) · giriş / kapı kodu (sır, kişiye özel) · ödeme, iade · şikâyet,
arıza, acil · insan talebi · kaynak sorusu · temizlik / havlu (çoğu hizmet isteği) · cihaz yardımı (arızayla karışır) · yerel öneri (öznel,
zamanla değişir) · göreli zaman taşıyan parça ("bugün", "tonight") · misafirin adını taşıyan parça. QR ilk dilimde yok (K7 cihaz kuralı).

**Kayıt misafir metni taşımaz:** ihtiyacın ayırt edici sözcükleri (konu etiketiyle aynı süzgeç: ad / sır / bağlantı / saldırı izi atılır) +
koşul + yön; konuşma / misafir kimliği YOK (yalnız teyit sayısı). Bu yüzden misafir silme talebinde silinecek bir şey yok; yine de 30 gün
sonra kayıt kendiliğinden geçersiz.

## 4. Akış (kanal oto-yanıtı)

```
anlama katmanı (bugünkü çağrı) → ihtiyaçlar
  └ her cevaplanabilir ihtiyaç: tekrar türü mü? → aynı daire + aynı tür + aynı dil kayıtları (bir avuç)
       → benzerlik (Türkçe sorgu gömmesi, bellekte önbellekli) ≥ eşik → reuseGate → revalidateEntry
  └ turun BÜTÜN cevaplanabilir ihtiyaçları isabetliyse: cevap modeli ÇAĞRILMAZ, kodun selamı + parçalar → bugünkü bütün kapılar
  └ biri bile kaçarsa: bugünkü akış (karışık kip ilk dilimde yok)
taze cevap gittikten sonra: doğrulanan parça → kayıt adayı (entryEligible) → aynı ihtiyacın kaydı varsa sameAnswer ise teyit +1, farklıysa
kayıt sıfırlanır (kararsız bilgi tekrar kullanılmaz)
```

**Gölge kip (ilk adım, Codex 3):** kayıtlar tutulur, isabet HESAPLANIR ama misafire taze cevap gider; her isabette kayıttaki parça ile o
turda üretilen taze doğrulanmış parça `sameAnswer` ile kıyaslanır → "kayıt yanlış olurdu" oranı ölçülür. Oran sıfırda ve yeterli hacimde
kalınca açmak kurucu kararı.

## 5. Ölçüm — benzerlik tek başına izin olabilir mi?

`evals/answer-reuse-2026-10-23.json` (geliştirme seti, 10 grup; kör set ayrıca yazılmadan anahtar açılmaz), ölçer
`tests/eval/answer-reuse-similarity.eval.test.ts`, rapor `docs/olcum/cevap-tekrari-benzerlik-2026-10-23.md`. Sonuç ve okuma: §9.

## 6. Veri modeli (migration 85 — HAZIR YAMA, kurucu onayı olmadan ana dala girmez)

```
VerifiedAnswer
  id · organizationId · propertyId (FK, Cascade) · kind · language
  terms (ayırt edici sözcükler, süzülmüş) · conditions · aspects
  partText · evidence · sourceRef ("kb:<id>" | "property") · fingerprint
  confirmations · hits · lastConfirmedAt · lastHitAt · createdAt · disabledAt (ev sahibi "kullanma")
  @@index([propertyId, kind, language])
```

Silme / dışa aktarma / saklama: mülk silinince Cascade; dışa aktarma kapsam listesinde "gerekçeli dışarıda" (misafir verisi değil, türetilmiş
işletme bilgisi); 30 gün tavanı + ilgili kalem izi kendiliğinden geçersiz kılar.

## 7. Ev sahibine görünen (ikinci dilim)

Mülk sayfasında **"Sık sorulanlar"**: soru konusu · verilen cevap · kaç kez · son kullanım · "kullanma" düğmesi; altında "bilgi tabanında
olmayan, en çok sorulanlar" (mevcut `kb-gaps` sayacı). Tekrarlayan arıza ayrı kartta kalır (Mülk Hafızası örüntüsü) — "TV 4 kez bozuk" bir
hazır cevap DEĞİL, ev sahibine giden bir sorundur; yeni bildirim eski cevap yüzünden kapanmaz.

## 8. Kodda olan (bu tur)

- `src/lib/answer-reuse/core.ts` — saf karar çekirdeği: `REUSABLE_KINDS`, `reuseGate`, `entryEligible`, `sameAnswer`, `relatedFingerprint`,
  `revalidateEntry` (13 birim testi: Codex'in örnekleri dahil — "13:00'te çıkabilir miyiz", "cam şişe", "otopark ücretli mi", yeni istisna
  kalemi, ilgisiz kalem değişimi, 3 teyit kuralı).
- Doğrulayıcıdan iki dışa açık okuma: `askedConditions`, `partSignature`.
- Hiçbir akışa bağlı DEĞİL; hiçbir şey göndermez / yazmaz. Depo + gölge kip bağlantısı migration 85 hazır yamasıyla.

## 9. Ölçüm sonucu ve karar

(ölçüm bitince doldurulur)

## 10. Kurucuya (sabah)

1. Migration 85 (yeni tablo, veri taşımaz) — onay verirseniz gölge kip (misafire HİÇBİR şey değişmez) Railway açılınca ölçmeye başlar.
2. Gölge ölçümde "kayıt yanlış olurdu" oranı 0 ve yeterli hacim → açmak sizin kararınız (önce / sonra örneğiyle tekrar sorulur).
