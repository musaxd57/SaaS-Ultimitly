# Tur 7 — kuyruk / kanal, takvim (iCal), halka açık sayfalar / kimlik, ayarlar / otomasyon (2026-11-05)

> Nasıl: dört alan için birer arayıcı ajan 21 bulgu getirdi (ham liste AYNEN: `INCELEME-2026-11-05-tur7-HAM-bulgular.md`). Kullanım
> sınırı yüzünden çürütücüler koşmadı. Kurucunun seçtiği **altı öne çıkan bulgu** ana kodda satır satır okunarak DOĞRULANDI ve kurucu
> onayı + Codex görüşüyle düzeltildi (Codex önerileri kodda ölçüldü; daha geniş olan biri — "tekrar örneği hiçbir şeyi iptal edemez" —
> Codex'in kendi inceltmesiyle uygulandı). Kalan 12 bulgu (ham listede 18 bulgu vardı; önceki sürümde "21 / 15" yazıyordu — YANLIŞTI) ayrı çürütücülerle doğrulandı (§3).

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
- **CAL-2:** elle `.ics` yükleme de artık aynı çözücüden geçiyor (11-05 gece, Codex; önizleme korunur). Lixus'tan dışa aktarılmış dosyanın yeniden yüklenmesini reddetme metni kurucu onayı bekliyor.
- **S7-2:** Ayarlar'da nezaket metni kaydedilirken doldurulamayan alan uyarısı yok (gönderim anında sessiz kapanış; deneme kartı sebebi
  söylüyor). Kayıt anında uyarı yeni bir ev sahibi metni ister.
- **CAL-1:** canlı veride kendi beslemesini eklemiş daire var mı — `scripts/diagnose-own-feed-loop.ts` (salt okuma) kurucu çalıştırır.

## 3. Kalan 12 bulgu — çürütücü sonucu (11-05 gece), risk sırasıyla. HİÇBİRİ DÜZELTİLMEDİ (kurucu: "topluca onay yok")

Dört alanda ayrı çürütücü, mevcut kodda (Tur 7 düzeltmeleri dahil) kendi deneme betiğiyle yeniden üretmeye çalıştı: **12'si doğrulandı**
(T7-OB-5 kısmen). Ödeme riski taşıyan bulgu yok. Sıra: yanlış gönderim → veri kaybı → yetki / hesap güvenliği → altyapı → yanıltıcı metin.

| Sıra | # | Risk | Ne | Müşteriye görünen değişiklik (önce → sonra) |
|---|---|---|---|---|
| 1 | **S7-4** (orta) | yanlış gönderim | "Mevcut rezervasyonlara karşılama / giriş mesajı gitmez" sözü, anahtar açıldıktan SONRA ilk kez içe alınan eski rezervasyonda bozuluyor (ilk bağlantı, yeni ilan). Çıkış mesajı da aynı kuralda. | Misafir (bağlantıdan 3 hafta önce yapılmış rezervasyon): önce "Merhaba Ayşe, rezervasyonunuz için teşekkürler…" + 4 gün içinde varışsa giriş mesajı → sonra hiçbiri. |
| 2 | **CAL-3** (düşük) | veri kaybı | 200 karakterden uzun takvim kimliği kesik saklanıp tam aranıyor → tarih değişikliği / iptal yok sayılıyor (Outlook tarzı uzun kimlikler). | Ev sahibi: 15–17 Kasım → 25–28 Kasım'a taşınan konaklama önce 15–17'de kalıyor, dışa aktarım 25–28'i açık bırakıyor → sonra 25–28. |
| 3 | **T7-OB-5** (kısmen) | veri kaybı | Teslimden sonraki 48 saat içinde ev sahibinin elle "Yeni" yaptığı konuşmayı onarıcı her 2 dakikada "Cevaplandı"ya çeviriyor (yalnız kalıcı kuyruk açıkken). Doğru düzeltme yeni bir kolon ister (migration → onay + yedek). | Ev sahibi: önce "Yeni" yaptığı konuşma 2 dk içinde "Cevaplandı" → sonra "Yeni" kalır. |
| 4 | **T7-AUTH-3** (düşük) | hesap güvenliği | Kayıt ekranı W6 parola kuralını uygulamıyor: ayrık yazımlı (NFD) 7 karakterlik parola kabul. Canlı açılınca geçerli. | Kayıt: önce hesap açılır → sonra "Şifre en az 8 karakter olmalı." |
| 5 | **T7-OB-2** (düşük) | altyapı | Kurucu hesabının eski ortam anahtarı reddedilince kuyruk satırı her geçişte ölü anahtarla yeniden gönderiliyor; satır hiç "başarısız" olmuyor. | Ev sahibi: önce "Sırada — gönderilmeyi bekliyor" sonsuza kadar → sonra 30–60 dk içinde "gönderilemedi" + uyarı (yeni metin yok). |
| 6 | **T7-OB-3** (düşük) | altyapı | Hızlı uyandırma tavanı, alınıp hemen park edilen satırla deliniyor → bağlantı kopukken dakikada bir boşuna işlem. | yok |
| 7 | **T7-OB-4** (düşük) | yanıltıcı metin | Abonelik pasifken bekleyen yapay zekâ cevabı "bağlantı gelince gönderilecek" görünüyor ama abonelik dönünce İPTAL ediliyor (W7 kararınız). | Ev sahibi: önce "…gönderilecek" (bekler, cevap vermez) → sonra mevcut cümle "…gönderilmedi — lütfen elle yanıtlayın". |
| 8 | **CAL-4** (düşük) | yanıltıcı metin | Silinip yeniden eklenen beslemede benimsenen rezervasyonlar "Manuel" kalıyor (kod yorumu tersini söylüyor). | İptaller sayfası rozeti: "Manuel" → "Airbnb". |
| 9 | **CAL-5** (düşük) | yanıltıcı metin | Kayıp uzlaştırması yalnız gelecek varışları "görüldü" sayıyor → devam eden konaklama hep "güncel olmayabilir" (yalnız uzlaştırma anahtarı açıkken; yön güvenli). | Devir paneli: "…(kayıt güncel olmayabilir)" uyarısı kalkar. |
| 10 | **T7-AUTH-2** (düşük) | yanıltıcı metin | Şifre sıfırlama hata metni o ekranda olmayan "Kodu tekrar gönder" düğmesini söylüyor. | "…“Kodu tekrar gönder” ile…" → ör. "Kodu kontrol edip tekrar deneyin ya da “Baştan başla” ile yeni bir kod isteyin." |
| 11 | **S7-3** (düşük) | yanıltıcı metin | Devir bekleme saati ayarı konuşma öğeleri kipinde (canlı) uygulanmıyor — bu BİLİNÇLİ tasarım (09-26), yalnız yardım metni eski. | Ayarlar yardım metni: "…AI kaç saat sussun?" → öğe kipinde "istek size kalır ve size bildirilir…". |
| 12 | **S7-5** (düşük) | yanıltıcı metin | Otomatik mesaj yardımı "aynen gider" diyor; {isim} yoksa selam + imza ekleniyor (önizleme bunu zaten gösteriyor). | Yardım metni: "aynen gider" → "AI'dan geçmeden gider; {isim} yoksa başına selam, sonuna imza eklenir". |

Çürütücü kanıtları ve satır numaraları: oturum çalışma klasörü `tur7-verdicts.json` (repo dışı).

## 4. Kapsam dışı / ileride (kurucu)
- Daireler arası bağlantılı müsaitlik ("A dolunca B kapansın") — yeni mimari / migration yok; gerçek ihtiyaç doğarsa ayrı değerlendirilir.
- **"Takvim bağlantısını düzelt / başka daireye taşı" — BAŞLANMADI** (kurucu: "sohbette kalsın"); güvenli taşıma akışının beş şartı ham
  belgenin karar bölümünde.
