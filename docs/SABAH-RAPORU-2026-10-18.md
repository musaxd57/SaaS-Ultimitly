# Sabah raporu — 2026-10-18 (gece-4: 10 geniş inceleme + söz algılama v2)

> Kurucu talimatı (10-17 gece): "V'lerde eksik var mı … çok derin sert ve uzun uzun analiz … müşteri mesajını etkileyen şeyleri bana sormak için
> hazırla … onay isteyecek bir şey yapma … RAILWAY AÇILANA KADARKİ HER TÜRLÜ ŞEYİ BİTİRMEK". Müşteriye giden mesajı, müşterinin gördüğü metni ya
> da parayı değiştiren hiçbir şey sorulmadan yapılmadı → sorular `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` **§T**.

## 0. Kısaca

- **10 geniş inceleme** (son 3 günün 224 commit'i; güvenlik, yapay zekâ cevabı, söz, ödeme, kuyruk, hız, ekran metinleri, yol planı): ham
  bulgu dosyaları oturum notlarında (depoda değil); doğrulananlar düzeltildi, müşteriye dokunanlar §T'de, kalanlar ↓§3.
- **Söz algılama v2** (sert itirazcı + Haiku + Opus, 3 tur): gün yalnız sözün kendi yerinden okunur, emin değilse kart sorar; yanlış günlü /
  saatli otomatik görev açan ~30 durum kapandı (ör. "Teknisyen yarın 10'da gelecek. Havlu getireceğim." havluyu artık bugüne yazmıyor, günü
  soruyor; "İyi akşamlar, teknisyen yarın 9'da" artık 21:00 değil 09:00; "The cleaning went well." artık görev açmıyor).
- **Migration 76 + 77** (kurucunun 10-17 genel onayıyla): 76 sözü yapanı kaydeder (teknisyen gelecek ↔ ben getireceğim aynı saatte
  karışmaz); 77 yalnız dizin (mülk / hesap silme 15,6 sn → 0,1 sn).
- **İtildi / CI:** ↓ §4.
- **Railway kapalı** → canlıya bir şey gitmedi. Açılış belgesi güncellendi: önce yalnız veritabanı + yedek, sonra web servisi (yoksa yedek
  migration'dan SONRA alınırdı); `QR_PIN_PEPPER` / `ERASURE_HMAC_SECRET` eksikse servis hiç başlamaz uyarısı eklendi.

## 1. Kararınızı bekleyenler (§T — hepsi önce / sonra örnekli)

| # | Konu | Önerim |
|---|---|---|
| T1 🚨 | "Talimat yok" silicisi uydurma kuralı misafire gönderebiliyor ("Evcil hayvanlar kabul edilir") | silme yalnız anahtar / kapı / çöp + sayısız; hazır yama var |
| T2 | Olası tehlike + anlama katmanı çalışmadı → kanalda size uyarı yok | QR'daki gibi acil e-posta + "Sorunlu" |
| T3 | "Bilgi veremem" İngilizcede gidiyor | aynı kural diğer dillere |
| T4 🚨 | Geçmişten öğren "Giriş talimatı" taslağı otomatik giriş mesajınızın yerine geçebiliyor | bu türde taslak yazmasın |
| T5 | Söz: geçmiş saat / gece 23:30 / "inşallah" / "7'de" | dördü de kart sorsun |
| T6 | Kartla deneme hukuk metni · mülk silme penceresi · sistem görevi silme · Airbnb "Not available" · 12 küçük metin | ayrıntı §T6 |
| T6b | KVKK: hata / işlenemeyen Paddle olay kayıtları süresiz ad / e-posta taşıyor (G6 kararınızın kenarı) | 2 yıl sonra küçülsün |
| T7 | SG1 / SG2 · Paddle ödeme kurtarma ayarı | — |

## 2. Gece ne düzeltildi (müşteriye giden değişmedi ya da yalnız TUTMA yönünde)

- **Söz algılama v2** (anahtar `HOST_COMMITMENT_AUTO_ENABLED` / `AI_ACTION_SUGGESTIONS_ENABLED` kapalı): gün kuralları D1–D4, dilek H1, iki söz
  T1–T4, tekrar R1, taşıma F11, konum anahtarı, yapan kaydı; Opus'un 19 bulgusu (F1–F19) ve Haiku'nun 5 bulgusu. Sert itirazcının 43 cümlesi +
  ~60 yeni pin; mutasyon 31/31.
- **"Talimat yok" silicisi** (yalnız tutma yönünde): tanınmayan konu ("Jakuzi için…"), "kapıcı / kapı zili", "balkona çıkabilirsiniz", "Su / Para /
  İş için…" artık silinip gönderilmiyor.
- **Kapalı anahtarlı arıza kemerleri** (`AI_FIX_SUPPORT_GATE_ENABLED`, kurucu 10-15 kararı): İngilizce "isn't working", "restarting / unplugging",
  bilgi tabanında olmayan cihazın kullanım yönergesi ("Kombiyi açmak için düğmeyi sağa çevirin") artık tutuluyor.
- **Kuyruk alarmı:** bağlantısı kopmuş tek müşterinin park edilen mesajı bütün sistemin "kuyruk ilerlemiyor" alarmını susturuyordu.
- **Hız:** değişmeyen örüntü her 2 dakikada yeniden yazılmıyor (günde ~720 yazım / örüntü); FK dizinleri (migration 77).
- **Açılış uyarısı:** `REGISTRATION_OPEN=true` gibi yanlış yazımlar artık uyarı veriyor (eskiden kayıt sessizce kapalı kalırdı).
- **Geçmişten öğren maskesi:** pasaport numarası ekli etiketle ("Pasaportum U1234…"), ikinci değer olarak, ekli misafir adı ("Ayşe'ye").
- **Panel / ödeme ekranı:** süresi dolmuş plan değişikliği onayı kilitli kalmıyor; ödeme sonrası sayfa birkaç kez yenileniyor.

- **Haiku'nun gece düzeltmelerine iki tur itirazı** (itilmeden önce düzeltildi): "Akşam, teknisyen yarın 9'da gelecek." artık 21:00 değil 09:00;
  kesmesiz "Ill bring towels tomorrow." yeniden söz ("You are well come", "Everything went well send…" söz değil); arıza kemerinde izin ve
  betimleme cümleleri ("Feel free to use the pool", "Havuzu kullanabilirsiniz", "The fridge is empty, please help yourself", "Please power
  off the lights when you leave", "…thermostat, set to 21 degrees") ve kişi öznesi ("We didn't turn on the dishwasher…") artık tutulmuyor;
  kaçanlar geri geldi: "internet is down" + "Please power off the modem…", "You can turn on the TV with the remote" (KB'de TV yok), "The
  heaters, they don't turn on".
- **Veri / iç hatalar (müşteriye giden metin değişmedi):** içe aktarma önizlemesinde saatli satırın günü işletmenin saat diliminde (bir gün
  erken görünüyordu) · silinen rezervasyonun başlanmamış otomatik temizlik / hazırlık görevi de gider (iptal onarımıyla aynı kural; başlanmış görev ve
  temizlikçi fotoğrafı kalır) · yalnız boşluk mülk
  adı reddedilir · aynı adla eşzamanlı iki mülk açılmaz · takvim notunda `\\n` bozulması · bilgi tabanı "yerine koy" sonrası kopyalama
  ikinci çelişkili kopya açmıyor · kuyruktaki otomatik mesaj sizin "Otomatik yanıt" / "Giriş mesajı" anahtarınız kapalıysa gitmez ·
  başka siteden açılan bağlantı KVKK dökümü / teşhis kotasını yakamaz · daire / takvim ayarı değişiklikleri operatör denetim kaydına düşer ·
  kalıcı kuyruk (anahtar kapalı) tek rezervasyondaki 403'te bütün bağlantıyı koparmıyor: önce aynı belirteçle tek sayfalık okuma (S3-06) ·
  yüklenip göreve bağlanmayan fotoğraf (bağlantı koptu, ekran kapandı) 24 saat sonra kovadan silinir, migration'sız — mevcut silme kuyruğuna
  erteli kayıt; göreve bağlandıysa kayıt iptal (S7-01; KVKK "hesap silindi = her şey gitti" bu fotoğrafları da kapsar).
- **Dolu veritabanı yükseltme provası (S10-10):** canlının seviyesi (58) + 37 tabloya 40'ar yapay satır → 59…77 hatasız (1,5 sn), sapma sıfır;
  araç `scripts/ops-migration-rehearsal-seed.py`.

## 2b. Küçük metin düzeltmeleri (T6 — toplu "evet" yeterli; hepsi müşteri ekranı, uygulanmadı)

| # | Yer | Bugün | Önerilen |
|---|---|---|---|
| 1 | Geçmişten öğren kartı | "son 2026-09" | "son Eylül 2026" |
| 2 | Operatör "müşteri ekle" | "Hesabına girip Ayarlar'dan kanal bağlantısını kurabilirsiniz" (destek görünümü salt okunur, yapılamaz) | "Müşteri giriş yapınca Ayarlar'dan kendi kanal bağlantısını kurar" |
| 3 | Panel hatırlatması | "Söz 1 gündür açık" (5 gün sonra da) | "Söz 5 gündür açık" (gerçek gün) |
| 4 | 2FA kartı | "2FA" / "iki adımlı doğrulama" / "iki adımlı giriş" karışık | tek ad: "iki adımlı doğrulama" |
| 5 | Ödeme ekranı | "plan" ve "paket" karışık | hep "plan" |
| 6 | Ödeme ekranı | "₺899" ve "₺899,00" yan yana | tam tutarda kuruş yazılmaz ("₺899") |
| 7 | Devam ettir penceresi | "Yeniden 'Aboneliği devam ettir' deyip…" (ekranda o düğme yok) | "'Devam et'e basıp tutarı yeniden onaylayın" |
| 8 | Acil QR e-postası | "panelde görüntüleyebilirsiniz" (mesaj kaydedilmedi) | "Mesaj kaydedilmediği için panelde görünmez; lütfen daireyi hemen kontrol edin." |
| 9 | Erken biten deneme | "deneme süreniz doldu" | "Ücretsiz denemeniz sona erdi" |
| 10 | Bilgi tabanı kopyalama | kısmi başarı kırmızı hata gibi, sayı yok | "4 daireye kopyalandı. Lale 2'deki kopya elle değiştirildiği için güncellenmedi." (nötr renk) |
| 11 | Gelen kutusu notu | "Abonelik aktif değilken…" (kanal aboneliğiyle karışıyor) | "Lixus aboneliğiniz aktif değilken…" |
| 12 | Bağlantı hatası | 5 farklı cümle | tek cümle: "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." |
| 13 | Geçmişten öğren örneği | "[PHONE]", "[EMAIL]", "{isim}" | "[telefon]", "[e-posta]", "[misafir adı]" |
| 14 | "Bize yazın" (8 yer) | adres yok | plan kartlarının altına tek "Yardım için: e-posta" satırı |
| 15 | Duraklatılmış abonelik | düğmeler sebepsiz gri | "Aboneliğiniz duraklatıldığı için plan değiştirilemez…" |
| 16 | Operatör ödeme incelemesi | saat UTC ama yazmıyor | " UTC" eki |

## 3. Bilinen sınırlar / bilerek bırakılanlar
- Elle "Mesajları çek" (540 günlük derin çekim) bütün işletmelerin 2 dakikalık senkron kilidini dakikalarca tutabiliyor (S7-03): bugün tek
  müşteride etkisiz; çok müşteride diğerlerinin otomatik cevabı gecikir. Düzeltme senkron mimarisine dokunuyor (işletme başına kilit ya da elle
  çekimde sığ pencere) → ayrı tur, ölçümle.

- Sync'te rezervasyon başına ~12 sorgu (S8-02): bugünkü ölçekte (≈10 daire) sorun değil; 20+ büyük işletmede 2 dk'lık geçişi aşar → tasarım
  `scratchpad/gece-17/S8.md`; Railway açılınca ölçümle.
- Gelen kutusu listesinde son mesaj için bütün mesajlar okunuyor (S8-06): bugünkü hacimde 30 sn'de bir ~270 KB; büyüyünce tek sorguya çevrilir.

## 4. İtme / CI
(doldurulacak)
