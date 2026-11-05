# Tur 7 — kuyruk / kanal, takvim (iCal), halka açık sayfalar / kimlik, ayarlar / otomasyon (2026-11-05)

> Nasıl: dört alan için birer arayıcı ajan 21 bulgu getirdi (ham liste AYNEN: `INCELEME-2026-11-05-tur7-HAM-bulgular.md`). Kullanım
> sınırı yüzünden çürütücüler koşmadı. Kurucunun seçtiği **altı öne çıkan bulgu** ana kodda satır satır okunarak DOĞRULANDI ve kurucu
> onayı + Codex görüşüyle düzeltildi (Codex önerileri kodda ölçüldü; daha geniş olan biri — "tekrar örneği hiçbir şeyi iptal edemez" —
> Codex'in kendi inceltmesiyle uygulandı). Kalan 15 bulgu **doğrulanmadı** (§3) — sıradaki adım çürütücü.

## 1. YAPILANLAR (altısı da kurucu onaylı)

| # | Ne | Önce → sonra |
|---|---|---|
| S7-1 | "AI cevabını gör" deneme kartı işletmenin kayıtlı yanıt tonunu yok sayıyordu. | Her zaman "Sıcak" → kayıtlı ton (kart ayrıca ton seçerse o). |
| CAL-1 | **Dairenin kendi Lixus takvim bağlantısı içe aktarma kaynağı olarak eklenebiliyordu** → her senkronda kendi rezervasyonlarımızın kopyası + temizlik görevi. | Form reddeder (onaylı metin: "Lixus takvim bağlantıları içe aktarma kaynağı olarak kullanılamaz. Airbnb, Booking veya desteklenen başka bir takvimin dışa aktarım bağlantısını ekleyin."). Kontrol metinde "lixus" aramaz; ayrıştırılmış adresin gerçek alan adı + dışa aktarım yolu. Yönlendirme servisi / kopya ile gelen beslemede okuyucu kendi etkinlik kimliğimizi görür: **hiçbir satır yazılmaz, kayıp uzlaştırması koşmaz** (önceki rezervasyonlar iptal edilmez), kaynak açıkça "hata". Temizlik ihtiyacı için salt-okuma sayım betiği `scripts/diagnose-own-feed-loop.ts` (otomatik silme yok). |
| CAL-2 | **Aynı etkinlik kimliğinin iptal kopyası canlı kopyadan önce gelirse rezervasyon iptal oluyor / hiç alınmıyordu** (dışa aktarılan takvim o geceleri bırakıyordu → çift rezervasyon riski). | Sıradan bağımsız çözüm (`import/ics-resolve.ts`): ana kayıt ≠ tekrar örneği; örnek iptali yalnız o örneği etkiler (tek seferlik kaydın kendi başlangıcındaki örnek kaydın kendisidir); birden çok ana kayıtta SEQUENCE, sonra LAST-MODIFIED; ayırt edilemeyen çelişkide canlı kopya (yıkıcı değişiklik yok); tekrarlayan ana kayıt dolu gece olarak alınmaya devam eder (kaynak "eksik okuma" işaretli kalır). **Ana kaydın gerçek iptali aynen çalışır** (testli). |
| T7-OB-1 (adım 1) | **Kuyruktaki yapay zekâ cevabı, arada gelen bizim otomatik giriş / karşılama mesajımız yüzünden "eskidi" sayılıp iptal ediliyordu** → misafirin sorusu hiç cevaplanmıyordu (kalıcı kuyruk açıkken). | "Daha yeni mesaj" yalnız misafir mesajı ya da konuşmayı CEVAPLAYAN giden mesaj (ürünün "cevap mı" kuralı, K7): otomatik şablon ve sistem olayı sayılmaz. Ev sahibinin cevabı ve misafirin yeni mesajı eskisi gibi durdurur. Test: misafir cevabı **bir kez** alır (iki geçişte tek gönderim). |
| S7-2 | **Nezaket cevabı ("Rica ederiz {isim}, …") misafire ham belirteçle gidiyordu** — Ayarlar "{isim} yazarsanız misafirin adıyla değiştirilir" diyordu. | Yaşam döngüsü mesajlarıyla aynı doldurucu (tek geçiş — adın içeriği yeniden şablon olarak çalışmaz); ad bilinmiyorsa hitap adsız ("Rica ederiz, keyifli konaklamalar!"). Doldurulamayan alan (`[ADRES]`, çözülemeyen `{daire}`, `{{…}}`) misafire **gitmez** → sessiz kapanış. Deneme kartı aynı doldurucu + aynı kapı; gönderilemezse "gönderilir" demez, mevcut cümleyle sebebini söyler ("Mesajda doldurulmamış alan var — düzeltilene kadar gönderilmez."). |
| T7-AUTH-1 | **"Bağlantıyı yeniden gönder" 60 sn'de açılıp "Yeni bağlantı gönderildi." diyordu** ama son 10 dakikada bağlantı gittiyse sunucu hiçbir şey göndermiyordu; günlük tavan her basışta yanıyordu (4 basışta 0 e-posta, günlük 6 hakkın 4'ü gitti). | Onaylı metin (Codex'in): "Talebiniz alındı. Doğrulama e-postası için gelen kutunuzu ve spam klasörünü kontrol edin. Yeniden istemek için 10 dakika bekleyin." Kayıt ekranındaki bekleme sunucunun penceresiyle aynı tek sabitten (10:00 geri sayım). Sunucu: istek sınırı (IP + adres, hesaptan bağımsız) aynen; günlük tavan artık **gerçek gönderim kotası** — yalnız e-posta kuyruğa yazılınca / gönderilince düşer; dolunca sessizce gönderilmez, cevap aynı 200 (hesap var / yok ayırt edilemez). Kuyruğa yazma düşerse işlem geri alınır, cevap 200, kota yanmaz, kişi kilitlenmez. Sayfayı yenilemek / ikinci sekme sunucuyu atlatmaz. ⚠️ Kimlik akışı: ilk canlı denemeler kurucuyla birlikte (Railway kapalı). |

Kanıt: her düzeltme kırmızı-önce (eski kodda yeni testler kırmızı: CAL-1 2 · CAL-2 3 · T7-OB-1 2 · S7-2 10 · T7-AUTH-1 6 · S7-1);
mutasyon **27/27** (ilk koşuda 1 mutant yaşadı — kuyruklu yolda gönderim kotasının düştüğünü sınayan test yoktu; pin eklendi, yeniden koşu
1/1); tam kapı + build.

## 2. Açık kalanlar (bilinçli, soru değil — sırası gelince sorulur)
- **T7-OB-1 adım 2 (Codex):** bayat taslağın iptali açık soruyu kapatmamalı; tekilleştirme yeniden değerlendirmeyi sonsuza kadar
  engellememeli. Adım 1 bugünkü kaybı kapatıyor; adım 2 tasarım ister (yeni bir yeniden-deneme davranışı → önce soru + örnek).
- **CAL-2:** elle `.ics` yükleme rotası bu çözücüye bağlanmadı (önizleme var, ev sahibi görüyor) — aynı kural oraya da taşınabilir, ayrı iş.
- **S7-2:** Ayarlar'da nezaket metni kaydedilirken doldurulamayan alan uyarısı yok (gönderim anında sessiz kapanış; deneme kartı sebebi
  söylüyor). Kayıt anında uyarı yeni bir ev sahibi metni ister.
- **CAL-1:** canlı veride kendi beslemesini eklemiş daire var mı — `scripts/diagnose-own-feed-loop.ts` (salt okuma) kurucu çalıştırır.

## 3. Doğrulanmayı bekleyen 15 bulgu (ham — çürütücü KOŞMADI, ayrıntı ham belgede)
- **CAL-3** 200 karakterden uzun takvim kimliği kesik saklanıp tam aranıyor → tarih değişikliği / iptal yok sayılıyor.
- **CAL-4** silinip yeniden eklenen beslemede benimsenen rezervasyonlar kanal "manual" kalıyor.
- **CAL-5** kayıp uzlaştırması yalnız gelecek varışları "görüldü" sayıyor → devam eden konaklama hep "doğrulanmamış".
- **T7-OB-2** eski ortam anahtarıyla 401: satır her geçişte ölü anahtarla yeniden gönderiliyor.
- **T7-OB-3** hızlı uyandırma tavanı park edilen satırlarla delinip 61 sn'de bir sonsuz uyanıyor.
- **T7-OB-4** abonelik bitince bekletilen yapay zekâ cevabı "abonelik dönünce gönderilir" görünüyor ama yeniden açılışta iptal ediliyor.
- **T7-OB-5** 48 saatlik teslim onarıcısı ev sahibinin elle "Yeni" yaptığı konuşmayı her geçişte "Cevaplandı"ya çeviriyor.
- **T7-AUTH-2** şifre sıfırlama hata metni o ekranda olmayan "Kodu tekrar gönder" düğmesini ve yanlış bir sebebi söylüyor.
- **T7-AUTH-3** kayıt (ve operatörün açtığı hesap) W6 parola kuralını uygulamıyor (ayrık yazımlı 7 karakter kabul).
- **S7-3** devir bekleme saati ayarı konuşma öğeleri kipinde (canlı anahtar) hiçbir şey yapmıyor, yardım metni "yapay zekâ susar" diyor.
- **S7-4** "mevcut rezervasyonlara karşılama / giriş mesajı gitmez" sözü anahtar açıldıktan sonra ilk kez içe alınan rezervasyonda bozuluyor.
- **S7-5** otomatik mesaj yardımı "aynen gider" diyor ama Türkçe selam + imza ekleniyor (çift selam / İngilizce metnin üstünde Türkçe satır).
- Kimlik alanından iki eski madde hâlâ kodda (yeni değil): `?next=` yalnız yoldan kuruluyor (S-07) · tanıtım sayfasındaki "en güncel 30'unu
  okur" cümlesi varsayılan getirmeyle yanlış (T-09) — `RAPOR-2026-11-04-derin-ajan-turu.md`.

## 4. Kapsam dışı / ileride (kurucu)
- Daireler arası bağlantılı müsaitlik ("A dolunca B kapansın") — yeni mimari / migration yok; gerçek ihtiyaç doğarsa ayrı değerlendirilir.
- **"Takvim bağlantısını düzelt / başka daireye taşı" — BAŞLANMADI** (kurucu: "sohbette kalsın"); güvenli taşıma akışının beş şartı ham
  belgenin karar bölümünde.
