# İnceleme 2026-11-18 akşam — kurucunun rapora cevabı: madde madde doğrulama ve durum

> Kaynak mesaj AYNEN: `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`. Mesajın bir kısmı Codex'in rapora verdiği cevap,
> bir kısmı kurucunun kendi sözü. Kural: Codex cümlesi kodda ÇALIŞTIRILARAK doğrulanır; kurucunun kendi sözü karardır. Aşağıda her madde için
> kaynak · doğrulama · durum. ✅ dalda · 🔧 sürüyor · 📋 sırada · ❓ kurucu kararı.

## 1. "Önce kapatılacak iki açık nokta"

| # | Madde (kaynak) | Kodda doğrulama | Durum |
|---|---|---|---|
| 1 | Karar mesajında yerelde kaydedilen / sonucu doğrulanamayan / eski kuyruk satırı bulunan dallar bağlı ihtiyacı tamamlanmış sayıyor (Codex; kurucu benimsedi) | DOĞRU — önce yazılan test 10 vakada kırmızı: üç dalda da konuşma öğesi "tamamlandı" oluyordu; eski kuyruk satırında kart da "onaylandı" oluyordu | ✅ `6f657297` — öğe yalnız kanıtla kapanır (kanal kabul etti · iç QR'da görünür · ev sahibi kapattı); mesaj yeniden gönderilmez; eski kuyruk satırının sonucu satırın durumundan okunur; sonuç satırı açık öğeyi sayfada gizlemez. Mutasyon 10 / 10 |
| 1b | Karar mesajı sıradaki bir cevabı geçebilir; kalıcı çözüm kararı konuşma sırasına almak | DOĞRU (11-18 (5) "l" notu) | 📋 migration 98 `MessageOutbox.decisionRequestId` sütununu hazırladı; işçi tarafı (yeniden doğrulama + sonucu karta yazma) kuyruk dilimiyle |
| 2 | "İlk daire kaydı kazanır" doğru daireyi kanıtlamıyor; iki farklı daireye eşlenmiş rezervasyonda otomatik giriş bilgisi tutulmalı, bir kez eşleştirme uyarısı (Codex; kurucu benimsedi) | DOĞRU — gündüz yazdığım kural bir geri dönüş kuralıydı; ilk kaydın dairesinde metin varsa o dairenin metni gidiyordu | ✅ `25738bc9` — iki farklı dairede ETKİN kaydı olan rezervasyona karşılama / giriş bilgisi / çıkış mesajı gönderilmez; göndericiler + kuyruk işçisi (erteleme) + Girişler satırı aynı kural. Mutasyon 11 / 11. 📋 Dikkat panelinde tek seferlik uyarı satırı. ❓ metin + kapsam (§5) |

"Aynı dairenin iki kopyası" notu: şemada rezervasyon (daire, kaynak kimliği) çiftinde tekil olduğu için aynı kaynak kimliği aynı dairede iki kez
bulunamaz; kopya her zaman iki ayrı daire kaydındadır. Aynı konaklamanın takvimden gelen ikinci satırı (farklı kimlik) zaten mesaj adayı değildir.

## 2. Ürün kararları

| Madde | Kaynak | Durum |
|---|---|---|
| H-1 "yazdım" ≠ "çözdüm": cevap soruyu kapatır; fiziksel iş kanıtla kapanır; ek tıklama yok | Codex cevabı ("Evet") — kurucu itiraz etmedi | 📋 tasarım + dilim (sıradaki dalga). Bu dalgada ilk adım atıldı: karar mesajında "kanıt" kuralı (madde 1) |
| H-3 otomatik erken giriş dar pilot (ücretsiz + saati açık + önceden yetki; gönderim anında yeniden değerlendirme; son karar saati; ücretli ayrı akış) | Codex cevabı + kurucu: "testlerle yapalım … kesinlikle fine tuning yapmalıyız, modeli örneklerle beslemeliyiz" | 📋 tasarım; örnek bankası düzeni söz okuyucusuyla ortak (`docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md` §5) |
| Alıntılar / söz sahipliği | 🚨 KURUCUNUN KENDİ SÖZÜ: "kelime bazlı değil … anlamı, amacı, niyeti model güçlerine bırak ama arkada çok hızlı kontroller … anlama şekli ve nedeni tutulsun … kredi gelince test" | 🔧 çekirdek ✅ `60ce05ed` (okuyucu + doğrulama + ölçüm seti, anahtar kapalı); gündüzki tırnak / iki nokta önerim GERİ ÇEKİLDİ. 📋 gölge kaydı (yeni tablo) + kredi gelince ölçüm |
| Ö-1 / Ödeme: doğrulanır doğrulanmaz plan açılır, 10 dk kuralı yok; ekran kendiliğinden güncellenir; metinler "Planınız etkin." / "Ödeme tamamlandı. Planınız hazır olduğunda bu ekran otomatik güncellenecek." | Codex cevabı (ikinci, daha ayrıntılı bölüm) | 📋 sıradaki dalga (para akışı: kod + sahte Paddle testleri; canlı deneme kurucuyla) |
| Ö-2 otomatik bağlama (aynı işletme + aynı satın alma doğrulanınca; belirsizlikte operatör) | Codex cevabı | 📋 ödeme dalgasıyla; migration 98 `CheckoutIntent.subscriptionRef` hazır |
| Migration | 🚨 KURUCUNUN KENDİ SÖZÜ: "MİGRATİONLARI YAPABİLİRSİN" | ✅ `1c92dfd0` migration 98 (yalnız ekleme; taze veritabanında sıfır sapma). Canlıya uygulama ayrı onay (Railway kapalı) |
| — olay başına `nextAttemptAt` | Codex önceliği | ✅ `4293dd2b`, `beda9259` (Opus yazdı, satır satır incelendi) |
| — kuyrukta hazırlanıyor / dış gönderim başladı / sonuç belirsiz; iptal ile gönderimi başlatma atomik | Codex önceliği | 📋 sütunlar hazır (`dispatchStartedAt`, `cancelRequestedAt`, `cancelReason`); işçi + iptal tarafı ana oturumda, sıradaki dalga |
| — mesajın gerçek teslim yolu | Codex | ✅ `73c347b2` (Opus yazdı, incelendi) |
| — görev vade hassasiyeti | Codex (ayrı, düşük risk) | ✅ `4baf0c6f` (Opus yazdı, incelendi) |
| Y-1 yeni tasarım: "Yeni konuşma" formu kalkar; gerçek konuşma ≠ iç not; "Gönder" yalnız gerçek alıcı varsa; kanaldan daire getirme | Codex tasarımı + 🚨 kurucu: "Y-1 için komple ayrı bir gelişmiş tasarım yapalım … BU TASARIMIN ÜSTÜNE GELİŞTİR" | 📋 tasarım belgesi + dilimler (sıradaki dalga); envanter çıkarıldı |
| AY-1: masaüstü evet; mobil bu hâliyle hayır (satırda daire · giriş saati · takılan adım · tek eylem; çizelge dokununca) | Codex cevabı — kurucu itiraz etmedi | 📋 mobil taslak yeniden |
| Çalışma düzeni: kolay-orta kodu Opus yazar, zor kodu ana oturum, kontrol alt ajanla | 🚨 KURUCUNUN KENDİ SÖZÜ | uygulanıyor (bu dalgada iki Opus paketi; ikisi de kullanım sınırında bir kez kesildi, sürdürüldü) |

## 3. Ölçüm — sözcük ağı bugün nerede (kredi gerektirmedi)

Açık geliştirme setinde (37 örnek: 14 görev · 9 kart · 14 hiçbir şey; kurucunun örnekleri dahil) bugünkü sözcük ağı **23 doğru**:
**5 yanlış görev** (aktarılan / iletilen / misafire ait söz göreve dönüşüyor), **4 kaçan görev** (süreli söz, tırnak dışında üstlenme, Almanca),
**5 kaçan kart** (üstlenilmesi belirsiz aktarma ve koşullu söz sessizce düşüyor). Sayı test içinde kayıtlı
(`tests/unit/host-commitment-dev-set.test.ts`). Modelin sonucu kredi gelince ölçülecek.

## 4. Bu dalgada Opus paketlerinin incelemesi

- **Ödeme olayı yeniden işleme (WP-M1):** mantık doğru bulundu. Kontrol ettiklerim: denenmeyen (anahtar okunamadı) satırın vadesi ilerlemiyor ·
  işlenen / incelemeye düşen satırın vadesi siliniyor, yarışta silinmiyor (durum koşulu yazımın içinde) · eski satırlar tekrar çalıştırılabilir
  adımla planlanıyor · eşikleri tükenen satır eski kuralla aynı şekilde bir daha denenmiyor. Ajanın kendi notu: bir test koşusunu bekleme işareti
  varken başlattı (kendi veritabanında; ana oturumun mutasyon koşusu etkilenmedi).
- **Vade hassasiyeti + teslim yolu (WP-K2):** temkinli tasarım — yeni kayıtta sütun ile eski kural çelişmiyor, görünen davranış aynı. Bilinen:
  1 ms kaydırma duruyor (sütunu okumayan beş okuyucu var); saatli bir söz tam 12:00 UTC'ye (İstanbul 15:00) düşerse kartta saatsiz görünüyor
  (eski kusur — düzeltmesi görünür değişiklik, §5).
- Mutasyon: WP-M1 20, WP-K2 30 mutant (sonuç `docs/claude/durum.md` "11-18 akşam").

## 5. Kurucuya sorular (bu dalga)

- **AK-1 — etiket:** "Gönderim doğrulanamadı" ürün genelinde yerleşik bir ifade (cevap rotası, giriş mesajı, WhatsApp, Dikkat paneli). Mesajınızda
  "Gönderim teyidi bekleniyor" geçiyor — etiket her yerde böyle mi olsun, yoksa yalnız anlam (iş açık kalsın) mı kastedildi? Şimdilik etiket aynı.
- **AK-2 — iki dairede kayıtlı rezervasyon, kapsam:** yalnız giriş bilgisi mi tutulsun, karşılama ve çıkış mesajı da mı? Ben üçünü de tuttum
  ("sistem daire tahmin etmez" her üçü için geçerli; karşılama metni de daire adı taşıyabilir). Örnek: aynı rezervasyon Lale 1 ve Lale 2'de kayıtlı →
  hiçbir otomatik mesaj gitmez; Girişler'de "Bu rezervasyon iki dairede kayıtlı, otomatik mesaj gitmez · giriş bilgisini siz gönderin".
- **AK-3 — o cümle uygun mu?** (Girişler satırı; Dikkat panelindeki uyarı için önerim: "Aynı rezervasyon iki dairede kayıtlı: Lale 1 ve Lale 2 ·
  otomatik mesajlar bekletiliyor, yanlış kaydı kaldırın".)
- **AK-4 — "bekliyor" durumundaki kopya:** öteki dairedeki kayıt onaylı değil "bekliyor" ise de tutuyorum (iptal değilse etkin). Uygun mu?
- **AK-5 — saatli söz 15:00'te saatsiz görünüyor:** düzeltelim mi (kartta "15:00" yazar)? Önerim evet; görünen değişiklik olduğu için soruyorum.
- **SM-1…SM-3:** söz okuyucusunun açılma ölçütü, tırnak temkin payı, neden kaydının ev sahibine gösterilmesi — `docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md` §6.
