# Tasarım (ÖNERİ) 2026-11-18 — Ev sahibinin mesajındaki ALINTI kendiliğinden göreve dönüşmesin

> 🚨 **GERİ ÇEKİLDİ (kurucu 11-18 akşam).** Bu öneri sözün sahibini tırnak / iki nokta YAPISINDAN çıkarıyordu; kurucu: "kelime bazlı
> değil … cümledeki anlamı, amacı, niyeti model güçlerine bırak". Yerine geçen tasarım: `docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md`.
> Aşağıdaki §1 "bugün ne oluyor" ölçümü geçerlidir ve yeni işin ölçüm setine girdi; §2 kuralı ve §6 soruları (G1-a…d) GEÇERSİZDİR.

> **KOD YOK, karar değil.** Kaynak: Codex 11-17 raporu ("alıntılanan misafir sözü ev sahibi sözü sayılıyor"; kurucu mesajı AYNEN
> `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md`). Bu davranış "ev sahibinin sözünden görev" özelliğini değiştirir
> (`HOST_COMMITMENT_AUTO_ENABLED` açılışta AÇIK) → önce örnekli soru. Misafire giden HİÇBİR şey değişmez; değişen yalnız ev sahibinin görev
> panosu. Öneriyi bir Opus ajanı kod okuyarak yazdı; "bugün ne oluyor" sütunu ana oturumda **çalıştırılarak ölçüldü** (`detectHostPromises`,
> 18 Kasım) — ajanın bir örneği yanlış çıktı ve düzeltildi (aşağıda 1 numara).

## 1. Bugün ne oluyor (ölçüldü)

Ev sahibinin giden mesajı söz algılayıcısından geçer; söz kesinse görev kendiliğinden açılır. Aktarma yalnız birkaç sözcükle tanınıyor
("demiştim", "dediğim gibi", "as I said" …). Tırnak, "şöyle yazdı:" yapısı ve `>` ile başlayan iletilmiş satır hiç okunmuyor.

| # | Ev sahibinin yazdığı mesaj | Bugün (ölçüm) | Doğrusu |
|---|---|---|---|
| 1 | Siz şöyle yazmıştınız: “Teknisyen yarın 10'da gelecek” — bizim kayıtlarımızda öyle bir randevu yok, hemen kontrol ediyoruz. | söz YOK (doğru) | söz yok |
| 2 | Misafir şöyle yazdı: "Teknisyen yarın gelecek" (Codex'in örneği) | **kesin söz → bakım görevi açılır** | söz yok / kesin değil |
| 3 | The guest wrote: "The technician will come tomorrow at 10." We have no such appointment, we are checking now. | **kesin söz → yarın 10:00 bakım görevi** | söz yok / kesin değil |
| 4 | Ekibimizden gelen not: / `> Temizlikçi yarın 11'de gelecek.` / Sizin için de uygunsa böyle planlayalım. | **kesin söz → yarın 11:00 temizlik görevi** | kesin değil |
| 5 | Havlu yarın getirilecek demişsiniz, öyle bir kaydımız yok. | **kesin söz → havlu görevi** | söz yok |
| 6 | Teknisyen şöyle yazdı: yarın 10'da geleceğim. | kesin söz → görev | tartışmalı (gerçek söz olabilir) |
| 7 | Teknisyenimiz yarın 10'da gelecek, klimaya bakacak. | kesin söz → görev (doğru) | aynı |
| 8 | “Klima çalışmıyor” yazmışsınız, teknisyenimiz yarın 10'da gelecek. | kesin söz → görev (doğru) | aynı |
| 9 | We will send the technician tomorrow at 10, as you asked "as soon as possible". | kesin söz → görev (doğru) | aynı |

Yani hata gerçek ve dört ayrı biçimde çıkıyor (2, 3, 4, 5). 1 numarada bugünkü sözcük ağı zaten tutuyor.

## 2. Önerilen kural — yapı, sözcük listesi değil

1. **Tırnak aralığı:** `“…”`, `«…»`, `„…“` ve sözcük sınırında açılan düz `"…"` arası alıntıdır. Kapanmayan açılış alıntı değildir
   (`55" TV` gibi inç işareti alıntı sayılmaz). Türkçede tek tırnak / kesme ("10'da") alıntı işareti değildir.
2. **İletilmiş satır:** `>` ile başlayan satır alıntıdır.
3. **Aktarma çerçevesi (tırnaksız, isteğe bağlı — soru G1-b):** bir cümlecikte iki noktanın solunda, birkaç sözcük içinde söyleme fiili
   varsa (yaz- / de- / söyle- / sor- / aktar- / ilet- · wrote / said / asked …) iki noktadan sonrası alıntıdır. Tetik yapıdır (fiil + iki
   nokta); fiilsiz iki nokta ("Not: …") etkilenmez.
4. **Sonuç reddetme değil, "kesin değil":** söz fiili bir alıntı aralığının içindeyse söz düşmez; "kesin değil" kartı olur → görev
   KENDİLİĞİNDEN açılmaz, ev sahibi kartta onaylarsa açılır, "Yanlış, kaldır" derse hiçbir şey olmaz. Gerekçe: alıntı bazen gerçek sözdür
   (ev sahibi teknisyenin sözünü misafire iletiyor); kararsız söz için var olan kural da budur (düşmez, kart olur).
5. Söz fiili alıntının DIŞINDAYSA hiçbir şey değişmez (8 ve 9 numara).
6. Uygulama: aralıklar bütün metin üzerinde, cümlecik bölmeden önce, doğrusal tarayıcıyla hesaplanır (karesel iş yok; 50.000 karakter
   süre pini). Var olan sözcük reddi ("demiştim" …) aynen kalır.

## 3. Önce / sonra

| # | Bugün | Öneriyle |
|---|---|---|
| 2 | bakım görevi kendiliğinden açılır | "kesin değil" kartı; görev açılmaz |
| 3 | yarın 10:00 bakım görevi açılır | "kesin değil" kartı |
| 4 | yarın 11:00 temizlik görevi açılır | "kesin değil" kartı (ev sahibi onaylarsa görev) |
| 5 | havlu görevi açılır | **değişmez — bu öneri kapatmıyor** (fiil sonda, tırnak yok; bkz. §4) |
| 6 | görev açılır | çerçeve kuralı alınırsa kart (bir tık maliyeti); alınmazsa bugünkü gibi |
| 7, 8, 9 | görev açılır | aynı |

## 4. Riskler (dürüst liste)

- **Görev kaybolmaz ama kendiliğinden açılmaz.** Kart görülmezse görev açılmamış kalır. En pahalı durum 6 numara: ev sahibinin
  teknisyenden aldığı sözü iletmesi.
- **Bütün mesajını tırnak içinde yazan ev sahibi** (`"Teknisyen yarın 10'da gelecek"`) → kart olur; bugün otomatik görev. Bu alışkanlığın
  ne kadar yaygın olduğu bilinmiyor → ölçüm.
- **Kapsam dışı kalan (bugünkü yanlış sürer):** fiilin sonda geldiği tırnaksız aktarma (5 numara, "… demişsiniz"). Yapı kuralı iki nokta
  ya da tırnak ister; bunu kapatmanın yolu sözcük ağını büyütmek olur ("demişsiniz", "yazmışsınız" …) — ayrı karar (G1-d).
- **Çerçeve kuralının yanlış tetiklenmesi:** "Yazdığınız konu için plan: teknisyen yarın 10'da gelecek" — "yazdığınız" yaz- kökü taşır →
  kart. Kökün sınırı (yalnız çekimli fiil mi) ölçümle belirlenir.

## 5. Ölçüm (ücretsiz, modelsiz) — koddan önce

1. Var olan söz test cümleleri üzerinde eski / yeni algılayıcı kıyaslanır: "kesin → kesin değil" geçen her cümle listelenir ve elle
   etiketlenir. Kabul ölçütü: gerçek söz → kart geçişi 0 ya da tek tek gerekçeli.
2. Gerçek veride (açılıştan sonra, salt-okuma, metin dışarı yazılmaz): ev sahibi mesajlarında tırnak / `>` / çerçeve içerenlerin sayısı ve
   bunların kaçının bugün görev ürettiği.
3. Kod yazılırsa: önce kırmızı test (2, 3, 4), aşırı uygulama satırları (7, 8, 9, inç işareti, fiilsiz iki nokta), süre pini, mutasyon.

## 6. Kurucuya sorular

- **G1-a:** Alıntı içindeki söz "kesin değil" kartı olsun mu (öneri), yoksa hiç söz sayılmasın mı?
- **G1-b:** İlk adım yalnız tırnak + `>` satırı mı olsun (öneri: evet, yanlış tetik riski yok), tırnaksız "şöyle yazdı:" çerçevesi de
  girsin mi?
- **G1-c:** Karta "Alıntı içinde — kesin söz sayılmadı." gibi bir gerekçe satırı eklensin mi (yeni metin)?
- **G1-d:** "… demişsiniz / yazmışsınız" (5 numara) için sözcük ağına ek yapılsın mı? (Kelime ağı büyütmek 10-21 planındaki "kelime değil
  bağlam" yönüyle gerilimde; alternatif: bu durumu anlam katmanına bırakmak.)
