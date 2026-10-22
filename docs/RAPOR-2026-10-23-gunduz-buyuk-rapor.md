# Büyük rapor — 10-23 (kararlarınız A–E + kaynak sorusu → kod, ölçüm, inceleme)

> Kurucu: "herşey bitince büyük raporu ver" · "koddan önce uzun düşün" · "işi çok etkileyecek karar vermişse bana sormaktan çekinme".
> Önceki rapor: `docs/RAPOR-2026-10-23-gece-buyuk-rapor.md`. Tasarım: `docs/TASARIM-2026-10-23-ihtiyac-defteri.md`.
> Ölçüm raporu: `docs/olcum/E-2026-10-23-ihtiyac-defteri-olcumu.md`. Railway kapalı → canlıda HİÇBİR ŞEY değişmedi; yeni davranışların
> hepsi anahtarlı ve anahtarlar KAPALI.

## 1. Kısaca

| ne | önce | şimdi (anahtar açıkken) |
|---|---|---|
| "Çıkış saat kaçta? Bir de hamam var mı?" (hamam bilgi tabanında yok) | bütün mesaj tutuluyordu — çıkış saati de gitmiyordu | "Çıkış saati 11:00." gider; hamam sizde açık iş; "bilgim yok" cümlesi HİÇ yazılmaz |
| "Wi-Fi şifresi neydi? Bu bilgiyi nereden buluyorsun?" | kaynak sorusu da "cevaplanmış" sayılabiliyordu | Wi-Fi cevaplanır; kaynak sorusu cevaplanmaz, panelde açık, e-posta yok |
| "Havuz 22:00'ye kadar açık mı?" (kalem: havuz her gün 20:00, sauna 22:00, hafta sonu havuz 23:00) | — | "Havuz hafta içi 20:00'de kapanıyor; hafta sonu 23:00'e kadar açık." — saunanın 22:00'ı havuza dayanak olmaz |
| "Havuz hafta sonu 20:00'de kapanır" (kalem hafta sonu 23:00 diyor) | doğrulayıcıdan GEÇİYORDU (eski açık) | tutulur |
| Aynı mesajda "havuz kaçta? sauna var mı?" | tek "Olanaklar" işi | iki ayrı iş: "Olanaklar · havuz", "Olanaklar · sauna" (migration 84) |
| Next.js | 15.5.27 — yeni kritik danışma (görüntü optimizasyonu + SVG ile uzaktan kod çalıştırma) | 15.5.28 (bizde görüntü optimizasyonu zaten kapalıydı; yine de yükseltildi) |

## 2. Kararlarınız → yapılan

### A — her ihtiyaca ayrı cevap, kod doğrular (F1 + F3, anahtar `AI_ANSWER_PARTS_ENABLED`)
- Cevap modeli istek başına PARÇA + kalemden BİREBİR alıntı yazar. Kod alıntıyı istemdeki kaynakta bulur ve **değer ↔ konu ↔ koşul ↔
  olumsuzluk ↔ yön** bağını doğrular (`src/lib/ai/answer-binding.ts`). Misafire YALNIZ doğrulanan parçalar gider; doğrulanamayan istek
  panelde açık kalır; "bilgim yok" hiç üretilmez.
- İstediğiniz testler: farklı dil (TR / EN / DE / RU), olumsuz ("kabul edilmez", "not allowed", "nicht erlaubt"), koşullu (hafta sonu,
  yaz ayları, talep üzerine, pazar hariç) — ~60 birim testi; her gevşetmenin tehlikeli karşılığı ayrıca pinli.
- **Ölçüm sonrası neden analizi (sizin 10-11 döngünüz):** ilk koşuda yeni akış DAHA AZ cevaplıyordu (23–24 / 38). Ham parçalar okundu:
  reddedilenlerin çoğu DOĞRU cevaptı. 6 sınıf düzeltildi; karşı denemede bir ESKİ AÇIK bulundu ("Havuz hafta sonu 20:00" geçiyordu) →
  koşul artık DEĞER BAŞINA okunuyor. Haiku düzeltmeleri kırmaya çalıştı, 5 yeni yanlış-kabul sınıfı buldu → hepsi kapandı (bir gevşetme
  geri alındı: kısa fiil kökü — "Kapı 08:00'de açılır" ≠ "açabilirsiniz").

### Kaynak sorusu ("Bunu nereden biliyorsun?", anahtar `AI_ASSISTANT_QUESTION_ITEM_ENABLED`)
- Ayrı istek: otomatik cevap gitmez, kaynak / bilgi tabanı / sistem açıklanmaz, panelde açık, e-posta yok; aynı mesajın bağımsız soruları
  cevaplanır. QR'da kip açılmaz.

### B — panel (UYGULANMADI, sorunuz aşağıda §5)

### C — kısa konu etiketi (kimlik değil)
- Anlama katmanının sorgusundan KODLA kurulur: en çok 3 sözcük / 40 karakter; rakam, misafir adı (konuşma + rezervasyon), şifre / kod /
  kart sözcüğü, bağlantı / alan adı atılır; talimat izi varsa etiket hiç yazılmaz. Modele GİTMEZ. Misafir silme talebi ve süre bazlı
  anonimleştirme (iki dal) etiketi boşaltır; satır zaten saklama süresinde siliniyor. "24 ay" yeni bir süre DEĞİL — bugünkü
  `DATA_RETENTION_MONTHS`.
- Tek açık nokta: aynı mesaj yeniden okunduğunda istekleri eski satırlara eşlerken etiket bir İPUCU olarak kullanılıyor (kimlik / tekillik
  değil; tekillik konuşma + mesaj + tür + sıra). İstemezseniz salt sıra numarasına dönülür (o zaman ters sıralı ikinci okumada havuz cevabı
  sauna satırına bağlanabilir).

### D — migration 84 (kanıtla)
- `ConversationItem.ordinal` (varsayılan 0) + `topic` (boş olabilir); tekillik genişledi. Kanıt: dolu tabloda satırlar / durumlar /
  bildirimler / cevap bağları aynen, `ordinal = 0`, hiçbir mesaj gitmez, hiçbir iş kapanmaz, taze PG'de sıfır sapma, tekrar işleme
  çoğaltmaz (`docs/olcum/migration-84-kanit-2026-10-23.md`). Yedek / geri yükleme doğrulaması Railway açılışında (sizin şartınız).
- Davranış anahtarı `AI_ITEM_ORDINAL_ENABLED`: aynı türden ikinci istek ayrı iş; **belirsizse kapatma yok** — "Saunayı boşverin" (vazgeçme
  yalnız tür taşır) iki işi de açık bırakır; yeni "havuz" sorusu eski "sauna" işinin yerini almaz.

### E — ücretli ölçüm (onaylı Luna yapılandırması) → §3

## 3. Ölçüm (E)

(tablo — `docs/olcum/E-2026-10-23-ihtiyac-defteri-olcumu.md`)

## 4. Güvenlik / kalite
- Next.js 15.5.28 (iki yeni danışma; zafiyet kapısı kırmızıya dönmüştü).
- İnceleme döngüsü: her değişiklik grubundan sonra Haiku; dilim sonunda Opus derin kontrol (§6).
- Mutasyon: (sonuç).
- Tam kapı + CI: (sonuç).
- **Hatam (açıkça):** önceki turda tam kapı koşarken ayrı bir veritabanı testi başlattım; kapının veritabanı kolu düştü. Yalnız kapı
  süreçleri durduruldu, testler tek başına yeniden koşuldu (93/93), kapı baştan koşuldu.

## 5. Sorularınız (karar sizde)
1. **Parça kipinin misafire giden biçimi** (açmadan önce onay): bugünkü selam + her doğrulanan cevap ayrı satır + otomatik asistan notu.
   Örnek: "Merhaba Alex,\n\nÇıkış saati 11:00.\n\n(Bu yanıt otomatik asistan tarafından hazırlandı.)" — iki cevapta iki satır. Böyle mi?
2. **B — panel:** ilk sürüm "ev sahibi yazınca işler açık kalır (sarı 'Ev sahibi yazdı'), kapanış yalnız yapay zekâ / misafir / sizin
   'Bitti'nizle" olsun mu? "Bitti" düğmesi kalsın mı? İkinci sürüm (ev sahibi mesajını okuyan model, mesaj başına ~1 sn) istenir mi?
   Örnekler: tasarım §11.
3. **SSS önbelleği (S1–S4):** hangi türler (Wi-Fi şifresi dahil mi?) · ilk sürümde yalnız birebir yakın sorular mı · mülk sayfasında
   "Sık sorulanlar" ekranı · yeni tablo (migration). Tasarım §10.
4. Etiketin yeniden okumada eşleme ipucu olarak kullanılması uygun mu (§2 C)?

## 6. Bilinen sınırlar (hepsi TUTMA yönünde — yanlış göndermez, ev sahibine bırakır)
- Çeviride içerik sözcüğü kıyası yok (kıdemli okuyucunun kanıt şartı); çok kısa, dili kestirilemeyen parça kıyaslanmaz.
- Rusça / Almanca kat sözcüğü okunmuyor ("на уровне -2") → o parça tutulur.
- Çatı değişimi ("atılır" → "atabilirsiniz") içerik sayılır → tutulur.
- Konu değerden sonra gelirse ("09:00-20:00 arası havuz açık") bağ kurulamaz.
- `automation.ts` / `decisions/turn.ts`'deki erken giriş / müsaitlik akışları tek konulu (aynı türden iki istek bu akışlarda yok sayılıyor).

## 7. Ortam notları
- "Koddan önce uzun düşün" kuralı dalın CLAUDE.md'sinde; `main`de yok (ana dala alınınca gelir).
- Ölçüm yapılandırması: cevap `gpt-6-luna` düşünme `low` · bekçi / kıdemli okuyucu `gpt-6-luna` `low` · anlama + sıralayıcı `gpt-5.1`.
