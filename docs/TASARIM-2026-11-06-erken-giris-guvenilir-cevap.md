# TASARIM — Erken giriş cevabı: kandırılamaz, hatasız (K-4 uzun vadeli yöntem) — 2026-11-06

> Kurucu (11-06): "K-4 evet o ifade kaldırılsın. Bu kısım için güzelce bir uzun vadeli en iyi yöntemi düşünelim; burası görece riskli bir iş,
> hata olmamalı, kesinlikle kandırılma olmamalı AI'ın cevaplarında."
> Kaynak: Opus derin kırmızı takım incelemesi (salt-okuma, saf fonksiyon sondaları; ücretli model koşusu YOK) — bulguların P1'leri tarafımdan
> kodda ayrıca doğrulandı (↓ "doğrulandı"). Kod: `src/lib/early-checkin/*`, `src/lib/automation.ts` erken giriş dalı, `src/lib/decisions/*`.

## 0. Bu turda yapılan (kurucu kararı)
- **"Daireniz hazır" kaldırıldı** (altı dil, `early-checkin/reply.ts`; pin: altı dilde "hazır" sözcükleri metinde YOK, kalıbın kendisi eski metinleri
  yakalıyor). Onay artık yalnız gün + saati (ve kayıtlı ücreti, ev sahibi notunu) söyler:

| Dil | Önce | Sonra |
|---|---|---|
| tr | Daireniz hazır; bugün (7 Kasım) saat 12:00 itibarıyla giriş yapabilirsiniz. | Bugün (7 Kasım) saat 12:00 itibarıyla giriş yapabilirsiniz. |
| en | The apartment is ready — you can check in today (7 November) from 12:00. | You can check in today (7 November) from 12:00. |
| de | Die Wohnung ist bereit – Sie können heute (7. November) ab 12:00 Uhr einchecken. | Sie können heute (7. November) ab 12:00 Uhr einchecken. |
| fr | Le logement est prêt : vous pouvez arriver aujourd'hui (7 novembre) à partir de 12:00. | Vous pouvez arriver aujourd'hui (7 novembre) à partir de 12:00. |
| ar | الشقة جاهزة ويمكنكم تسجيل الدخول اليوم … | يمكنكم تسجيل الدخول اليوم (7 نوفمبر) ابتداءً من الساعة 12:00. |
| ru | Квартира готова — сегодня … | Сегодня (7 ноября) заезд возможен с 12:00. |

## 1. Bugün SAĞLAM olanlar (değiştirmeye gerek yok)
- Söz kodda kurulur: onay metnine misafirin ya da modelin yazdığı hiçbir şey girmez; çeviri modeli onu bozamaz (altı dilde yerel kurulur).
- Saat katı biçimde okunur ve misafirin kendi yazdığı açık saatle birebir eşleşmeli; otomatik için iki bağımsız model aynı saati okumalı.
- Ev sahibinin "en erken" saatinden önceki istek ev sahibine gider; ücret yalnız ev sahibinin kayıtlı kuralından.
- Kuyruklu teslimde otomatik onay yok; çift gönderim kapalı (önce sahiplen, sonra gönder); istem enjeksiyonu kod metnini de tutar.
- Kural yoksa / kapalıysa bugünkü davranış: insan.

## 2. Zayıflıklar — sözün BAĞLAMI ve KANITIN KALİTESİ
| # | Zayıflık | Durum | Önem |
|---|---|---|---|
| Z1 | **Ev sahibinin elle "hayır"ı otomatik onayla ezilebiliyor.** Koruma yalnız karar kartlarına bakıyor ve yalnız Karar Motoru anahtarı açıkken (`automation.ts` "hostOwnsEarlyCard"); ev sahibinin sohbette elle yazdığı ret hiç sayılmıyor. | doğrulandı | P1 |
| Z2 | **"Bitti" kanıtı tek dokunuş:** görev kartındaki durum kutusundan "Tamamlandı" onay sormadan yazılıyor (yalnız "Bitti" düğmesi soruyor); tek güvence 5 dk bekleme. | doğrulandı | P1 |
| Z3 | **"Çıkıştan önce hazır" yolu tek kişinin iki dokunuşu:** ev sahibi bu yola izin verdiyse, temizlikçinin YANLIŞ dairenin kartında "Başladım → Bitti" (≥15 dk) demesi önceki misafirin "çıktığı" sayılıyor → eski misafir içerideyken yeni misafire onay gidebilir. | doğrulandı | P1 |
| Z4 | **Model metni kaçağı:** bekçi model düştüğünde ve istek o turda görülmediğinde, modelin kendi yazdığı "Saat 12'de giriş yapabilirsiniz" / "Daire hazır" cümleleri kapıdan geçebiliyor (altı dilin neredeyse hepsinde; istek görülen turda sağlam). | rapor + sonda | P1/P2 |
| Z5 | **Erişim karara girmiyor:** kapı kodu / anahtar / giriş bilgisi mesajı onaylanırken bakılmıyor ("12:00'de girebilirsiniz" → kapıda kalma). Girişler sayfası erişimi zaten ayrı gösteriyor. | rapor | P1/P2 |
| Z6 | **Gün kontrolünün yedeğinde boşluklar** (modellerin şemasında gün yok): "2026-11-07", "hafta sonu", "gelecek ay", "in a week", bazı dillerde "N gün sonra", altı dil dışı "yarın", görünmez karakter / harf benzeri. | sonda | P2 |
| Z7 | **Tek-istek zarfı yok** (doğrulanmış müsaitlikte var: tek mesaj, en çok bir soru işareti, en çok 300 karakter) · başka daire sinyali yok · metin daireyi adlandırmıyor. | rapor | P2 |
| Z8 | **Gönderim anında yeniden doğrulama yok; gönderim SONRASI izleyici yok** (görev yeniden açıldı, temizlikçi notu, rezervasyon değişti → ev sahibine uyarı yok). Karar Motoru kapalıyken otomatik onay Girişler'de ve temizlikçi kartında görünmüyor; görev notu tarihsiz. | rapor | P2 |

## 3. İlke (uzun vadeli)
**Söz yalnız koddan çıkar; her söz bir OLGUYA (kaynak + yazan + an + geçerlilik) dayanır; gönderim anında yeniden doğrulanır; zarfın dışındaki
her durum ev sahibine TASLAK olur. Model yalnız ANLAR (istek, saat, gün, tek konu) — hiçbir zaman söz vermez; söz sınıflarını (saat izni,
hazırlık, erişim, ücret) taşıyan model metni yapısal olarak tutulur.** Bugünkü mimari bunun çoğunu yapıyor; eksik dört parça: ev sahibinin
sözü ve erişim olgu değil · hazırlık tek kaynaklı · gönderim anı / sonrası doğrulama yok · model metninde söz sınıfları tanınmıyor.
Hepsinin yönü aynı: **otomatik gönderimi AZALTIR** (şüphede taslak) — misafire giden onay METNİ değişmez. Migration gerekmez.

## 4. Önerilen dilimler (öncelik sırası) — önce / sonra örnekli
**E1 — Ev sahibinin sözü kazanır (Z1, P1).** Bu konaklamada ev sahibi, ilk erken giriş isteğinden SONRA elle bir mesaj yazdıysa otomatik onay
YOK → doğrulanmış taslak ev sahibine. Karar Motoru anahtarından bağımsız.
> 09:10 misafir: "12'de girebilir miyiz?" · 09:30 ev sahibi (elle): "Maalesef bugün tesisatçı var." · 13:05 misafir: "Temizlik bittiyse 13:30
> olur mu?" → **bugün:** temizlik bittiyse otomatik "Bugün … 13:30 itibarıyla giriş yapabilirsiniz." GİDER (ev sahibinin sözü çiğnenir) ·
> **sonra:** gitmez; ev sahibine taslak + "Bu konaklamada daha önce siz yazdınız".

**E2 — Hazırlık iki kaynaklı (Z2, Z3, P1).**
- Otomatik onay için hazırlık = ayrılan konaklamanın sistem çıkış temizliği görevinde, İKİSİ DE çıkıştan sonra kimlikli "Başladım" → "Bitti"
  (aralık ≥ 20 dk). Tek "Bitti" ya da durum kutusundan "Tamamlandı" TASLAK için yeter, otomatik için yetmez.
- "Çıkıştan önce hazır" yolu yalnız TASLAK (ikinci bağımsız ayrılış sinyali yoksa).
- Durum kutusundan temizlik görevini "Tamamlandı"ya çekmek de "İş bitti mi?" onayından geçer (personele giden metin aynı onay penceresi).
> Temizlikçi Ayşe yanlışlıkla Lale 5'in kartında "Başladım", 20 dk sonra "Bitti" der; Lale 5'in önceki misafiri hâlâ içeride → **bugün:** izin
> verilmiş dairede yeni misafire otomatik onay gidebilir · **sonra:** ev sahibine taslak; misafire bir şey gitmez.

**E3 — Deterministik otomatik zarf (Z6, Z7, P1/P2).** Otomatik onay yalnız şu zarfın içinde; dışı → aynı metin TASLAK:
tek cevapsız mesaj, en çok bir soru işareti, en çok 300 karakter · dil zarfın dillerinden biri · metin kontrollerinden önce görünmez karakter
+ harf benzeri temizliği (deponun standardı) · bugünü göstermeyen her tarih biçimi ve göreli zaman ("hafta sonu", "gelecek ay", "in a week",
"через 3 дня") · kişi sayısı ya da başka daire geçiyorsa. **Bu kelime ağını büyütmek değil:** yalnız otomatiği DURDURAN güvenli-yön bir zarf;
hiçbir şeye izin vermez.
> "Merhaba, 2026-11-08'de saat 12'de girebilir miyiz?" (bugün 7 Kasım) → **bugün:** gün yedeği tireli tarihi görmüyor, modeller de yanlış
> okursa "bugün 12:00" onayı gidebilir · **sonra:** taslak.

**E4 — Model metninde söz kemeri (Z4, P1/P2).** Model cevabı GİRİŞ konusuna değiyor VE (a) olgularda olmayan bir saat söylüyor ya da (b) daireyi
hazır / boş / temiz ilan ediyorsa → tutulur (ev sahibine). Bekçi model düşmüşse giriş / çıkış konulu model cevabı tutulur. Yeni sözlük değil:
Karar Motoru metninde zaten uygulanan ilkenin (`decisions/text-check.ts`) genellemesi.
> Bekçi düşmüş turda model: "Saat 12'de giriş yapabilirsiniz." → **bugün:** gidebilir · **sonra:** tutulur, ev sahibine.

**E5 — Gönderim anında yeniden doğrulama + gönderim sonrası izleyici + görünür kayıt (Z8, P2).**
- Karar anındaki olguların parmak izi (devir, hazır kaydı, açık görevler, kural, rezervasyon tarihi / durumu, önceki çıkış saati); göndermeden
  HEMEN önce yeniden okunur — değiştiyse gitmez.
- Onay gittikten sonra onaylanan saate kadar her senkron turunda hazırlık yeniden ölçülür; bozulursa (görev yeniden açıldı, temizlikçi notu,
  açık bakım, rezervasyon değişti, önceki misafire geç çıkış verildi) ev sahibine ACİL e-posta. Misafire otomatik "geri çekme" mesajı YOK
  (yanlış alarmda ikinci yanlış mesaj olur; isterseniz sorarız).
- Otomatik onay Karar Motoru anahtarından BAĞIMSIZ kaydedilir → Girişler'de ve temizlikçi kartında "Erken giriş 12:00 (otomatik onay)";
  görev notu tarihli ("7 Kasım: erken giriş 12:00 otomatik onaylandı").

**Sonraki adımlar (kurucu kararı ister):**
- **E6 — Erişim bir olgu (Z5):** giriş bilgisi mesajı gitti ya da giriş hazırlığı görevi kapandı; kurala isteğe bağlı "Kapı kodu / anahtar en
  erken şu saatte hazır" alanı (ev sahibi formu değişir).
- **E7 — Gün birinci sınıf olgu:** anlama + bekçi şemalarına isteğin GÜNÜ; iki model aynı günü okumalı (ücretli ölçüm ister).
- **E8 — Sınırlı otomatik kip:** konaklama başına en çok bir otomatik onay; mülk başına ilk 5 doğrulanmış onay "gölge" (taslak + "otomatik
  olsaydı giderdi" kaydı), sonra otomatik.
- **E9 — Kırmızı takım regresyon seti (süreç, her dilimle):** raporun 39 saldırı satırı + sonda girdileri pinli testlere; ölçüt "otomatik
  gitmemesi gereken gitti mi" = SIFIR; ayrı ajanın yazdığı kör batarya (10 dil), ayar yapılmaz.

## 5. Reddedilenler
- Otomatik kipi tamamen kaldırmak (kurucu 09-24: "hassas istek = ENGEL değil, doğrulama iş akışı") — zarf + iki kaynak yeterli.
- Temizlik için fotoğraf zorunluluğu — sürtünme yüksek, fotoğraf doğrulanamaz.
- Misafire otomatik geri çekme mesajı — önce ev sahibine acil uyarı.
- Kelime ağını izin cümleleriyle büyütmek — kurucu kararıyla yasak; E3 / E4 yalnız TUTAR.

## 6. Kurucu soruları
- **EK-1** E1–E5 bu sırayla yapılsın mı? (Hepsi otomatik onayı azaltır, misafire giden metin aynı; bedeli: bazı geçerli istekler anında cevap
  yerine sizin onayınızla gider.) Önerim: evet.
- **EK-2** E3'teki zarf (tarih biçimi / göreli zaman / kişi sayısı / başka daire → taslak) kelime ağı yasağının kapsamına girer mi? Önerim: girmez
  — yalnız durdurur, hiçbir şeye izin vermez.
- **EK-3** İspanyolca onay satırı eklensin mi? (Bugün İspanyolca misafire İngilizce gider.) "Puede hacer el check-in hoy (7 de noviembre) a
  partir de las 12:00."
- **EK-4** Onay metninde dairenin adı geçsin mi? (Birden çok rezervasyonu olan misafirde yanlış daire anlaşılmasın.) "Lale 3 için bugün
  (7 Kasım) saat 12:00 itibarıyla giriş yapabilirsiniz." — ilan adı mı, iç ad mı?
- **EK-5** Otomatik onay metni ile Karar Motorunun "Erken giriş talebiniz onaylandı: …" metni tek aile olsun mu? Önerim: evet (tek ses).
- **EK-6** E6 (erişim) ve E8 (sınırlı otomatik) — şimdi mi, E1–E5'ten sonra mı? Önerim: sonra.
