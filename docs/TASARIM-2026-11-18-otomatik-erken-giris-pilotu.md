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

- **EG-1 — son karar payı:** varsayılan kaç dakika? Örneğinizde 13:00 için 12:30 (30 dakika). Önerim: varsayılan 30, kural ekranında değiştirilebilir.
- **EG-2 — ücretli + otomatik kuralı olan daireler:** bugün otomatik onay ücretiyle birlikte gidiyor; pilotla taslağa döner (siz gönderirsiniz).
  Onay metni aynı. Uygun mu?
- **EG-3 — örnek kaynağı:** örnek bankası için gerçek (anonimleştirilmiş) misafir mesajlarından yararlanılsın mı, yoksa yalnız elle yazılmış
  örnekler mi? Gerçek mesaj daha iyi öğretir; gizlilik şartı: ad / telefon / kod maskeli, dışarıya yalnız eğitim sağlayıcısına gider.
