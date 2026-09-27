# İnceleme 09-27 — Codex'in 6 bulgusu + 10 inceleme ajanı (takip)

> Kurucu /loop (09-27): "Codex'in 6 bulgusu ve 10 inceleme ajanının bulguları üzerinde çalış … doğruysa kırmızı-önce + düzeltme +
> mutasyon … müşteriye gidecek mesaja dokunan düzeltmeyi önce/sonra örneğiyle sor." Kurucu ek kuralı (09-27): "Codex'in / ajanın
> önerisini hemen kabul etme; kolay + doğru + müşteriye gideni etkilemiyorsa yap, etkiliyorsa bana sor; daha iyisini biliyorsan itiraz et."
> Bu belge DURUMU tutar (kod değil). Ajan betikleri scratchpad'deydi; burada yalnız hüküm + örnek.

## Codex (6 + 1)

| # | Bulgu | Doğrulama | Durum |
|---|---|---|---|
| C1 | Tek kalemde iki koşulsuz çıkış saati ("Çıkış 11:00. Çıkış 12:00.") çelişki sayılmıyor | çalıştırıldı, DOĞRU | düzeldi (`kbPropertyMismatch`), RC10 |
| C2 | "Çıkıştan sonra 12:00'de anahtarı bırakın" çıkış 12:00 okunuyor | DOĞRU | düzeldi (başvuru sonrası saat), RC10 |
| C3 | Yönetici "AI öner" rotası rezervasyonsuz konuşmada sır süzgecini atlıyor | DOĞRU (4 durumda sızıyordu) | düzeldi (`kbForStayScope` tek kural), RC10 |
| C4 | Holdout koşusu kapı değil; belge iki soru için %90 | DOĞRU | kapı yazıldı → **kurucu kararı (Codex'le): %95 zorunlu değil, rapor çizgisi; kabul cevap düzeyinde vaka başına** — getirme düzeyinde yalnız sızıntı + eksik koşu kırmızı |
| C5 | Ölçer önbellek anahtarı model / istem / çaba görmüyor | DOĞRU (+ istem her dakika değişiyordu) | düzeldi; 27.09'un 552 ücretli cevabı yeni anahtara taşındı (tablo birebir) |
| C6 | İki sorulu cevapta herhangi bir çapa başarı sayılıyor | DOĞRU (34→31, 36→33 / 46) | düzeldi (`answerAnchorHits`) |
| C7 | Küçük-KB 24k eşiği satır başına 1 karakter eksik sayıyor (+ `{isim}` ikamesi) | DOĞRU (A5 F5 de buldu) | **KARAR BEKLİYOR** — sınırdaki (~30–200 karakter) bilgi tabanında en eski kalem düşüyor; birebir hesap o pencerede "soruya göre seçim"e (bugün 6k) geçirir. Öneri: geniş blokla birlikte |
| — | "3 parça sınırı kötü değil mi?" (kurucu ↔ Codex) | ölçüldü (ücretsiz): tek rehberde 4 soru 0/10 → soru başına tavanla 9/10; dev setinde fark 0 | `itemCapScope: "question"` KAPALI seçenek; **AÇMAK KARAR BEKLİYOR** |
| — | Saat okuyucusu hızlandırma "iki kez okumayı kaldırma yorumu etkiler" | ölçüldü: 54.723 hedefli karşı örnek (tireli aralık × biçim × ayırıcı) + 21.109 genel girdide fark 0; cevap başına 250→133 ms (24k rehber), 47→14 ms (30 kalem) | itiraz: yorum değişmez (aynı girdiyle aynı saf fonksiyonun ikinci çağrısı); ayrı commit |

## Ajanlar

| Ajan | Konu | Öne çıkan (doğrulanan) | Müşteriye dokunur mu | Durum |
|---|---|---|---|---|
| A1 | saat alanı TR | 12 bulgu: "Giriş 14'ten itibaren" okunmuyor; "Giriş ve çıkış saatleri 15:00 ve 11:00" girişi kaybediyor; "-tür" eki "tur" (gezi) sanılıyor; "En geç giriş 22:00" sahte çelişki; "Daireden 11:00'de çıkmanızı rica ederiz" okunmuyor | evet (kapı / istem notu) | KARAR BEKLİYOR (09-27 "didik didik" turunun devamı) |
| A2 | saat alanı EN/diğer | 12 bulgu: "Check-in is available from 2 pm to 10 pm." hiç okunmuyor ("availab" iletişim sanılıyor); "12 noon" / "4p.m." okunmuyor; "Latest check-in is 10 pm." sahte çelişki; "€10.00" saat okunuyor | evet | KARAR BEKLİYOR |
| A3 | saat alanı akış + performans | 11 doğruluk + performans: tek kalem 1,6–2,5 sn kilit | performans: hayır (fark 0) | performans DÜZELDİ (ayrı commit); doğruluk KARAR BEKLİYOR |
| A4 | kör batarya 4 | doğru 24/30, tuzak 27/30; "Latest check-in 22:00" sahte çelişki, "sefer" ulaşım değil, gün.ay tarihi saat | evet | KARAR BEKLİYOR |
| A5 | seçici | F1 çelişki kopyaları diğer sorunun cevabını itiyor · F2 isabetsiz alt sorgu legacy cevabını kaybediyor · F3 virgüllü liste 4 arama yuvasını doldurup sonraki soruyu aramıyor · F4 anlama katmanı özgün adayı payla düşürüyor · F5 = C7 · F6–F10 küçük | evet | KARAR BEKLİYOR |
| A6 | yeniden sıralayıcı | #1 işaret ikinci sorunun cevabını tamamen çıkarabiliyor · #2 soru metni redaksiyondan önce kırpılıyor · #3 çit taklidi · #4–#9 gözlem / maliyet | #1 evet; #2 #3 güvenlik sertleştirmesi | KARAR BEKLİYOR |
| A7 | bayraklar + gömme | #1 AI_* bayrakları "true" yazımını sessizce kapalı okuyor · #2 ısıtma tam dizin kuruyor (60×20k'da 5,7 sn, diğer kiracıların önbelleğini atıyor) · #3 gömme 4xx sessiz · #4 ısıtma bütçesi | #1 açılış uyarısı hayır; #2 hayır (performans) | #2 sıradaki (fark-sıfır); #1 yalnız açılış UYARISI (davranış değişmez) |
| A8 | sır / kiracı | B1 = C3 · B2 QR sayfası her GET'te KB yüklüyor · B3 oto-yanıt sır taraması yalnız ikame SONRASI (uzun ad sırrı pencereden çıkarıyor; QR ham+ikame) · B4 KB kopyalama kiracı testi yok · B5 boşluklu yer tutucu parça sınırında · B6 ısıtma bütçesi | B3 evet (sıkılaştırma) | B3 KARAR BEKLİYOR (güvenlik paritesi) |
| A9 | ölçer bütünlüğü | #1 çelişki grubunda ilgisiz not "blokta" sayılıyor · #2 = C6 · #3 `prod` canlı yol değil · #4 geçmiş biçimi üretimden farklı · #5 "uydurma 0" kör · #6 arıza muhasebesi · #7 holdout mühürsüz · #8 perq+wide bütçe > KB · #10 sızıntı grupları | hayır (ölçer) | #10 + kapı itirazları DÜZELDİ; #1 #3 #7 #8 sıradaki |
| A10 | kök sökücü + sözlük | "hastane / noise / waste / üşüyor / ısınmıyor" hiç aranmıyor; "Gürültü kuralı" → kargo; "Şifremi unuttum" → internet yok; "Are dogs allowed?" → sonuç yok; "aç-" klima, "açılıyor" acil | evet | KARAR BEKLİYOR |
