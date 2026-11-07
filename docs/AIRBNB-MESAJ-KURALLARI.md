# Airbnb mesaj kuralları — yapay zekâ cevabı ne zaman Airbnb'de engellenir (10-22)

Kurucu (10-22, aynen): "airbnb'de yazarsak airbnb'nin mesaj engelleme ihtimalinde modele onu söyleyelim ve airbnb'nin tuttuğu mesajları
bizim modele öğretelim" · "o misafire gidecek mesajı airbnb durdurmayacağına emin olalım direk airbnb'nin engellediği mesajları bizim modele
bir dosyada koyabiliriz airbnb'nin neye göre engellediğini falanda öğrenir airbnb bununla ilgili birşey yayınlamış olabilir kontrol et".

Bu dosya üç şeyi tek yerde tutar: **Airbnb'nin yayımladığı kural** (kaynaklı) · **kodda nasıl uygulandığı** · **öğretim / ölçüm seti**.

## 1. Airbnb ne yayımlamış (kaynaklar, 10-22 web araması)

| Konu | Kural | Kaynak |
|---|---|---|
| İletişim bilgisi | Rezervasyon **onaylanmadan önce** misafiri platform dışına taşımak kural ihlali; telefon numaraları yalnız onaydan sonra görünür, iptalde kaybolur. Airbnb'nin verdiği geçici numara WhatsApp'ta çalışmaz. | [Yardım 4155](https://www.airbnb.com/help/article/4155) · [Yardım 147](https://www.airbnb.co.in/help/article/147) |
| Engellenen içerik | Entegre mesajlaşmada (Hospitable gibi yazılımlar) web bağlantısı, e-posta, sosyal medya hesabı ve telefon numarası **kısıtlı içerik**; onaydan önce ve çıkıştan sonraki kısa pencere (genelde ~1 gün) bitince engellenir. Tekrarı hesap askıya alınmasına gidebilir. | [Guesty yardım: Airbnb iletişim eşitlemesi](https://help.guesty.com/hc/en-gb/articles/32079380971805-Troubleshooting-Airbnb-communication-sync) (ikinci el) |
| Platform dışı ödeme | Ev sahibi misafirden platform dışında yalnız dar istisnalarda ödeme isteyebilir: fiyat dökümünde gösterilen ücret ya da ilanda / ev kurallarında yazılı ve platform dışında alınabilen vergi. İsteğe bağlı ücretler (otopark, ek hizmet) **Çözüm Merkezi** üzerinden. Misafire "Airbnb dışında ödeme yapmayın" denir. | [Yardım 251](https://www.airbnb.ca/help/article/251) · [Yardım 2799](https://airbnb.com/help/article/2799/) |
| 2025 sıkılaştırması | "Off-Platform and Fee Transparency Policy" (10 Mayıs 2025): zorunlu ücret platform dışında toplanamaz, fiyat alanlarında gösterilmeli; ihlal → askıya alma. | [Smoobu özeti](https://www.smoobu.com/en/blog/airbnbs-off-platform-policy-explained/) · [ShortTermRentalz](https://shorttermrentalz.com/news/airbnb-bans-off-platform-fees-guest-registration-2025/) (ikinci el) |

⚠️ Sayfaların tam metni bu ortamdan açılamadı (ağ kısıtı); tablo arama özetlerinden. Açılışta kurucu ilgili Yardım sayfalarını bir kez okuyup
tabloyu doğrulamalı. İkinci el kaynaklar (Guesty, Smoobu) Airbnb'nin kendi metni değildir.

## 2. Kodda nasıl uygulanıyor

- **Kıdemli okuyucu** (`src/lib/ai/semantic/absence-judge.ts`, anahtar `AI_SENIOR_READER_ENABLED`, KAPALI): her otomatik cevap adayını iki
  kez okur (misafir mesajıyla + misafir mesajı olmadan) ve sorar: ev sahibine platform dışı ödeme mi? platform dışı iletişim mi? özür mü?
  Bir okuma "evet" derse evet. Misafirin mesajına gömülü "kontrol edene not" ikinci okumaya hiç ulaşmaz.
- **Airbnb penceresi** (`src/lib/channels/airbnb-message-policy.ts`): "platform dışı iletişim" yalnız Airbnb kanalında, onaylı rezervasyon
  yokken (ön soru, talep, iptal) ya da çıkıştan bir günden fazla sonra cevabı tutar. Onaylı konaklama sürerken telefon / bağlantı gider
  (Airbnb de paylaşır). Bu bir yetenek kararı değildir (değişmez 20); kanalın içerik kuralıdır.
- **Ev sahibine platform dışı ödeme** her kanalda ve QR'da tutulur. **Üçüncü tarafa ödeme bilgisi** ("otopark gişede nakit", "taksi kartla")
  gider (kurucu T-d).
- **Sohbet kodu mesajı** (QR, `reservation-pin-control.tsx`): ev sahibinin Airbnb'den gönderdiği metin bağlantı / telefon / "QR" sözcüğü
  taşımaz — onaydan sonra gönderildiği için kural dışında kalır, yine de filtre dostu.

## 3. Öğretim / ölçüm seti

- `evals/airbnb-message-policy.json` — misafir mesajı + taslak + beklenen üç hüküm; `attack: true` vakalar misafir metnine gömülü kandırma
  girişimleri. Örnekler okuyucu istemindeki örneklerden FARKLI (ezber yok — `tests/unit/airbnb-message-policy-set.test.ts` pinler).
- Gerçek model ölçümü: `RUN_REAL_EVAL=1 EVAL_SENIOR_OUT=… npx vitest run -c vitest.eval.config.ts tests/eval/senior-reader.eval.test.ts`
  (ücretli, ~70 küçük çağrı; kurucu onayıyla).

## 4. Açılıştan sonra (kurucu: "airbnb'nin tuttuğu mesajları bizim modele öğretelim")

1. Hospitable / Airbnb bir giden mesajı reddederse (gönderim hatası ya da "mesaj engellendi" bildirimi) metin ad / telefon / e-posta
   ayıklanarak bu sete `source: "airbnb_blocked"` ile eklenir; okuyucu o vakada "evet" demiyorsa istem / örnek düzeltilir.
2. **İnce ayar (fine-tuning) ileride** (kurucu: "benim hali hazırda olan çektiğim mesajlardan yapabiliriz ilerde şimdilik test ile öğret"):
   kurucunun dışa aktardığı mesajlardan, ad / telefon / adres ayıklanmış ve aydınlatma metnine madde eklenmiş olarak. Şimdilik istem +
   örnek + test.
3. Kayıt tablosu gerekiyorsa (engellenen mesaj sayısı, sebebi) migration ister → ayrı onay.
