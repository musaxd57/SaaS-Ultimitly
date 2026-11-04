# Instagram Reels incelemesi — 2026-11-04 (kurucu: "kare kare izle, her cümleyi not al, mantıklı özellikleri yaz")

Araç: Contendeo `deep_analyze` (konuşma dökümü + anahtar kare görü + OCR). 4 videodan **2'si analiz edildi**; 3. ve 4. video
(`De_pZ4XBItp`, `De5oNXKteqU`) Contendeo hesabında **kredi kalmadığı için işlenemedi** (`insufficient_credits`, kalan 0). Kredi yüklenince
aynı yöntemle tamamlanır.

---

## Video 1 — "Akşam saatlerinde siteniz neden yavaşlıyor?" (barlasdijital, 37 sn)

### Konuşma (birebir, zaman damgalı)
- [00:00] Akşam saatlerinde siteniz yavaşlıyor, sayfalar saniyelerce dönüyor.
- [00:04] Neden?
- [00:05] Site her ziyaretçi için veri tabanına yeni bir bağlantı açıyor.
- [00:09] Veri tabanı, müşteri ve sipariş kayıtlarının durduğu yer.
- [00:13] Her bağlantıyı açmak zaman alır.
- [00:15] Fazlası veri tabanını da yorar.
- [00:17] Çözüm
- [00:17] Taksi durağı gibi hazır bekleyen bağlantılar.
- [00:21] Talep gelince boştaki bağlantı alınır.
- [00:23] İş bitince geri bırakılır.
- [00:25] Bunun adı bağlantı havuzu.
- [00:27] Havuz dolarsa yeni talep kısa süre sırada bekler.
- [00:30] Kısacası, bağlantı havuzu yoğun saatte sitenizi hızlı tutar.

### Görüntü / ekrandaki yazılar
- Mimari çizim: 5 cihaz (telefon / dizüstü sırayla) → "Site" kutusu (dönen yükleme simgesi) → "Kuruluyor..." etiketli tek çizgi →
  "Veritabanı" kutusu; kutuya "Müşteri" ve "Sipariş" etiketleri bağlı.
- "Bekleme 4.8 saniye", "Veritabanı %62" ve altında %62 dolu sarı ilerleme çubuğu.

### Lixus'a uyarlama (kodla karşılaştırıldı)
- **Zaten var:** Prisma tek istemci (`src/lib/db.ts`, süreç başına tek havuz — her istek yeni bağlantı AÇMAZ). Açılış kontrolü `DATABASE_URL`de
  `connection_limit` yoksa uyarır (`scripts/env-check.mjs:612-620`); açılış listesi `connection_limit=10` diyor (`RAILWAY-ACILIS` §6).
- **Eksik 1 — "havuz dolarsa sırada bekler" ayarı açılış listesinde yok:** yatay ölçek araştırması `pool_timeout=20` öneriyordu
  (`docs/arastirma-2026-10-15/yatay-olcek.md:183`), açılış listesine yalnız `connection_limit` girmiş. Prisma varsayılanı 10 sn; senkron işlemleri
  15 sn'ye kadar bağlantı tutuyor (tur 2 E doğrulaması) → yoğun anda bekleyen istek 10 sn'de "havuz doldu" (P2024) hatasıyla düşebilir.
  **Öneri:** açılışta `?connection_limit=10&pool_timeout=20` (açılış listesine eklendi).
- **Eksik 2 — havuz doluluğu görünmüyor:** "havuz doldu" hatası (P2024) ayrı bir alarm / sayaç değil; genel hata olarak düşer. **Öneri:** P2024'ü
  `reportError` içinde ayrı bağlamla say ("db-pool-exhausted"), geçiş tabanlı alarm (tur 2 E / ölçek ajanı 2 raporuyla birlikte değerlendirilecek).
- **İleri ölçek (2+ kopya):** Railway'de PgBouncer ya da Prisma Accelerate gibi dış havuz; ölçek ajanı 2'nin veritabanı raporu bekleniyor.

---

## Video 2 — "İki farklı isim, aynı kutuya düştü." (talentedcoder, 43 sn; "DATA STRUCTURES #04 — Hash Collision")

### Konuşma (birebir, zaman damgalı; döküm aracı "Deniz ile Ece"yi "Denizli Ece" diye yazmış)
- [00:00] İki farklı isim aynı kutuya düştü.
- [00:01] Kullanıcı adları neredeyse sonsuz, kova sayısı sınırlı.
- [00:04] O yüzden çakışma bir hata değil, kaçınılmaz bir durum.
- [00:07] Deniz ile Ece'nin adları farklı sayılar üretir ama 8'e bölününce ikisinden de 5 kalır.
- [00:11] En yaygın çözüm zincirleme.
- [00:12] Kovaya tek kayıt değil, bir liste konur.
- [00:14] Yeni gelen listenin sonuna eklenir.
- [00:16] Aramada önce kovaya gidilir, sonra listedeki anahtarlar tek tek karşılaştırılır.
- [00:20] İkinci çözüm açık adresleme.
- [00:22] Kova doluysa sıradaki boş kovaya yazılır.
- [00:24] Aramada aynı yolu izler.
- [00:25] Java'nın HashMap'i zincirleme, Python'ın Dict'i açık adresleme kullanır.
- [00:29] Kayıtlar artınca tablo iki katına çıkar, kayıtlar yeni kovalara dağılır ve zincirler kısalır.
- [00:33] Dikkat! Kötü bir hash fonksiyonu her şeyi tek kovaya yığar ve arama yeniden yavaşlar.
- [00:38] Sıradaki bölümde stack var.
- [00:39] Kaydet, seri, her gün devam ediyor.

### Görüntü / ekrandaki yazılar
- 8 kovalı (0–7) tablo; kova 5 sarı ve zincir: `deniz.pt → ece.yoga → can.box`; kova 1 `ayse.fit`, 3 `mert_kosu`, 6 `burak.pt`; 0, 2, 4, 7 boş.
- Not: "yeni gelen sona eklenir". Rozetler: "DATA STRUCTURES #04", "Hash Collision", "Çözüm 1: zincirleme (Chaining)".

### Lixus'a uyarlama (kodla karşılaştırıldı)
- Konu eğitim; doğrudan bir ürün özelliği önermiyor. Lixus'ta karşılığı "kısaltılmış özetle kimlik / tekilleştirme": tarandı — kimlik ya da
  tekilleştirme için kullanılan kısaltılmış SHA-256 özetleri en az 48 bit (istem kimliği, erken giriş kuralı parmak izi: 12 hex), çoğu 64 bit
  (16 hex) ve üstü (gönderim talebi 24 base64url ≈ 144 bit, kritik olay parmak izi 32 hex = 128 bit). Bu ölçekte çakışma olasılığı pratikte sıfır;
  **değişiklik gerekmiyor.** JS `Map` / Postgres B-tree dizinleri videodaki "kötü hash fonksiyonu" riskini taşımıyor.

---

## Video 3 ve 4 — İŞLENEMEDİ
- `https://www.instagram.com/reel/De_pZ4XBItp/` ve `https://www.instagram.com/reel/De5oNXKteqU/`: Contendeo `insufficient_credits` (gereken 5, kalan 0).
  Bu oturumdan Instagram'a doğrudan erişim de yok. Kredi yüklenince yeniden çalıştırılır.
