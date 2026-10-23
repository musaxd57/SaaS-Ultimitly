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
- **Migration 76 + 77 + 78** (kurucunun 10-17 genel onayıyla): 76 sözü yapanı kaydeder (teknisyen gelecek ↔ ben getireceğim aynı saatte
  karışmaz); 77 yalnız dizin (mülk / hesap silme 15,6 sn → 0,1 sn); 78 yalnız dizin (arka plandaki olay okuması geçmişi baştan taramaz).
- **İkinci tarama (gece yarısından sonra):** 135 bulgunun izi tek tek sürüldü — 50'si hiçbir yere bağlanmamıştı. İç olanlar düzeltildi (söz
  algılamada 14 kural, demo sıfırlama, kiracı testi, açılış uyarıları, iki yeni pin; ↓ §2), müşteriye dokunan 18'i §T8'de soru.
- **Migration 78** (yalnız dizin): arka plandaki olay okuması geçmişi baştan taramıyor (40 bin olayda 3,9 ms → 0,05 ms).
- **Migration 79** (yalnız dizin, kalıcı kuyruk): talep ve "kuyruk ilerliyor mu" okumaları geçmişi baştan taramıyor (sert tasarım ajanı ölçtü:
  2M satırda talep 7,65 sn, sağlık ~1 sn → 0,03 ms) + talep sorgusuna veritabanı tarafı zaman aşımı.
- **CI #1545 kırmızısı — test yarışı + bulunan zaman bombası:** söz testlerinden biri, sözle aynı milisaniyede yazılan mesajı "zaten işlenmiş"
  sayıyordu (ürün kodu değil). Bunu ararken daha büyük bir şey çıktı: bu gecenin "gece yarısından sonra yarın" kuralı, gerçek saatle koşan 45
  testi İstanbul 00:00–04:59'da kırmızıya düşürecekti (kural her zaman gece sayılarak ölçüldü). İtilmeden düzeltildi; ↓ §2.
- **İtildi / CI:** ↓ §4.
- **Railway kapalı** → canlıya bir şey gitmedi. Açılış belgesi güncellendi: önce yalnız veritabanı + yedek, sonra web servisi (yoksa yedek
  migration'dan SONRA alınırdı); `QR_PIN_PEPPER` / `ERASURE_HMAC_SECRET` eksikse servis hiç başlamaz uyarısı eklendi.

## 1. Kararınızı bekleyenler (§T — hepsi önce / sonra örnekli)

| # | Konu | Önerim |
|---|---|---|
| T1 🚨 | "Talimat yok" silicisi uydurma kuralı misafire gönderebiliyor ("Evcil hayvanlar kabul edilir") | kurucu: "uydurma kural olanağı vermemeli" → önerim: "talimat yok" geçen cevabın TAMAMI tutulur; hazır yama yazıldı (`docs/hazir-yamalar/2026-10-18-T1-talimat-yok-tam-tutma.patch`, uygulanmadı); "evet" bekleniyor |
| T2 | Olası tehlike + anlama katmanı çalışmadı → kanalda size uyarı yok | kurucu: iyi ama e-posta seyrek → "Sorunlu" + konuşma başına tek e-posta + saatte en çok 3; onay bekleniyor. Not: canlıdaki konuşma öğeleri kipi bu durumu ayrı yoldan işliyor — iki yol birlikte tasarlanacak (sert incelemeyle, ajanlar açılınca) |
| T3 | "Bilgi veremem" İngilizcede gidiyor | ✅ kurucu "hiçbir dilde gitmemeli" → yedi dilde uygulandı (`f3c44079`) |
| T4 🚨 | Geçmişten öğren "Giriş talimatı" taslağı otomatik giriş mesajınızın yerine geçebiliyor | sade anlatıldı; cevap bekleniyor |
| T5 | Söz: geçmiş saat / gece 23:30 / "inşallah" / "7'de" | kurucu: "bağlamdan günü çıkarsın, genellikle aynı gün" → kural örneklerle soruldu; "yarın 7'de" + "inşallah" ayrıca |
| T6 | Kartla deneme hukuk metni · mülk silme penceresi · sistem görevi silme · Airbnb "Not available" · 12 küçük metin | ayrıntı §T6 |
| T6b | KVKK: hata / işlenemeyen Paddle olay kayıtları süresiz ad / e-posta taşıyor (G6 kararınızın kenarı) | ✅ kurucu "2 yıl sonra küçülsün" → uygulandı (`f33e78d7`) |
| T7 | SG1 / SG2 · Paddle ödeme kurtarma ayarı | — |
| T8 | İkinci taramanın 18 sorusu: deneme e-postaları (ödeyen müşteriye "bitti", doğrulanmamış adres) · ödeme ekranı metinleri · kartla deneme (ilk daire, bitiş toleransı) · yıllık abone tespiti (para) · kuyruk zamanlaması · ekran davranışı · sınırlar · KVKK | her birinde önerim; ayrıntı §T8 |

## 2. Gece ne düzeltildi (müşteriye giden değişmedi ya da yalnız TUTMA yönünde)

- **Söz algılama v2** (anahtar `HOST_COMMITMENT_AUTO_ENABLED` / `AI_ACTION_SUGGESTIONS_ENABLED` kapalı): gün kuralları D1–D4, dilek H1, iki söz
  T1–T4, tekrar R1, taşıma F11, konum anahtarı, yapan kaydı; Opus'un 19 bulgusu (F1–F19) ve Haiku'nun 5 bulgusu. Sert itirazcının 43 cümlesi +
  ~60 yeni pin.
- **Doğrulama zinciri:** her değişiklik grubunda Haiku dar inceleme (3 tur), dilim sonunda Opus "en derin ve sert" denetim (9 bulgu, hepsi
  işlendi), mutasyon 7 tur (v2 31/31 · v3–v7 toplam 89 mutant; yaşayanların her biri ayırt edici pinle öldürüldü ya da hedef kod kaldırıldı).
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
  kalıcı kuyruk (anahtar kapalı) tek rezervasyondaki 403'te bütün bağlantıyı koparmıyor: önce aynı belirteçle tek sayfalık okuma; başka
  rezervasyonda da ret + son 24 saatte hiç başarılı gönderim yoksa (yazma yetkisiz belirteç) eski karar, iptal + uyarı (S3-06) ·
  yüklenip göreve bağlanmayan fotoğraf (bağlantı koptu, ekran kapandı) 24 saat sonra kovadan silinir, migration'sız — mevcut silme kuyruğuna
  erteli kayıt; göreve bağlandıysa kayıt iptal (S7-01; KVKK "hesap silindi = her şey gitti" bu fotoğrafları da kapsar).
- **İkinci tarama — söz algılama (anahtar kapalı; yön hep "kaydetme / kart sorar"; mutasyon 25/25):** ekle kurulan koşul ("Klima
  çalışmazsa yarın teknisyen gelecek", "Havlu lazımsa getiririm", "gelirsem") artık söz değil — sağdaki ayrı koşul ("…, sorun olursa yazın") sözü
  bozmaz; "çıkıştan sonra / siz gelmeden" (açık gün yoksa) ve "her sabah / genelde" söz değil; "herhalde / tahminen" kararsız; "2:30 p.m." artık
  14:30 (02:30 değil); "pilav / ustalıkla / bakımlı" konu değil; "sabah ya da öğleden sonra" dilim seçmez; "10:30'dan sonra / 10-11 gibi / yarın gece
  1'de" kart saati sorar; 00:00–04:59 yazılan "yarın" kart günü sorar; onayda gün değişince son an gece yarısına düşmüyor; tek turda iki mesaj
  eskiden yeniye; konaklama kapatması / "Yanlış, kaldır" / yeniden planlama görevi önce kilitler (eşzamanlı görev düzenlemesiyle kilitlenme yok —
  gerçek PostgreSQL'de iki yönlü sınandı); dikkat panelinde aynı saatteki iki söz ayrı satır; zaten kapanmış söz için yanlış hata yok. Haiku'nun
  incelemesi ayrıca eski bir hatayı buldu: saat değişikliği belirsizken varış fiilli ikinci söz düşüyordu.
- **CI #1539 kırmızısı:** bilgi tabanı düzenleyicisinde korumasız `scrollIntoView` (test ortamında yok, zamanlamaya bağlı patlıyordu) → korumalı;
  ayrıca "Kaydedilen bilgiyi düzenle" kalem listede varken de görünür yere kaydırıp odak veriyor (önceden yalnız yenileme yolunda). Pin: korumasız
  `scrollIntoView(` kalmadı.
- **Demo sıfırlama:** inceleyicinin eklediği talimat / Geçmişten öğren koşusu sıfırlamada kalıyordu → siliniyor; her modeli sınıflandıran pin.
- **Kiracı sınırı:** gövdede kimlik alan "konuşma aç" rotası için saldırgan ↔ kurban testi (yabancı mülk / rezervasyon → 400).
- **Pinler:** koddaki her `*_ENABLED` anahtarı Railway açılış belgesinde adıyla geçmek zorunda; sağlayıcı adlı alan pini `autoReplyHospitable`'ı da
  görüyor. **Araç:** `scripts/ops-key-fingerprint.mjs` (şifreleme anahtarını değeri basmadan karşılaştırma — Railway belgesi §0).
- **Açılış uyarıları:** `BILLING_ENFORCED` açık ama satın alma kurulmamış; sunucu / tarayıcı Paddle ortamı farklı (durdurmaz).
- **Dolu veritabanı yükseltme provası (S10-10):** canlının seviyesi (58) + 37 tabloya 40'ar yapay satır → 59…77 hatasız (1,5 sn), sapma sıfır;
  araç `scripts/ops-migration-rehearsal-seed.py`.

- **Sert itirazcı (354 cümle) + Haiku ikinci tur — söz algılama (anahtar kapalı):** koşul / kararsızlık sözcükleri konuma bağlandı ("Sorun
  olursa bana yazın, teknisyen yarın 10'da gelecek" yine söz; "Havlu lazımsa yazın, yarın getireceğim" söz değil); "her sabah / çıkıştan sonra"
  açık "yarın" varsa sözü bozmuyor; "çıkış kapısı / yangın çıkışı / varış saati" konaklama anı değil; "ustayla / bakımını / pilini" konu;
  "2:30 p.m. tomorrow" günü kaybetmiyor; telefon / daire numarası ("0532-123 45 67", "3-1") saat aralığı değil; "akşam yemeğinden önce" dilimi
  bozmuyor; "at 10 to 11" saati soruyor. Derlem 175/323 → 301/323 doğru. Koşul okuyucusundaki karesel iş giderildi (3.990 karakterde 180 ms →
  4 ms). Mutasyon v9: 29 mutanttan 26'sı öldü; yaşayan 3'ün ikisi yeni pinle öldürüldü, biri eşdeğer çıkıp kod kaldırıldı.
- **Arıza / tarif okuyucusu görünmez karakteri yok sayar** (S4-07 kalanı, anahtar kapalı): "çalış(sıfır genişlikli boşluk)mıyor" artık arıza.
- **Operatör "Kuyruk sağlığı"** (S3-08): bilerek bekletilen satır (otomatik mesaj anahtarı kapalı, abonelik bekletmesi, duraklatma) artık
  kırmızı görünmüyor; kırmızı yalnız işçinin alabileceği satır geride kalınca (alarmla aynı süzgeç).
- **Kalıcı kuyruk ölçeği** (S3-07 / S3-09, anahtar kapalı): migration 79 + talep işleminde veritabanı tarafı 10 sn tavanı (Prisma'nın işlem
  zaman aşımı çalışan sorguyu kesmiyordu — ajan ölçtü); kilitli tabloda talep 0,4 sn'de kesilip "talep yok" dönüyor (testli). Ajanın üç
  önerisinden ikisi ölçümle REDDEDİLDİ: talep katmanına LIMIT (doygunlukta açlık karşı örneği) ve üç sütunlu dizin (claimedAt dizini varken
  planlayıcı seçmedi).
- **Testi olmayan beş rota** (S7-08): elle senkron, kopya temizliği, üç önizleme — personel 403, dakika tavanı doğru öznede, başka işletmenin
  verisi ne okunur ne silinir.
- **Söz testleri saatten bağımsız** (CI #1545): elle açılan söz bir dakika geri tarihlenir; gece yarısı kuralı yalnız kendi testinde açık
  (yalnız-test anahtarı, `__stayEndHooks` gibi). Gece simülasyonunda 29 dosya / 592 testten yalnız kuralın kendi testi kırmızı (beklenen).

- **Opus dilim sonu 3 (sabah) — söz algılama, anahtar kapalı:** bu gecenin bir gerilemesi düzeltildi ("sabah 9'da değil akşam" eski saati
  seçiyordu → saat sorulur); "3'ü 10 geçe" gece sanılmıyor; "2 or 3", "10 veya 11", "at 2-3", "from 2pm", "10'dan 12'ye kadar" kesin saat
  değil; "ne olursa olsun / geç olsa da" koşul değil; "hava çıkışı", "teknisyen gelmeden önce" konaklama anı değil; en yaygın yeniden
  zamanlama mesajı ("Teknisyen bugün gelemeyecek, yarın 10'da gelecek") artık söz. Derlem 303/323.
- **T3 (kurucu kararı):** "bilgi veremem" yedi dilde tutulur. **T6b (kurucu kararı):** işlenememiş ödeme olayları 2 yılda küçülür.
- **Push sonrası küçük kalanlar (Opus dilim sonu 3, anahtar kapalı):** "Ayşe Hanım yarın 11'de temizliğe gelecek" artık söz (A12); "at 2 p.m
  tomorrow" günü kaybetmiyor (A14); "Teknisyenimiz M. Ali yarın 10'da gelecek" baş harf cümleyi bölmüyor (mutasyonun yakaladığı kök); otomatik
  kipte bir konuşmada 5'ten çok bekleyen söz varken en eskisi kaybolmuyor (A16, kırmızı-önce testle). Denenip ALINMAYAN: "p.m." ardından
  küçük harfli özneyi cümle sonu saymak — derlemi 303'ten 301'e düşürdü ("Tomorrow at 2 p.m. the cleaner will come" çok daha yaygın).
  Mutasyon v10–v13: 43 mutant koşusu — 39'u ilk koşuda öldü, yaşayan 2'si yeni pinle kapandı, "p.m" sınır mutantı (iki koşuda) gerekçeli
  eşdeğer (1596 cümlede aynı sonuç). Bu gece ajan çalıştırılmadı
  (kurucu talimatı) → bu dört düzeltmenin sert incelemesi sabah Opus turunda.

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

- **Opus dilim sonu denetimi** (9 bulgu; dosya oturum notlarında): rezervasyon silmede yüklem kilit altında (B1), kalıcı kuyruk kablosu testli
  (B3), "Is everything else ok?" / "her şey tamam mı?" gerçek sözü düşürmüyor (B5), "gece 12:30" ertesi gün 00:30 (B7), mesaja kapalı tek
  kanal bağlantıyı koparmıyor (B8), belge (B9). Kiracılar arası sızma, KVKK değer sızıntısı, karesel iş bulunmadı.

## 3. Bilinen sınırlar / bilerek bırakılanlar
- Elle "Mesajları çek" (540 günlük derin çekim) bütün işletmelerin 2 dakikalık senkron kilidini dakikalarca tutabiliyor (S7-03): bugün tek
  müşteride etkisiz; çok müşteride diğerlerinin otomatik cevabı gecikir. Düzeltme senkron mimarisine dokunuyor (işletme başına kilit ya da elle
  çekimde sığ pencere) → ayrı tur, ölçümle.

- Kuyruktaki karşılama / giriş / çıkış mesajı, anahtar KAPALIYKEN vadesi gelirse iptal olur (S3-01, kalıcı kuyruk anahtarı kapalı). Anahtarı
  açınca o rezervasyon zaten kapsam dışıdır (açılma anından sonra oluşan rezervasyonlar alır — bugünkü kural); kısa bir "kapat-aç" yakın varışlı
  misafirin giriş mesajını düşürebilir ve gelen kutusunda iz yok (Opus B6, tasarım notu).
- Söz öneri anahtarının biçimi bu gece iki kez değişti (konum + tür). Canlıda hiç açılmadığı için etkisiz; yerel veritabanında eski kararlar varsa
  aynı söz yeniden önerilebilir. Bundan sonra biçim değişirse eski biçimi de tanıyan karar araması gerekir.
- `probeToken` (tek sayfa, tek deneme) sözleşmesi doğrudan pinli değil; adaptör sınaması ve uçtan uca kablo testi var.
- Sync'te rezervasyon başına ~12 sorgu (S8-02): bugünkü ölçekte (≈10 daire) sorun değil; 20+ büyük işletmede 2 dk'lık geçişi aşar → tasarım
  `docs/arastirma-2026-10-18/S8-performans.md` (açık performans kalemlerinin hepsi orada); Railway açılınca ölçümle.
- Gelen kutusu listesinde son mesaj için bütün mesajlar okunuyor (S8-06): bugünkü hacimde 30 sn'de bir ~270 KB; büyüyünce tek sorguya çevrilir.
- Kalıcı kuyruk (anahtar kapalı): ödeme bekleyen yaşam döngüsü satırları iptal edilmiyor (S3-04 — sınırlı, talepte elenir, 24 ay saklamayla biter;
  ödeme gelince bayat olan veto ile iptal); teslim etkisi onarıcısı 48 saatte 5.000 gönderimi aşarsa en yenileri taramaz (bugünkü hacimde
  etkisiz); işletmeler arası adalet kurucu sorusu T8.19. Tablo `docs/arastirma-2026-10-18/S8-performans.md`.
- Söz: yüklemli alışkanlık / konaklama parçası açık günsüz sözü düşürür ("Siz gidince kapıyı kilitleyin, teknisyen 10'da gelecek" — gün
  gerçekten belirsiz; tutucu yön, pinli). "Let me know, I'll bring towels tonight" koşul sayılır (tutucu).
- "Bu gece teknisyen gelecek" 01:00'de yazılırsa gecikme uyarısı bir gün geç gelir (söz kaydı doğru; yalnız panel uyarısının zamanı).
- "The cleaning crew will come…" (crew / team öznesi) söz sayılmıyor — söz kapsamını genişletmek ayrı karar.
- Arıza kemerinde (anahtar kapalı) Almanca / Fransızca / İspanyolca / Rusça arıza sözcükleri yok (S4-03 eki).
- Söz (anahtar kapalı): "I'll bring towels at 6 p.m. the technician will come tomorrow." küçük harfle başlayan ikinci cümle birleşir, havlu
  sözü düşer (güvenli yön, pinli); "Sorun olursa kapı B. Teknisyen yarın 10'da gelecek." önceki cümlenin koşulu sözü düşürür (pinli). Öneri
  anahtarı cümlecik sırasından kurulduğu için bölme kuralı değişince anahtar kayar (A15) — anahtarlar canlıda hiç açılmadı, etkisiz; açılmadan
  önce karakter konumundan anahtar düşünülmeli (tasarım kararı, sert incelemeyle).
- Kuyruk planı testleri (C2) işçinin gerçek sorgusunu değil eşdeğer kopyasını EXPLAIN ediyor; gerçek sorguyu sınamak üretim koduna yalnız test
  için kanca ister → bırakıldı. Zaman aşımı testi gerçek yolu sınıyor.

## 4. İtme / CI
| İtme | İçerik | Tam kapı (yerel) | CI |
|---|---|---|---|
| … `b4cc74cf` | gece-4 ilk tarama düzeltmeleri, söz algılama v2, migration 76 / 77 | yeşil | #1539 KIRMIZI — KB düzenleyicide korumasız `scrollIntoView` (zamanlamaya bağlı) |
| `a322c310` | `scrollIntoView` koruması + iki yolda görünür yere getirme + pin | yeşil | #1543 yeşil |
| `a55a4842` | migration 78 (yalnız dizin) | yeşil | #1545 KIRMIZI — söz testinde milisaniye yarışı (ürün kodu değil); ↓ düzeltildi |
| `08fcb660` … `fbe9a12b` | ikinci tarama düzeltmeleri, sert itirazcı + Haiku söz turları, S3-07/08/09 + migration 79, S7-08 testleri, CI #1545 yarışı + gece zaman bombası | g93 (`4a6ba778`) + g94 (`65f3c139`) yeşil | #1547 yeşil |
| `6ca0ede0` … `e83bd552` | Paddle sel freni, panel testleri, Haiku son grup, Opus dilim sonu 3, T3, T6b, mutasyon v10 (31 mutant: 29 öldü, yaşayan 2'ye pin eklendi) | g95 yeşil (veritabanlı 4305 · veritabanısız 10212 · süre 3083) | #1549 yeşil |
| `f083954d` … `5d221d99` | A12 / A14 / baş harf / A16 + C1 yorumu + belge | g96 yeşil (`48c916fe`; veritabanlı 4306 · veritabanısız 10212 · süre 3085; üstü yalnız belge) | #1551 yeşil |
| `e566de1d` … | T1 hazır yaması (seçenek A, uygulanmadı) + T2 uygulama notu — yalnız belge | — (kod değişmedi) | itme sonrası izleniyor |

Yerel tam kapı = paralel `npm test` (veritabanısız / veritabanlı / süre kolları) + tip + lint + derleme + bağımlılık denetimi. Not: g93 yeşildi ama
İstanbul 05:39'dan sonra koştuğu için gece zaman bombasını göstermedi — bundan sonra söz testleri saatten bağımsız (gece simülasyonuyla doğrulandı).
