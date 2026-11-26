# Tasarım 2026-11-18 — Ödeme doğrulanır doğrulanmaz plan açılır (bekleme kuralı yok) + otomatik bağlama

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`, "Ödeme" + "Ö-2"): "doğrulanır doğrulanmaz plan
> açılmalı. 10 dakika bir bekleme kuralı olmamalı. Ödeme ekranı tamamlanınca Lixus işlem kimliğini alıp Paddle'dan hemen kontrol etmeli …
> plan bir kez etkinleşir, ikinci ödeme ekranı açılmaz." Önceki tasarım: `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md`
> (kalıcı "ödeme alındı" kaydı — duruyor, bu belge onun üstüne kurulur). Para akışı: kod + sahte Paddle testleri önce; canlı
> deneme kurucuyla birlikte, açılışta (sandbox: iki sekme · olay gecikmesi · kayıp olay).
> **Durum (11-19):** P1 (çekirdek `lib/billing/checkout-verify.ts`) + P2 (uç `POST /api/billing/checkout-verify` + saatlik süpürgenin aynı
> çekirdekle kendiliğinden bağlaması) + P4 (sahte Paddle ile uçtan uca testler) YAZILDI; hepsi tek anahtarın arkasında
> (`BILLING_INSTANT_LINK_ENABLED`, VARSAYILAN KAPALI — sandbox denemesiyle birlikte açılır). P3 (ekran) de YAZILDI (Opus, ana oturum
> incelemesi): anahtar kapalıyken ekran birebir eski; açıkken üç durum, 3 / 6 / 12 sn, 10 dakikadan sonra 60 sn (30 sn ilk saatte sunucu
> kovasını — saatte 120 — aşıyordu), gizli sekmede sorulmaz, aynı anda tek istek; 2 dakikadan sonra destek e-postası + "Takip numarasını
> kopyala". Gerçek tarayıcı ve sandbox denemesi açılışta.

## 1. Bugün

- Plan YALNIZ Paddle'ın abonelik bildirimi gelince açılır (`api/webhooks/paddle` → `applySubscriptionEventOnce`).
- Ödeme ekranı tamamlanınca ekran sunucuya haber verir (`POST /api/billing/checkout-pending`), sonra 8 saniyede bir sayfayı yeniler ve
  bildirimi bekler. Metin 10 dakikaya kadar "Ödemeniz işleniyor. Planınız birkaç dakika içinde görünecek.", sonra "Ödemeniz alındı,
  aboneliğiniz henüz hesabınıza tanımlanmadı…" (`CHECKOUT_PENDING_MS`).
- Bildirim gecikir ya da kaybolursa plan açılmaz; saatlik süpürge yalnız "bağlanmış mı" diye bakar ve 15 dakikada operatöre alarm verir —
  kendisi bağlamaz (`reconcilePaidCheckout`).

## 2. Yeni akış

**Tek fikir:** plan açan TEK kod yolu yine bildirim işleyicisidir; yeni olan, o işleyiciyi Paddle'ın bildirimini beklemeden, Paddle'dan
OKUNAN abonelikle de çalıştırabilmek. Böylece "bildirim" ile "bizim okumamız" aynı kurallardan geçer (kimlik çözümü, fiyat denetimi, sıra
koruması, bekleyen ödeme kaydını kapatma) ve ikisi aynı anda gelse plan bir kez yazılır.

1. **Ödeme ekranı tamamlandı** → ekran `işlem kimliği + onay kimliği` ile yeni bir "doğrula" isteği atar (bugünkü haber verme isteğinin
   yerine / üstüne).
2. **Sunucu hemen Paddle'dan okur** (`readPaddleTransaction`): işlem ödenmiş mi, hangi onay kaydını taşıyor, abonelik kimliği var mı.
3. **Kimlik denetimi (e-posta / plan adı YETMEZ):** işlemin taşıdığı onay kaydı (a) var, (b) OTURUMDAKİ işletmenin, (c) bu işlemin niyet
   satırıyla aynı. Biri tutmuyorsa hiçbir şey yazılmaz → "bekliyor" (belirsizlik operatöre düşer; yeni ödeme ekranı açılmaz — kalıcı
   "ödeme alındı" kaydı bunu zaten engelliyor).
4. **Abonelik kimliği henüz yoksa** (Paddle parayı aldığını söylüyor ama aboneliği daha kurmamış — Paddle'ın belgelediği durum) → "bekliyor";
   ekran kısa aralıklarla yeniden sorar.
5. **Abonelik kimliği varsa** sunucu aboneliğin tamamını Paddle'dan okur (yeni okuma: `GET /subscriptions/{id}` — nesnenin tamamı) ve onu
   bildirim işleyicisine **süreç içinde, kendi imzamızla** verir (ödeme olayı yeniden işlemenin kullandığı yol — kopya işleyici yok). İşleyici
   bugünkü kurallarıyla: işletmeyi onay kaydından çözer, fiyatı doğrular, planı yazar, bekleyen ödeme kaydını kapatır (aynı işlem zinciri).
   Olay kimliği abonelik + Paddle'ın "son güncelleme" anından türer → aynı okuma iki kez gelirse kopya sayılır; Paddle'ın gerçek bildirimi
   daha yeni ise o uygulanır, daha eskiyse sıra koruması düşürür.
6. **Sonuç ekrana döner:** `etkin` (plan yazıldı) · `bekliyor` · `doğrulanamadı` (Paddle okunamadı — ekran sormayı sürdürür).
7. **Arka plan:** saatlik süpürge aynı "oku ve bağla" adımını bekleyen her ödeme için dener (Ö-2: bildirim hiç gelmese de kendiliğinden
   bağlanır); hâlâ bağlanamıyorsa bugünkü operatör alarmı.

Atomik olan / olmayan (kurucunun ayrımı): bizim veritabanımızda planı yazma + bekleyen kaydı kapatma aynı işleyicide, birlikte. Paddle'ın
kendi işlemi bizim işlemimizle tek işlemde birleşemez — o aralık "bekliyor" + yeniden sorma ile kapanır.

## 3. Ekran

| Durum | Metin (kurucunun önerdiği) | Davranış |
|---|---|---|
| Plan yazıldı | "Planınız etkin." · [Panele dön] | ekran kendiliğinden günceller; sayfayı yenilemek gerekmez |
| Ödeme doğrulandı, plan henüz açılmadı | "Ödeme tamamlandı. Planınız hazır olduğunda bu ekran otomatik güncellenecek." | 3 sn → 6 sn → 12 sn aralıklarla yeniden sorar (QR sohbetindeki bekleme kalıbı) |
| Gecikme uzadı (öneri: 2 dakika) | aynı cümle + destek bağlantısı + takip numarası | sormayı sürdürür; süre sözü verilmez |

10 dakikalık metin değişimi ve "birkaç dakika içinde" sözü kalkar. `CHECKOUT_PENDING_MS` kilidinin kendisi (ikinci sekmeyi engelleyen kısa
kilit) bu turda DURUR: kalıcı "ödeme alındı" kaydı sunucu ödemeyi GÖRDÜKTEN sonra engeller; kilit, o ana kadarki saniyeleri kapatır. Kilit
müşteriye görünen bir bekleme kuralı değildir.

## 4. Şema

Migration 98 `CheckoutIntent.subscriptionRef` sütununu hazırladı: işlemden okunan abonelik kimliği satıra yazılır (ödeme–abonelik bağı;
operatör teşhisi ve süpürge buradan okur). Başka şema değişikliği yok.

## 5. Dilimler

| Dilim | Ne | Kim |
|---|---|---|
| P1 | Paddle'dan aboneliğin tamamını okuma + "oku ve bağla" çekirdeği (kimlik denetimi, süreç içi teslim, sonuç) + `subscriptionRef` yazımı | ana oturum (zor: para + kimlik) |
| P2 | "doğrula" rotası + süpürgenin aynı çekirdeği kullanması | ana oturum |
| P3 | Ekran: yeniden sorma, üç durum, metinler; 10 dakikalık metin değişiminin kaldırılması | Opus (orta) + inceleme |
| P4 | Sahte Paddle ile uçtan uca testler: bildirim önce / okuma önce / ikisi aynı anda / abonelik kimliği geç geliyor / kimlik uyuşmuyor / Paddle okunamıyor / iki sekme | ana oturum |

## 6. Açılışta birlikte doğrulanacaklar (sandbox)

İki sekmede ödeme · bildirim gecikmesi · kayıp bildirim · "ödendi" olayında abonelik kimliğinin boş gelmesi · Paddle'ın abonelik nesnesinde onay
kimliğinin (özel veri) gerçekten taşındığı. Sonuncusu bu tasarımın dayandığı varsayımdır: taşınmıyorsa 3. adımdaki denetim işlemin kendi
özel verisinden yapılır ve abonelik yalnız "bu işlemin aboneliği" bağıyla kabul edilir (çekirdek iki durumu da karşılayacak biçimde yazılır).

## 7. Kurucuya sorular

- **ÖD-1:** "Gecikme uzadı" eşiği 2 dakika olsun mu (destek bağlantısı + takip numarası o zaman görünür)?
- **ÖD-2:** Anında doğrulama ve süpürgenin kendiliğinden bağlaması tek anahtarın arkasında yazıldı (`BILLING_INSTANT_LINK_ENABLED`, kapalı):
  ikisi de aynı çekirdek, aynı varsayım (Paddle'ın abonelik nesnesi / "ödendi" anındaki abonelik kimliği) — sandbox denemesinde birlikte
  doğrulanıp birlikte açılsın. Uygun mu, yoksa ekran doğrulaması açık, süpürge ayrı anahtarda mı olsun?
- **ÖD-3 (ekran, 11-19):** destek bağlantısı için tekrar kullanılabilir bir bileşen yok; ödeme ekranında e-posta adresinin kendisi bağlantı
  metni (Ayarlar'daki kalıp). Kısa takip numarası ekranda yazılı değil, yalnız "Takip numarasını kopyala" düğmesi var (numarayı yazdırmak yeni
  metin ister). Önce: "Ödemeniz işleniyor. Planınız birkaç dakika içinde görünecek." (8 sn'de bir sayfa yenilenir, 10 dakika sonra metin
  değişir). Sonra: "Ödeme tamamlandı. Planınız hazır olduğunda bu ekran otomatik güncellenecek." → plan açılınca "Planınız etkin." + [Panele
  dön]; 2 dakika geçerse altında adres bağlantısı + [Takip numarasını kopyala]. Böyle uygun mu?
