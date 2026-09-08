# Host arayüzü — ÖNCE / SONRA (A3 · A4 · A5, 2026-09-08)

> Kurucu isteği: *"Bize yalnız test sayısı değil, 'önceden ne cevap veriyordu, şimdi ne cevap veriyor;
> host bilgiyi nasıl daha kolay giriyor?' karşılaştırmasını getir."* Bu belge ikinci yarıyı yanıtlar;
> birinci yarı `docs/olcum/kb-once-sonra.md`'de.

Ekran görüntüleri **gerçek uygulamadan** alındı: üretim derlemesi (`npm run build` → `npm run start`),
tohumlanmış veritabanı (`prisma/seed.ts`, `demo@guestops.ai`), Chromium.
Üretici: `tests/e2e/kb-host-flow.screenshots.mjs` (test değil, görüntü üretici — CI toplamaz).

---

## ÖNCE — `docs/olcum/ekran/00-ONCE-bilgi-tabani.png`

Sayfada iki şey var: sol tarafta **boş bir form**, sağ tarafta **zaten girilmiş kayıtların listesi**.

Host'un görmediği şeyler:
- Hangi dairede **hangi konunun eksik** olduğu. (Ekranda Galata Loft'ta çöp ve çıkış mesajı, Kadıköy'de
  otopark/çöp/ev kuralları/çıkış mesajı YOK — ama bunu anlamak için iki listeyi kafasında kategori
  kategori karşılaştırması gerekiyor.)
- Misafirlerin **gerçekten ne sorduğu**.
- Elindeki hazır metni **toplu girmenin** bir yolu.

Tek giriş yolu: kategori seç → başlık yaz → içerik yaz → Ekle. Her kayıt için baştan.

## SONRA — `01-bilgi-tabani-kurulum-ve-eksikler.png`

Sayfanın en üstüne iki panel geldi.

**"Kurulum ve eksikler"** — eksik konular mülk adıyla, tek tıklık düğmeyle listeleniyor. Başlığın altında
kasıtlı bir cümle var: *"İnceleme adayları — kesin tespit değil."* Çünkü hiçbir sınıf `decisive` değil;
"kalem yok" demek misafirin sorduğu şeyin eksik olduğunu kanıtlamaz.

İki sınıfta **ekleme düğmesi bilerek YOK**:
- **Kayıt var ama cevap ona dayanmadı** (`ungrounded`) → yeni kayıt eklemek yanlış cevaptır; sorun bilgi
  değil temellendirme.
- **Kayıt yazılmış, onay bekliyor** (`awaiting_approval`) → host'a zaten yazdığını yeniden yazdırmak olurdu.

## SONRA — `02-sablonla-doldur-form-doldu.png`
"Şablonla doldur" → form o dairenin ve o kategorinin şablonuyla doluyor. **Hiçbir şey kaydedilmiyor**
(ağ çağrısı bile yok — test-pinli): host metni kendi gerçeğine göre düzenleyip "Ekle"ye basıyor.
Şablonu olmayan bir kategoride yalnız mülk + kategori seçiliyor, **içerik uydurulmuyor**.

## SONRA — `03-metinden-bilgi-cikar-onizleme.png` ← asıl kazanç

Host elindeki metni yapıştırıyor:

```
Merhaba {isim}, dairemize hoş geldiniz!
Otopark bina altındadır ve misafirlerimiz için ücretsizdir.
Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.
Çıkış saati 11:00'dir.
Dairede sigara içilmez, evcil hayvan kabul edilmez.
```

Ekranda çıkan önizleme (kaydetmeden önce):
- **3 bilgi önerisi** — Otopark (satır 2) · Çöp (satır 3) · Ev Kuralları (satır 5), hepsi seçili, tek
  düğmeyle eklenebilir.
- **1 mülk ayarı önerisi** — *"Bunlar mülk ayarlarında tutulur — bilgi kaydı olarak eklenmez: Çıkış
  saati: 11:00 (satır 4)."* 🚨 **Çift kopya yasağı**: aynı gerçek hem kolonda hem KB'de durursa ikisi
  ayrışır ve hangisinin doğru olduğu belirsizleşir.
- **1 satır atlandı** — *"Satır 1: içinde doldurulmamış yer tutucu var ({isim}, [ŞİFRE] gibi)"*.
  🚨 Yer tutucu gerçeğe dönüşmüyor; ama **sessizce de yutulmuyor** — host neyin neden atlandığını görüyor.

## Ölçülen fark

| | ÖNCE | SONRA |
|---|---|---|
| Eksik konuyu bulma | Host iki listeyi kafasında karşılaştırır | Ekranda, mülk adıyla, sıralı |
| 3 kayıt girmek | 3 × (kategori + başlık + içerik + Ekle) | 1 × (yapıştır + Önizle + Ekle) |
| Hazır şablona ulaşma | Formun üstündeki 6 rozet (eksikle bağı yok) | Eksik satırının kendi düğmesi (mülk + kategori seçili gelir) |
| Yer tutuculu metin | Host farkında olmadan `{isim}` kaydedebilir | Satır atlanır, gerekçesi yazılır |
| Saat bilgisi | Host isterse KB'ye de yazar (çift kopya) | KB'ye YAZILMAZ, mülk ayarına yönlendirilir |

## Sınırlar (dürüstçe)
- Bu ekranlar **tohum verisiyle** alındı, canlı Nuve verisiyle değil.
- Panel **inceleme adayı** üretir; hiçbir satır otomatik kayıt oluşturmaz ve hiçbiri kesin tespit değildir.
- Çıkarım **deterministiktir** (kelime + kalıp), model DEĞİL: tanımadığı cümleyi sessizce geçer — "her
  metinden her bilgiyi çıkarır" diye okunmamalı.
- Modelin **cevap kalitesindeki** değişim bu belgede ölçülmedi; onun için gerçek anahtarla
  `docs/EVAL-CALISTIRMA.md` koşusu gerekiyor.
