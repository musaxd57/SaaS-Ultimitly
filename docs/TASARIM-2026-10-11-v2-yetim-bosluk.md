# V2 dilim — "Dikkat Gerektirenler"de yetim boşluk satırı

> 2026-10-11 gece. Kurucu onayı (10-11): "Evet ekle yalnız … değer uydurmayalım" + "Airbnb API alınca oradan, takvimden çekeriz".
> → Satır ANA DALDA, anahtar `ATTENTION_GAP_ENABLED` (tam "1", varsayılan kapalı; açmak = env). TUTAR YOK: gerçek gecelik fiyat Airbnb Direct
> takviminden gelince eklenir (ev sahibinin girdiği aralıktan tahmini "olası gelir" ilk taslakta vardı, kurucu kararıyla kaldırıldı).

## Neden (talimatın kendi örneği)

Kurucu talimatı 09-07, V2 Exception Feed: "💰 REVENUE LEAK · 2-night gap detected · 11 days from now · Estimated opportunity …". Panoda bugün
çakışma / söz / cevapsız mesaj / bağlantı satırları var; "iki konaklama arasında satılmadan kalan kısa boşluk" yoktu.

## Ne yapıyor (önce / sonra)

**Önce:** 3–6 Ekim ve 7–10 Ekim konaklamaları arasındaki 6 Ekim gecesi panoda görünmez.

**Sonra (anahtar açık):**

```
📅 İki konaklama arasında 1 gece boş görünüyor
   Lale · 6 Eki gecesi · kısa konaklamaya açmak isteyebilirsiniz
```

Tıklayınca takvim o ayla açılır. Mülk başına TEK satır (en yakın boşluk + "N boşluk daha").

## Kurallar (kodda + testli)

- Boşluk = iki KESİN konaklama arasında 1–2 boş gece (`ORPHAN_GAP_MAX_NIGHTS = 2`; 3+ gece sıradan boşluk). Saf dedektör
  `src/modules/availability/gaps.ts`; yükleme çakışmayla TEK sorgu (`findUpcomingConflictsAndGaps`).
- TAHMİN YOK (değişmez 6 / 15): yalnız müsaitlik motorunun gece durumları.
  - Kapsama kaynağı (takvim bağlantısı) bayat / hatalı / hiç yoksa geceler "bilinmiyor" → satır YOK.
  - Onay bekleyen talep komşu sayılmaz (talep reddedilirse boşluk yetim değil).
  - Komşulardan biri kanıtsızsa (kaynağı / bağlantısı olmayan kanal satırı — hayalet olabilir) satır "kayıtlardan biri güncel olmayabilir,
    doğrulayın" der ve bir basamak aşağıda sıralanır.
  - Bu geceki boşluk sayılmaz (son dakika; komşusu dün görülmüyor).
- Tutar YOK (kurucu kararı). Sıra: risk satırlarının (çakışma, söz, cevapsız mesaj) ALTINDA; paraya göre sıralama / portföy toplamı YOK.
- Kanala hiçbir şey yazılmaz (minimum konaklama / fiyat yazma yeteneği yok); satır yalnız bilgi + öneri.

## Bilinen sınırlar

1. **Hospitable'a bağlı dairelerde bugün satır ÇIKMAZ:** kanal bağlantısı kaynağının tazelik kaydı yok (`lastSuccessAt: null`) → motor
   "bilinmiyor" sayar. Satır taze TAKVİM BAĞLANTISI (iCal) olan dairelerde çıkar.
2. 🚨 **İleride:** bağlantı sağlığı motora bağlanırsa (migration 60 C, ayrı onay) köprü ev sahibinin kanalda ELLE KAPATTIĞI geceleri çekmediği
   için (yalnız `/reservations`) kapalı gece "boş" görünür → sahte boşluk + sahte müsaitlik (`docs/claude/ai-guvenlik.md` uyarısı). Airbnb
   Direct takvimi (fiyat + blok + minimum konaklama) bunu kökten çözer.
3. iCal'de kanalın "Not available" blokları içe aktarmada konaklama olarak yazılıyor (süzgeç yok) → o geceler DOLU sayılır (sahte boşluk
   yok; yan etki: blok takvimde konaklama gibi görünür — ayrı konu).
4. Takvim satırları `feedLastSeenAt` olmadan (`ICAL_DISAPPEARANCE_RECONCILE_ENABLED` kapalı) kanıtsız sayılır → takvim bağlantılı dairelerde
   satırlar çoğunlukla "doğrulayın" ekiyle çıkar.
5. Saat dilimi: TZID'li ve tam 00:00Z'ye düşen iCal girişi bir gün kayabilir (motorda belgeli genel sınır).

## Kanıt

- Birim (dedektör, 10): devir günü boşluk değil · 1 / 2 gece · 3 gece yetim değil · bilinmeyen gece içte / kenarda · onay bekleyen komşu ·
  aralık kenarı · kanıtsız komşu · çoklu · motorla uçtan uca (bayat kaynak, iptal komşu).
- Bütünleşme (gerçek PostgreSQL): anahtar kapalı → yok · 1 gece (ev sahibi aralığı OLSA BİLE tutar yok) · mülk başına tek satır + sayı + uzak
  önem · kapsama bayat / yok / geniş boşluk · kanıtsız komşu → çıkarım + düşük önem · çakışmanın altında + kiracı yalıtımı · TEK yükleme.
- UI: metin, sayı, "doğrulayın"; hiçbir tutar / "gelir" sözü yok.
- Mutasyon 13/13 + 2/2 (tutarlı sürümde); Haiku incelemesi: 1 bulgu kodla reddedildi (köprü bugün "kayıtsız"), 3 bulgu uygulandı.
