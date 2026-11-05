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

## 2. Açık kalanlar → 11-05 gece kurucu kararlarıyla kapandı
- **T7-OB-1 adım 2:** UYGULANDI (kurucu "Evet, ama ihtiyaç bazında") — §5 ve `TASARIM-2026-11-05-bayat-taslak-soru-kaybolmasin.md` §6.
- **CAL-2 / elle `.ics`:** Lixus'tan dışa aktarılmış dosya REDDEDİLİR (kurucu onaylı metin, ilk cümleden sonra eklenen cümleyle): "Lixus'tan
  dışa aktarılan takvim dosyaları içe aktarılamaz. Bu dosya, Lixus'taki rezervasyonlarınızın kopyasını oluşturur. Airbnb, Booking veya başka
  bir takvimin dışa aktarım dosyasını yükleyin." Reddedilen dosya yükleme hakkını yemez. Bağlantı ve dosya aynı kaynak tanıma kuralını
  kullanır; elle yükleme senkron döngüsünden ayrı kalır (risk kopya kayıt). Yedekten geri yükleme ileride gerekirse AYRI işlem.
- **S7-2 / kayıt anı uyarısı:** UYGULANDI (kurucu onaylı metin): "[ADRES] desteklenmiyor. Kullanılabilir alanlar: {isim}, {daire}." — formda
  satır içi uyarı + Kaydet kapalı; sunucu da aynı kuralla reddeder (yalnız nezaket cevabı açık olacaksa; anahtarı açan istekte kayıtlı metin
  de denetlenir). Kaydetme, önizleme ve gönderim aynı değişken kuralı; gönderim öncesi son kontrol yerinde.
- **CAL-1 canlı sayım:** `scripts/diagnose-own-feed-loop.ts` salt okuma; kayıt çıkarsa etkilenen kaynaklar + önerilen işlem gösterilir,
  otomatik temizlik YOK — kurucu çalıştırır, ayrıca onay (Railway açılış belgesi adım 5).
- **`{daire}`:** B seçeneği tasarımı — §6 (kurucu soruları D-1…D-3; uygulanmadı).
- **Takvim serisi (RRULE):** AYRI TUR (kurucu) — şartlar `docs/claude/acik-isler.md`; bugünkü "kısmi okuma" bildirimi doğrulandı.

## 3. Kalan 12 bulgu — çürütücü sonucu (11-05 gece), risk sırasıyla. 12'si de DÜZELTİLDİ (kurucu: önce S7-4 → CAL-3 → T7-AUTH-3 → T7-OB-5, "devamında tamamını yap") — §3.1

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

### 3.1 Uygulanan (kullanılan metinler AYNEN; tablodaki "sonra" örneğinden farklı olan yazıldı)

| # | Uygulanan | Görünen metin |
|---|---|---|
| S7-4 | Anahtar açılmadan önce var olan dairede yalnız açılıştan SONRA oluşan rezervasyon; anahtardan sonra eklenen dairede (ilk bağlantı / yeni ilan) dairenin eklenişinden 3 saat sonrasından itibaren oluşan rezervasyon karşılama / giriş / çıkış mesajı alır (ilk içe alma birikimi mesaj almaz). Önizlemeler değişmedi. | yok |
| CAL-3 | Takvim kimliği her yolda (iCal, `.ics`, `.csv`, senkron) aynı kuralla kısaltılır (boşluk kırpma → 200 karakter → yarım karakter atılır); eşleşme kesik kimlikle. | yok |
| T7-AUTH-3 | Kayıt ve operatörün müşteri açma formu W6 kuralını kullanır (saklanan biçimde karakter sayımı + bayt sınırı). | "Şifre en az 8 karakter olmalı." (mevcut metin) |
| T7-OB-5 | Migration 91 (`MessageOutbox.deliveryEffectAt`, tek boş olabilen kolon): teslimin konuşma etkisi yazılınca damgalanır; onarıcı yalnız damgasız satırlara bakar, etki yazılamazsa damga yok (yeniden dener). Gerekçe `TASARIM-2026-11-05-teslim-etkisi-isareti.md`. | yok |
| T7-OB-2 | Ortam yedeği anahtarı reddedilince (kayıtlı anahtar yok) satır kesin hata yolunda: deneme hakkı düşer, 6 denemede "gönderilemedi" + uyarı. | mevcut "Gönderilemedi" rozeti |
| T7-OB-3 | Hızlı uyandırma döngüsü yalnız İLERLEMEYİ sayar (gönderildi / başarısız / iptal / engellendi / belirsiz / eşleşti / inceleme), park edilen talebi değil. | yok |
| T7-OB-4 | Engellenen YAPAY ZEKÂ satırı: konuşma notu mevcut `channel_paused`. | Rozet: "Abonelik pasif — bu cevap gönderilmeyecek" · Kuyruk sayfası: "Kanal bağlantısının aboneliği pasif — bu cevap abonelik dönünce gönderilmeyecek; misafire elle yanıt verin." (ev sahibinin kendi mesajı ve otomatik mesajlar için eski "bağlantı gelince gönderilecek" doğru, değişmedi) |
| CAL-4 | Benimsenen satırın kanalı yalnız "Manuel" / ".ics" etiketliyse kaynağın kanalına döner. | İptaller rozeti "Airbnb" |
| CAL-5 | Görülen, kaynağa bağlı, çıkışı gelecekte olan (devam eden dahil) satırlar "görüldü" damgası alır (1000'lik parçalar). | uyarı kalkar |
| T7-AUTH-2 | Şifre sıfırlama onay hatası. | "Kod doğrulanamadı. Kodu kontrol edip tekrar deneyin ya da “Baştan başla” ile yeni bir kod isteyin." |
| S7-3 | Öğe kipinde (canlı) yardım metni. | "Misafir sizinle görüşmek isterse bu istek size kalır ve size bildirilir; AI aynı konuşmadaki diğer sorulara cevap vermeye devam eder. Bu süre yalnız istekler ayrı ayrı izlenemediğinde uygulanır: AI o kadar saat susar. (0–72)" |
| S7-5 | Otomatik mesaj yardımı. | "Karşılama, giriş ve çıkış mesajları AI'dan geçmez ve AI anahtarından bağımsızdır: her dairenin mülk sayfasındaki "Otomatik mesajlar" bölümüne yazdığınız metin gider. Metinde {isim} yoksa başına selam ("Merhaba Ayşe,") ve sonuna imzanız eklenir." |

Kanıt: her biri kırmızı-önce; mutasyon 20/20 (ilk koşuda T7-OB-5'in hızlı uyandırma yolu yaşadı → pin eklendi, yeniden koşu öldürdü); iki Haiku
inceleme turunun bulguları düzeltildi (reddedilen `.ics` hakkı iade · `{{…}}` sınırlı kalıp · form / sunucu tutarlılığı · kimlik kısaltmasının
tekrar uygulanabilirliği · etki yazılamazsa damga yok); tam kapı + build (`MessageOutbox` kolon kanaryası kapsam kararıyla güncellendi).

## 4. Kapsam dışı / ileride (kurucu)
- Daireler arası bağlantılı müsaitlik ("A dolunca B kapansın") — yeni mimari / migration yok; gerçek ihtiyaç doğarsa ayrı değerlendirilir.
- **"Takvim bağlantısını düzelt / başka daireye taşı" — BAŞLANMADI** (kurucu: "sohbette kalsın"); güvenli taşıma akışının beş şartı ham
  belgenin karar bölümünde.

## 5. T7-OB-1 adım 2 — kuyruktaki taslak ihtiyaç bazında (kurucu 11-05 gece: "Evet, ama ihtiyaç bazında"; yalnız kalıcı kuyruk açıkken)

Misafire giden metin değişmedi, yeni metin yok (mevcut not + rozet). Ayrıntı ve gerekçe: `TASARIM-2026-11-05-bayat-taslak-soru-kaybolmasin.md` §6.

| Kurucunun örneği | Önce | Sonra |
|---|---|---|
| "Otopark var mı?" (cevap kuyrukta) → "Bir de havlu lazım" | Yalnız havlu cevaplanır; otopark sorusu kaybolur | İki ihtiyaç birlikte değerlendirilir, misafire TEK mesaj; bayat taslak gitmez |
| "Wi-Fi şifresi?" (kuyrukta) → "Teşekkürler" | Soru kaybolur (nezaket açıksa yalnız "Rica ederiz") | Wi-Fi cevaplanır (teşekkür vazgeçme değil) |
| "Havlu lazım" (kuyrukta) → "Havlu istemiyorum; Wi-Fi şifresini gönderin" | Havlu ev sahibinde açık görünür | Yalnız havlu geri çekilir, Wi-Fi cevaplanır |
| Duraklatma / devralma yüzünden iptal, süre bitti | Aynı anahtar → cevap yok, soru kaybolur | Aynı soru yeniden değerlendirilir, BİR kez cevaplanır (bayat iptaller — anahtar / abonelik / kanal kapalı — eskisi gibi gitmez) |
| Önceki cevabın teslimi belirsiz, misafir yeniden yazdı | B, A'yı gönderilmiş / gönderilmemiş sayarak gider (iki cevap ya da kayıp) | Tur tam koşar (tehlike yine yükselir), cevap otomatik GİTMEZ, konuşma "Yeni" + "Gönderim sonucu doğrulanamadı — mesaj iletilmiş OLABİLİR. Elle yanıtlamadan önce konuşmayı kanal üzerinden kontrol edin."; ev sahibi yazınca kilit kalkar |

Bulunan ek hata (testi yazarken): bekleyen taslağın "geçildi" ölçütü gönderim anı vetosundan farklıydı (taslağın kaydına bakıyordu,
veto taslağın cevapladığı mesaja). Model düşünürken yazılan misafir mesajında veto taslağı iptal ediyor, tur onu gönderilmiş sayıyordu
→ iki soru da kaybolurdu. Ölçüt vetonunkiyle aynı yapıldı (testli).

## 6. Doğrulama e-postasını yeniden isteme — dışarıdan görünen farklar (Codex 11-05 gece; OWASP: genel yanıt + tutarlı yanıt süresi)

Kurucu: "‘10 dakika bekleme var, dolayısıyla süre farkı güvenli’ yeterli kanıt değil … hesap var / yok, bekleme ve hata yollarının yanıt
farkları ayrıca raporlanmalı." Ölçüm `tests/integration/resend-verification-response-parity.test.ts` (test veritabanı, dal başına 4 istek,
medyan; "önce" = taban YOKKEN aynı test — kırmızı-önce koşusu). Üretim süresi ölçülmedi (canlı kapalı).

| Hesaba bağlı dal | Durum | Gövde | Başlık kümesi | Süre önce → sonra |
|---|---|---|---|---|
| hesap yok | 200 | `{"ok":true}` | content-type | 19 → 308 ms |
| doğrulanmış / eski (kapı öncesi) hesap | 200 | aynı | aynı | 10 → 305 ms |
| son 10 dakikada bağlantı gitmiş | 200 | aynı | aynı | 10 → 305 ms |
| gönderim (kuyruklu yol) | 200 | aynı | aynı | 13 → 304 ms |
| günlük gönderim hakkı dolu | 200 | aynı | aynı | **5** → 303 ms |
| kuyruğa yazma hatası | 200 | aynı | aynı | 9 → 304 ms |
| sağlayıcı reddi (kuyruksuz yol) | 200 | aynı | aynı | 9 → 304 ms |

- "Önce"de en hızlı dal **gönderim hakkı dolu** idi ve o durum YALNIZ gerçek hesapta oluşur (hak yalnız gönderimde düşer) → ayırt edici
  sinyaldi. Şimdi hesaba bağlı her dal en az 300 ms (`lib/response-floor.ts`), yayılım 5 ms. Taban mutlak değildir: iş 300 ms'yi aşarsa
  (çok yavaş veritabanı) fark yeniden görünebilir; asıl savunma yine hız sınırları + 10 dakikalık sessiz pencere (aynı adres için ikinci
  "yavaş" örnek ancak 10 dk sonra ve her biri kurbana gerçek bir e-posta götürür). İlk ölçüm (eşitleyici işlem de yokken): gönderim 12,0 ms /
  hesap yok 3,1 ms.
- Hesaptan BAĞIMSIZ erken dallar (hesap aranmadan döner, hesap var / yok için aynı): 415 (JSON değil) · 429 IP kovası (15 dk'da 8) · 413
  (gövde büyük) · 200 hemen (boş / geçersiz biçimli adres — öyle bir adreste hesap olamaz) · **429 adres kovası** (15 dk'da 4, hesaba bakmadan
  sayılır). Ölçüldü: var olan hesap ile olmayan adreste altı istek BİREBİR aynı dizi — 4 × `200 {"ok":true}` + 2 × `429` aynı Türkçe metin,
  aynı başlıklar (`retry-after` dahil).
- Kuyruğa alınma ≠ sağlayıcının kabulü ≠ kutuya teslim (Codex): rota yalnız kuyruğa yazmayı (kuyruklu yol) ya da sağlayıcı kabulünü
  (kuyruksuz yol) görür; kota bunlardan biri olunca düşer, iş düşerse iade edilir; eşzamanlı iki istek aynı boş hakkı kullanamaz (testli).
- Yan etki: aynı dosyadaki çok istekli 5 test 300 ms × istek sayısı yüzünden 5 sn sınırını aştı → yalnız süre sınırları 30 sn yapıldı
  (iddialar aynı).

## 7. `{daire}` — B seçeneği (kurucu 11-05)

Tasarım `TASARIM-2026-11-05-daire-numarasi-alani.md`: mevcut misafire gösterilen alan (`guestDisplayName`) bir AD, numara değil → ayrı alan
(`Property.guestUnitNumber`, migration 92); geçişte bugünkü okuma aynen, tahmin otomatik doğru sayılmaz, okunan numara görünür kutuda
önerilir. **Uygulanmadı — kurucu soruları D-1 (alan adı / yardım metni), D-2 (kutu metinleri), D-3 (bilgi tabanı / istemde de alan mı).**

