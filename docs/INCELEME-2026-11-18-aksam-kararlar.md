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

### 4.1 Dilim sonu sert inceleme (Opus, salt okuma) — bulgular ve yapılanlar

Kapsam: bu dalganın tamamı (karar mesajı, iki dairede kayıtlı rezervasyon, söz okuyucusu çekirdeği, iki Opus paketi). İki gerçek bulgu, ikisi
de "iki dairede kayıtlı rezervasyon" parçasında; her biri kodda izlenip doğrulandı ve düzeltildi.

| # | Bulgu | Ne oluyordu | Düzeltme |
|---|---|---|---|
| B-1 | Kuyrukta tutulan karşılama / giriş mesajı bayat gidebiliyordu | Karşılamanın kuyrukta pencere kuralı yok, giriş mesajınınki çıkış gününe kadar açık. Yanlış kayıt konaklamanın 3. günü kaldırılınca karşılama o gün giderdi | İki dairede kayıtlı olduğu için tutulan satır varış günü geçince iptal edilir (çıkış mesajı çıkış gününü bekler). Çakışma olmayan satırda davranış aynı (kontrol testi) |
| B-2 | Elle gönderim "sıraya alındı" diyor, mesaj hiç gitmiyordu | Kuyrukta tutulan satır varken ev sahibi doğru dairenin satırından gönderince satırın vadesi öne çekiliyordu; kuyruk yine tutuyordu | Bekleyen satır iptal edilir, mesaj ev sahibinin seçtiği dairenin metniyle doğrudan gider; öteki kayıt da damgalanır (ikinci gönderim yok). Girişler'de bu durumda düğme artık görünür (eskiden gizliydi — ajan düğmenin göründüğünü varsaymıştı; kodda gizli olduğu görüldü, yani ev sahibinin hiçbir yolu yoktu) |
| C-1 | Söz okuyucusu: ölçü işareti (55") gerçek tırnağı yutuyordu | Temkin payı (tırnak içindeki üstlenme → kart) o cümlede çalışmıyordu | Tırnak türleri ayrı izlenir; rakamdan hemen sonraki düz tırnak açılış sayılmaz. Modül henüz çağrılmıyor |
| C-2 | Söz okuyucusu: iki kat iletme (">> …") işareti doğrulamadan önce siliniyordu | İletilmiş satır iletilmiş sayılmıyordu | Satır başındaki işaret dizisi çit temizliğinden önce tek işarete iner |
| A-1 | WhatsApp karar cevabı teslim sonucunu okumuyor (büyük ölçüde eski) | Hedefi olmayan konuşmada WhatsApp "Gönderildi ✓" diyor, panel doğru metni gösteriyor | DÜZELTİLMEDİ — yeni metin ister (soru AK-6) |

"Emin değilim" notları (hata değil, ölçülecek): saat doğrulaması gevşek (model "15:00" derse alıntıdaki "3 havlu" rakamı yetiyor) · model cümlenin
tamamını alıntılarsa tırnak payı çalışmıyor. İkisi de yalnız tutan payın sınırı; kredi gelince ölçüm setine vaka olarak eklenecek.

### 4.2 İlk tam kapıda çıkan üç kırmızı (yayın öncesi yakalandı)

1. Yeni anahtar (`AI_HOST_COMMITMENT_READER_ENABLED`) ölçüm koşu kimliği listesine eklenmemişti (pin: her `AI_*` anahtarı kimlikte görünür).
2. Migration 98 manifest tablosuna ve açılış belgesindeki bekleyen aralığa yazılmamıştı (pin).
3. Bir ölçer testi gece 01:42'de bir kez kırmızı: test, cevap istemini iki ayrı anda kuruyor ve istem "saat SS:DD" taşıyor — iki kurulum bir
   dakika sınırının iki yanına düşünce ayrışıyor. Ürün hatası değil; testin saati sabitlendi.
Üçü de düzeltildi; dalga yeniden kapıdan geçirildi.

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
- **AK-6 — WhatsApp karar cevabı:** hedefi olmayan konuşmada WhatsApp'tan onaylanan karar "Gönderildi ✓" diye cevaplanıyor (panel aynı durumda
  "kaydedildi" diyor). Y-1 yeni tasarımıyla (yerel kayıtta gönderim hiç yok) bu durum zaten ortadan kalkacak; o dilime kadar metni panelle aynı
  yapalım mı?
- **EG-1 / EG-2 — erken giriş pilotu:** `docs/TASARIM-2026-11-18-otomatik-erken-giris-pilotu.md` §5 (son karar payının varsayılanı; "yalnız ücretsiz"
  anahtarının açılması).
