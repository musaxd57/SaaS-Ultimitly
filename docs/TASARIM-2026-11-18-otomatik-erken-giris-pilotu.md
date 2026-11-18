# Tasarım 2026-11-18 — Otomatik erken giriş: dar pilot + örneklerle besleme (H-3)

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`, H-3): "Otomatik erken girişe dar pilotla evet.
> Önce yalnız ücretsiz, saati açık ve hostun önceden yetkilendirdiği talepler. Gönderim anında rezervasyon, önceki misafirin çıkışı, temizlik,
> açık engeller, erişim ve misafirin son mesajı yeniden değerlendirilir. … 12:30 son karar saatiyse, 12:40'ta temizlik bitti diye otomatik
> 13:00 onayı çıkmamalı. Ücretli erken giriş ayrı akış; fiyatı bildirmek ücretin kabul edildiği veya tahsil edildiği anlamına gelmez."
> Kurucunun kendi notu: "bunu testlerle yapalım … kesinlikle fine tuning yapmalıyız, modeli örneklerle beslemeliyiz."
> Önceki belge: `docs/TASARIM-2026-11-06-erken-giris-guvenilir-cevap.md`.

## 1. Bugün ne var (çoğu hazır)

Erken giriş akışı zaten kanıt modeliyle çalışıyor (`src/lib/early-checkin/`): daire başına kural (kapalı · taslak · otomatik; en erken saat;
ücret; not), karar çekirdeği (`decideEarlyCheckin`), temizlik kanıtı (kimlikli "bitti", başlangıç–bitiş arası süre, oturma payı), önceki
misafirin çıkışı, çakışma, açık sorun, bagaj; saat iki bağımsız model okumasından (anlama + bekçi) ve aynıysa; temizlik bitince bekleyen
istekler yeniden değerlendirilir. Otomatik onay yalnız: kural "otomatik" + bütün kontroller + iki model aynı saat + tek konulu mesaj.

## 2. Pilot için eksikler

| # | Kurucunun şartı | Bugün | Yapılacak |
|---|---|---|---|
| 1 | yalnız ÜCRETSİZ talepler | ücret tanımlıysa da otomatik onay gidebiliyor (metin ücreti söylüyor) | ücret tanımlı kuralda otomatik onay YOK → taslak (ev sahibi gönderir). Ücret bildirmek kabul / tahsil değildir |
| 2 | son karar saati | yok — tek sınır "istenen saat + 15 dk geçti" | kurala "en geç karar: istenen saatten N dakika önce" alanı; o an geçtiyse otomatik onay çıkmaz, taslak olur |
| 3 | gönderim anında misafirin SON mesajı | otomatik onay o turun mesajına bakar; temizlik bitince gelen yeniden değerlendirmede misafirin sonradan yazdığı ("vazgeçtik", "14:00 olsun") okunmuyor olabilir | yeniden değerlendirmede istekten sonra misafir yazdıysa otomatik onay yok → kart (ölçülecek; koddan doğrulanacak) |
| 4 | erişim | giriş bilgisinin hazır olduğu otomatik onayın şartı değil | otomatik giriş mesajı gönderilemeyecek durumdaysa (metin yok / doldurulamıyor) otomatik onay yok |

1 ve 2 karar çekirdeğinde küçük, saf değişikliklerdir (yalnız TUTAR — otomatik onay azalır, hiçbir yeni onay doğmaz). 3 ve 4 önce ölçülür.

### 2.1 Durum (11-18 gece) — 1 ve 2 YAZILDI

- **1 · yalnız ücretsiz:** anahtar `EARLY_CHECKIN_FREE_ONLY_ENABLED` (VARSAYILAN KAPALI). Açıkken kuralında ücret yazılı dairede onay
  kendiliğinden gitmez; hazır cevap (ücretiyle birlikte, aynı metin) size gelir, panelde "Erken giriş ücretli; onay kendiliğinden gönderilmez,
  hazır cevabı siz gönderin." satırı çıkar; kural formu otomatik kipte ücret yazılınca bunu söyler. Anahtarın arkasında olmasının sebebi: bugün
  ücretli + otomatik kural onayı ücretiyle birlikte kendiliğinden gönderiyor (var olan, testli davranış) — bunu değiştirmek sizin kararınız (EG-2).
- **2 · son karar payı:** daire kuralında isteğe bağlı alan (anahtarsız; alan boşsa bugünkü davranış). Kural formunda otomatik kipte
  "Otomatik onay en geç ne zaman verilsin?" → Sınır yok · İstenen saatten 15 / 30 / 60 dakika öncesine kadar. Pay geçtiyse onay kendiliğinden
  çıkmaz, hazır cevap size gelir ("İstenen saate çok az kaldı; onay kendiliğinden gönderilmez, hazır cevabı siz gönderin."). Sınır anı dahildir
  (pay 30, istek 13:00 → 12:30'da hâlâ otomatik, 12:31'de değil).
- Uçtan uca senaryolar (`tests/integration/early-checkin-scenarios.test.ts` P1, P2): ücretli + anahtar açık → taslak · ücretsiz → otomatik ·
  pay 30, temizlik 12:35'te bitti, 12:41'de yeniden bakıldı → otomatik onay yok · temizlik 12:15'te bitti → onay gider.
- **3 · misafirin son mesajı — ölçüldü, kod gerekmedi:** temizlik bitince yapılan yeniden bakış yalnız, tutulan istek HÂLÂ konuşmanın son
  misafir mesajıysa çalışıyor. Misafir arada yeniden yazdıysa ("vazgeçtik", "15:00'te geleceğiz") eski istek yeniden açılmıyor, onay çıkmıyor;
  yeni mesajı olağan geçiş okuyor. Bu davranış senaryo testiyle sabitlendi (P3, iki durum).
- **4 · erişim — ölçüldü, KARAR SİZDE (EG-4):** bugün giriş bilgisinin gönderilmiş olması otomatik onayın şartı değil. Giriş mesajı olağan
  akışta varıştan önce gittiği için çoğu durumda misafirin elinde olur; ama otomatik giriş mesajı kapalıysa, metni eksikse ya da mesaj
  tutulduysa onay "12:00'den itibaren giriş yapabilirsiniz" der ve misafir kapıya giriş bilgisi olmadan gelebilir.

## 3. Testler (kurucu: "testlerle yapalım")

Senaryo tablosu (`tests/integration/early-checkin-scenarios.test.ts` üstüne): her satır = saat çizelgesi + beklenen sonuç. Pilot satırları:
ücretsiz + her şey hazır → otomatik onay · ücretli + her şey hazır → taslak · son karar saati 12:30, temizlik 12:40'ta bitti → taslak (otomatik
onay YOK) · temizlik 12:20'de bitti → otomatik onay · misafir sonradan "vazgeçtik" yazdı → hiçbir şey · giriş mesajı metni yok → taslak.

## 4. Örneklerle besleme ve ince ayar

Erken giriş isteğini OKUMAK anlam işidir (istek mi bilgi sorusu mu, saat açık mı, misafir ücreti kabul ediyor mu, vazgeçti mi) — modele
bırakılır; kod sonucu doğrular (saat iki okumada aynı mı, alıntı metinde mi).

- **Örnek bankası:** etiketli örnekler tek biçimde (mesaj, dil, beklenen okuma, not). İki ayrı küme: `eğitim` (isteme örnek olarak girebilir /
  ince ayar verisi) ve `ölçüm` (asla eğitime girmez). Kör kabul seti ayrıca mühürlenir. Söz okuyucusuyla aynı düzen
  (`docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md` §5).
- **Yol (a) — isteme benzer örnek ekleme:** gelen mesaja en benzer etiketli örnekler isteme eklenir (var olan gömme altyapısı). Ucuz, hemen
  denenir; kredi gelince ölçülür.
- **Yol (b) — ince ayar:** örnek bankasından eğitim dosyası üretilir. Kullanılan modelin ince ayarı destekleyip desteklemediği kredi gelince
  doğrulanacak (bugün bilinmiyor); desteklemiyorsa (a) kalır.
- **Karar:** iki yol da AYNI ölçüm setinde, bugünkü hâlle kıyaslanır; yalnız ölçülen kazanç varsa açılır (kurucu: "LLM'lerin gücünü test ederek
  avantaja geçiyorsak kullan").

## 5. Kurucuya sorular

- **EG-1 — son karar payı:** alan yazıldı, şimdilik VARSAYILANI YOK (boş = sınır yok = bugünkü davranış). Yeni kurulan otomatik kuralda
  varsayılan 30 dakika olsun mu (örneğinizdeki 13:00 → 12:30)? Dikkat: pay, son dakikada gelen isteği de tutar — örnek: daire sabahtan hazır,
  misafir 12:45'te "13:00'te gelebilir miyiz?" diye soruyor → pay 30 ise onay kendiliğinden gitmez, hazır cevap size gelir; pay yoksa bugünkü gibi
  kendiliğinden gider. Önerim: varsayılan 30, formda değiştirilebilir. Form metinleri (yukarıda) uygun mu?
- **EG-2 — ücretli + otomatik kuralı olan daireler:** bugün otomatik onay ücretiyle birlikte gidiyor; anahtar açılınca hazır cevaba döner (siz
  gönderirsiniz). Onay metni aynı. Açalım mı? Örnek — misafir: "12'de gelebilir miyiz?" (kural: otomatik, 30 €). Bugün: "Bugün 12:00'den itibaren
  giriş yapabilirsiniz. Erken giriş ücreti 30 €." kendiliğinden gider. Anahtar açıkken: aynı metin size hazır cevap olarak gelir, siz gönderirsiniz.
- **EG-3 — örnek kaynağı:** örnek bankası için gerçek (anonimleştirilmiş) misafir mesajlarından yararlanılsın mı, yoksa yalnız elle yazılmış
  örnekler mi? Gerçek mesaj daha iyi öğretir; gizlilik şartı: ad / telefon / kod maskeli, dışarıya yalnız eğitim sağlayıcısına gider.
- **EG-4 — erişim şartı:** otomatik erken giriş onayı, giriş bilgisi bu misafire GÖNDERİLMİŞSE mi çıksın? Örnek — daire hazır, misafir 12:00
  istiyor, ama giriş mesajı henüz gitmemiş (otomatik giriş kapalı ya da metin eksik). Bugün: onay kendiliğinden gider. Öneri: onay
  kendiliğinden gitmez, hazır cevap size gelir ve panelde "Giriş bilgisi bu misafire henüz gönderilmedi" satırı çıkar. Bedeli: giriş bilgisini
  her zaman elle gönderen ev sahibinde erken giriş onayı hiç kendiliğinden gitmez. Önerim: evet (dar pilot), anahtarın arkasında.
