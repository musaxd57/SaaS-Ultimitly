# Tasarım — çoklu istek, bilgi/izin ayrımı, tarih-saat yuvaları ve temizlikçi "hazır" işareti (09-24)

Durum: **TASARIM, kod yok.** İki kurucu girdisi: (1) dış inceleme — "sistem şu soruları güvenilir cevaplamalı:
misafir ne istiyor, kaç ayrı soru soruyor, istenen saat/tarih ne, bilgi sorusu mu izin talebi mi?"; (2) kurucu
fikri — "temizlikçi bitirince işaretlesin; misafir '1,30'da gelebilir miyim' deyince sistem anlayıp onaylasın; eski
fotoğrafla karışmasın; yanlışlıkla girmeye karşı ufak bir tik düğmesi".

Mimari aynen korunur: **model bilgi çıkarır, kararı kod verir** (`docs/ANLAM-KATMANI-2026-09-24.md`). Her şey
yalnız sıkılaştırır; otomatik onay en sona, eval + ev sahibi kuralı + kurucu onayıyla gelir.

---

## A. Çoklu istek ve bilgi/izin ayrımı

### Bugün ne var
Anlama katmanı (`semantic/understanding-schema.ts`) mesajı zaten **birden çok isteğe** böler (en fazla 5), her
biri kapalı bir niyet + arama sorgusu taşır. Konaklama değişikliği ise TEK bir `stay_change` yuvasıdır. Eksikler:
* istek başına **tür** yok: "Check-in kaçta?" (bilgi) ile "Saat 12'de gelebilir miyiz?" (izin) aynı niyet
  ailesinde, farkı yalnız `early_checkin` etiketi taşıyor;
* bir mesajda iki konaklama değişikliği ("erken girip geç çıkabilir miyiz?") tek yuvaya sığmıyor;
* tarih yok, yalnız saat var; göreli tarih ("yarın", "cuma") çözülmüyor.

### Şema değişikliği (istek başına)
```
requests[i] = {
  intent,                         // bugünkü kapalı küme
  type: "info" | "permission" | "report" | "social" | "other",
  time:  "HH:MM" | null,          // model saati çıkarır ("öğlen" → 12:00, "1,30" → 13:30 + gerekçe kodda)
  date:  { rel_days: int|null,    // bugün=0, yarın=1
           weekday: "mon".."sun"|null,
           month: 1..12|null, day: 1..31|null } | null,
  query_tr, query_original        // bugünkü sorgu alanları
}
```
Structured Outputs strict: her alan zorunlu, boş değer `null`. Kod her alanı AYRICA doğrular (bugünkü kural).

### Kodun kararı
1. **Tarih çözümü KODDA** (#114 ile birlikte): `currentLocalDate` + org saat dilimi + konaklama tarihleri.
   "Cuma" bugün cumaysa belirsizdir → en fazla bir soru. Çözülen her tarih kanıta `{tarih, dayanak, güven}` olarak
   yazılır. Bugün istemdeki `fmtDate`/`buildTimelineContext` UTC ile biçimliyor (gece yarısına yakın bir gün kayması
   riski) — aynı dilimde düzeltilir.
2. **İstek başına hüküm:** `permission` + konaklama niyeti = hassas (bugünkü değişmez); `info` + mülkün doğrulanmış
   alanı (giriş/çıkış saati, wifi...) = cevaplanabilir; `report` = şikâyet yolu; `social` = kapı dışı.
3. **Mesaj hükmü = en katı istek:** tek bir hassas istek bütün cevabı insana bırakır ("Yarın 12 gibi gelebilir miyiz,
   bir de valiz bırakabilir miyiz?" → iki izin talebi → insan; "Check-in kaçta? wifi şifresi?" → iki bilgi → gider).
4. Saat kıyası bugünkü gibi KODDA (`slotTimesShifted`); istenen saat mülkün standardına eşitse izin değil bilgidir.

### Eval
Yeni alanlar etiketlenmeden açılmaz. Mühürlü final seti (`docs/EVAL-MUHURLU-FINAL.md`) bu alanları taşımıyor; bir
sonraki kör set istek başına `type` + çözülmüş tarih/saat etiketiyle yazılır. Açma sırası: gölge (yalnız kanıt) →
eval → kurucu onayı.

---

## B. Temizlikçi "hazır" işareti → erken giriş kararı

### Bugün ne var (şema değişikliği GEREKMEZ)
`Task` (tür `cleaning` / `checkin_prep`, durum `todo → in_progress → awaiting_review → done`, atanan kişi,
rezervasyon bağı) ve `TaskUpdate` (durum, not, `photoUrl`, **sunucu zamanı** `createdAt`, yapan kullanıcı). Yani
"hazır" = temizlikçinin görevi `done` (ya da ev sahibi onayı isteniyorsa `awaiting_review`) yapan kaydı.

### Kurallar
1. **Sinyal TİKTİR, fotoğraf değil.** Karar temizlikçinin açık "Daire hazır" işaretine dayanır. Fotoğraf yalnız
   kanıttır; yapay zekâ fotoğrafa bakıp "hazır" HÜKMÜ VERMEZ (görsel yorumlama karar yolunda yok). Böylece "eski
   fotoğrafı yenisiyle karıştırma" sınıfı hata yapısal olarak imkânsızdır.
2. **Zaman sunucudan:** hazır anı = `TaskUpdate.createdAt` (sunucu damgası). Fotoğrafın EXIF zamanı ya da
   telefon saati kullanılmaz.
3. **Tazelik:** işaret yalnız bir ÖNCEKİ misafirin çıkışından SONRA atıldıysa sayılır (aynı daire, aynı devir). Dünkü
   devrin işareti bugüne taşınamaz.
4. **Yanlışlıkla dokunma:** iki adım — "Daire hazır mı?" → "Evet, hazır". İşaret 5 dakika boyunca geri alınabilir ve
   bu sürede kullanılmaz; ev sahibi her zaman geri alabilir (geri alma = yeni bir `TaskUpdate`, geçmiş silinmez).
5. **Karar KODDA:** misafir "13:30'da gelebilir miyim?" → anlama katmanı `early_checkin` + `13:30` çıkarır → kod:
   (a) müsaitlik motoru o gün çakışma yok diyor, (b) taze hazır işareti var ve saati ≤ 13:30 (ya da şimdi),
   (c) ev sahibinin kuralı "hazırsa erken girişi otomatik onayla" açık. Üçü birden doğruysa cevap, doğrulanmış
   araç sonucu (`verifiedToolResults`) olarak "Daireniz hazır, 13:30'da giriş yapabilirsiniz" der — bu, bugün her
   izni durduran müsaitlik vetosunun "iddia yalnız DOĞRULANMIŞ sonuçla eşleşirse" koşulunu karşılayan ilk yol olur.

### Dilimler (her biri ayrı onay)
1. **Host'a görünür ipucu (ilk dilim, güvenli):** konuşma panelinde erken giriş isteğinin yanında "Temizlik 13:02'de
   tamamlandı (işaretleyen: temizlik görevlisi) · önceki misafir 11:00'de çıktı". Yapay zekâya BAĞLI DEĞİL.
2. **Taslağa doğrulanmış sonuç:** ipucu cevap taslağına araç sonucu olarak girer; otomatik gönderim yine yok.
3. **Otomatik onay:** ev sahibi kuralı (varsayılan KAPALI) + eval + kurucu onayı. İlk sürümde yalnız bugünkü
   varış ve yalnız mülkün izin verdiği en erken saate kadar.

### Açık sorular (kurucu)
* Temizlikçinin kendi girişi var mı, yoksa ev sahibi mi işaretliyor? (Rol `staff` bugün var; mobil akış sade olmalı.)
* Ücretli erken giriş (ör. 20 €) teklif metni ile otomatik onay birleşsin mi, yoksa ücret her zaman ev sahibine mi?
