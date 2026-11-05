# Tur 4 — QR sohbeti, anlama katmanı, bilgi tabanı, e-posta, operatör paneli (2026-11-05)

> Kurucu: "işin bitince yeni derin analiz turları; çürütücülerle; kurucuya rapor."
> Nasıl: beş alan (QR misafir sohbeti uçtan uca · anlama katmanı + istemler · bilgi tabanı / getirme · e-posta · operatör paneli) ayrı
> ajanlarla okundu; her güçlü bulgu ayrı bir **çürütücü** tarafından kodda yeniden üretilmeye çalışıldı (veritabanısız deneme betikleri,
> gerçek modül). Bulgu ancak çürütücü yeniden üretince "doğrulanmış" sayıldı; abartılı kısımlar düzeltildi. Güvenlik ayrıntısı bu PUBLIC
> repoya yazılmadı (yalnız özet). Ham notlar oturumun çalışma klasöründe.

## 1. YAPILANLAR (müşteriye giden metni değiştirmeyen ya da sizin önceki kararınızın uygulaması)

| # | Ne | Önce → sonra (ölçüm) |
|---|---|---|
| 1 | **Anlama katmanı mesajın tamamını görmediyse "baktı, acil değil" sayılmıyor.** Anlama katmanı her mesajın ilk ~1.000 karakterini ve en çok 5 isteği okur. Uzun bir mesajın SONUNDAKİ tehlike ("…bu arada banyoda su basıyor") ona hiç girmiyordu, ama kod "model okudu ve acil değil dedi" sayıp olası-tehlike etiketini kaldırıyordu. | 1.100 karakterlik gezi anlatımı + "banyoda su basıyor": QR'da kritik uyarı **YOK → VAR**. Kural artık öğe kipi / kapanış / erken giriş modülleriyle aynı (tek yardımcı `understandingSawAll`). Yalnız sıkılaştırır. |
| 2 | **QR'da aynı acil metin 3 saat sonra yeniden gelirse ev sahibine yine kritik e-posta gidiyor.** | Sabah "Gaz kokusu var" → akşam aynı cümle: e-posta **gitmiyordu** (konaklama boyunca, siz QR'ı yeniden açmadıkça) → **gider**. Sel koruması aynen: aynı metin en sık 3 saatte bir, saatte en çok 3 kritik e-posta. |
| 3 | **Sizin S2 onayınızın uygulaması:** QR kritik olay e-postası artık "acil" diyor (kanal yolundaki gibi). | Konu "⚠️ Misafir sohbetinde size devredilen mesaj" → **"⚠️ Acil misafir mesajı — {daire}"**; gövde "…güvenlik kuralları gereği yanıtlamadı" → **"Misafir QR sohbetinden acil olabilecek bir durum bildirdi (yangın, gaz, duman, su baskını, mahsur kalma gibi). Yapay zekâ cevap vermedi ve size devretti — lütfen hemen kontrol edin."** Misafir adı / mesajı yine yok. ⚠️ Gövde cümlesi benim yazımım — değiştirmek isterseniz söyleyin. |
| 4 | **Güvenlik (özet):** misafir mesajında istemin bölüm işaretlerini taklit eden bazı karakter biçimleri insana devredilmiyordu; üç ayrı yerdeki karakter listesi birbirinden kopmuştu. | Liste tek ailede; o biçimler artık insana devrediliyor. 32.610 gerçek metinde (değerlendirme setleri + ölçüm çıktıları) eski / yeni kod **birebir aynı** (yanlış alarm artışı 0). |
| 5 | **K10 kararınızın kaçan biçimleri:** "Your message is recorded and visible to your host.", "İsteğiniz kayıtlı ve ev sahibiniz görebiliyor." gibi cümleler vetodan geçiyordu. | Ölçüm çıktılarında **24 cevap** bu cümleyi taşıyıp misafire GİDİYORDU → artık tutulur, size haber verilir. Başka hiçbir cevap etkilenmedi (32.610 metin). "Tarihleriniz 12–15 Mart olarak kayıtlı" gibi bilgi cümleleri tutulmaz (testli). |
| 6 | Test e-postası dipnotu düğmenin yerini **yanlış** gösteriyordu ("Ayarlar › Bağlantılar"; düğme Genel'de); düz metin sürümünde "&rsaquo;" gibi kodlar görünüyordu. Hitap kuralınız: "Gelen kutunu kontrol et." → "Gelen kutunuzu kontrol edin."; bütün e-postaların alt bilgisi "Lütfen yanıtlamayınız." → "Lütfen yanıtlamayın." | Dipnot "Ayarlar › Genel bölümündeki “Test e-postası gönder” düğmesi…". |
| 7 | Demo (Airbnb inceleme) hesabında görev yeniden atanınca `…@example.com` demo personeline **gerçek e-posta denemesi** gidiyordu (teslim edilemez → geri dönen e-posta, gönderici itibarı). | Demo hesabında atama yapılır, e-posta gitmez (demo verisinin kendi ilkesi "hiçbir şey göndermez"). |

Kanıt: her düzeltme kırmızı-önce (eski kodda test kırmızı); mutasyon 16/16 (ilk koşuda 2 mutant yaşadı → iç içe ayraç testi eklendi, ikisi de
elle yeniden üretildi ve öldü); en kötü kip düzenli ifade süre pinleri yeşil; tam kapı + build yeşil olmadan push yok.

## 2. KURUCUYA SORULAR (müşterinin / misafirin gördüğü metin ya da davranış değişir)

**Doğrulanmış (çürütücü kodda yeniden üretti):**

**S1 — Önceki misafirin cihazı sonraki konaklamaya bağlanabiliyor (QR, düşük–orta).** PIN'siz konaklamada QR sohbeti "ilk açan cihaz"a bağlanır
(bilinen ödünleşim, "Cihaz kilidini sıfırla" çaresi var). Yeni olan: önceki misafirin telefonunda açık kalan sohbet sekmesi, telefon açıldığı an
sonraki konaklamayı **kendiliğinden** kendine bağlayabiliyor; gerçek misafir "başka cihazda başlatıldı" görüyor. Sıfırlamadan sonra da aynı yarış.
- Önerim (misafir ekranı değişmeden, sunucuda): bu dairenin **önceki** konaklamasına bağlı bir cihaz yeni konaklamaya kendiliğinden bağlanmaz;
  "sıfırla" yalnız şimdiki konaklamayı temizler.
- ÖRNEK: Ali 10:00'da çıktı, sekmesi açık kaldı. Ayşe 15:00'te girdi. Ali 16:00'da telefonuna bakıyor → **önce:** Ayşe'nin sohbeti Ali'nin
  telefonuna bağlanır, Ayşe QR'ı okutunca "başka cihazda başlatıldı" görür. **Sonra (önerdiğim):** Ali'nin sekmesi Ayşe'nin sohbetini açamaz
  (sohbet kapalı ekranı); Ayşe okutunca sohbeti açılır.
- Daha kesin seçenek: bağlama yalnız bir düğmeyle ("Sohbeti başlat") — misafir ekranına bir adım ekler. Böyle yapalım mı?

**S2 — Yangın / gaz dışında kalan kritik olaylarda e-posta gövdesi (e-posta, düşük).** Günlük daire hakkı ya da QR payı dolduğu anda gelen kritik
olay (ör. "kapıda kilitli kaldım") e-postası yalnız "Günlük otomatik yanıt limiti dolduğu için…" diyor. Önerim: kritik olayda bu gövde de
"acil olabilecek bir durum" cümlesiyle başlasın (1. bölümdeki #3 ile aynı). Böyle yapalım mı?

**S3 — "Misafir cevabınızı bekliyor" e-postası kısmi cevaptan sonra da "otomatik bir cevap gönderilmedi" diyor (e-posta, düşük).**
Misafir "Wi-Fi şifresi ne? Sitede sauna var mı?" yazdı → Wi-Fi cevabı gitti, sauna size kaldı.
- **Önce:** "…bir misafir mesajını yapay zekâ size bıraktı. Misafire otomatik bir cevap gönderilmedi. Lütfen konuşmayı açıp yanıtlayın."
- **Sonra (önerim):** "…misafirin mesajının bir kısmı otomatik cevaplandı; aşağıdaki konu sizin cevabınızı bekliyor. Lütfen konuşmayı açıp yanıtlayın."
- Aynı sınıf QR'da: ev sahibiyle iletişim kısmı silinip kalan cevap gidince e-posta "Yapay zekâ… bu mesajı yanıtlamadı" diyor. Böyle yapalım mı?

**S4 — Konuşma kayıtları bloğu (açılış sırası 2. adım) modele "kayıtlı olduğunu ve ev sahibinin görebildiğini söyle" diyor (istem, düşük).**
Bu, K10 kararınızla (bildirim cümlesi gitmesin) çelişiyor. 1. bölüm #5 ile çıktısı artık tutuluyor, ama istem satırı tutulan cevap üretmeye devam eder
(tutulan cevap = size bırakılan mesaj). Önerim: satır "ev sahibinde bekleyen konuya değinme; kayıt / görme / iletme cümlesi yazma" olsun.
İstem değişikliği → ücretli ölçüm gerekir. Ölçümü açalım mı?

**S5 — Kıdemli okuyucunun yeniden yazma notu "GERÇEK BİLGİLER" bloğunun içine giriyor (istem, düşük).** Not, örnek olarak "Otopark ücreti gişede
ödeniyor." cümlesini taşıyor; aynı blokta bilgi tabanının "günlük 200 TL" satırı da var → model örneği olgu sanabilir. Önerim: yeniden yazma notu
bilgi bloğunun DIŞINA, talimat bölümüne; örnek soyut ("X yazıyor" yerine "X"). İstem → ücretli ölçüm. Açalım mı?

**S6 — Kanal acil e-postası tıbbi acil / yangını "Şikayet" diye çerçeveliyor (e-posta, düşük).** Konu doğru ("⚠️ Acil misafir mesajı"), gövde her
durumda "Şikayet — sizin ilgilenmeniz gerekiyor · …bir misafir şikayeti tespit edildi".
- ÖRNEK: "Annem bayıldı, nefes almıyor" → **önce:** "Şikayet — …misafir şikayeti tespit edildi". **Sonra:** acil türlerde "Acil durum — lütfen
  hemen kontrol edin · …bir misafir acil olabilecek bir durum bildirdi", şikâyetlerde bugünkü metin. Böyle yapalım mı?

**S7 — Şifre sıfırlama e-postasının düz metin sürümünde bağlantı yok (kimlik e-postası, düşük).** Metin "aşağıdaki bağlantıyı açın" diyor ama bağlantı
yalnız HTML düğmesinde; yalnız metin gösteren e-posta programında sıfırlama tamamlanamıyor. Doğrulama e-postasında aynı bağlantı zaten düz metinde
var. Önerim: aynısını sıfırlama e-postasına eklemek. Kimlik akışı olduğu için soruyorum; ilk denemeyi birlikte yapalım mı?

**S8 — Operatör panelinden açılan hesap (kimlik, düşük).** (a) E-posta adresi kanıtlanmadan "doğrulanmış" sayılıyor ve müşteriye hiçbir e-posta
gitmiyor; adres yanlış yazılırsa acil misafir uyarıları yanlış kutuya ya da hiçbir yere gider ve müşteri bunu düzeltemez (e-posta değiştirme
ekranı yok). (b) Kullanım Koşulları / Gizlilik kabul kaydı yok. Önerim: D-1 (şifre) ile tek akış — operatör hesabı açınca müşteriye **davet
bağlantısı** gider; müşteri şifresini oluştururken adresi kanıtlanır ve koşulları onaylar. Ara önlem (metin değişmez): formda "e-postayı tekrar
yazın" alanı + müşteri listesinde sahip e-postası. Hangisi?

**S9 — Operatör panelindeki "son 50 kayıt" listesi giriş denemeleriyle kolayca dolabiliyor (operatör paneli, düşük).** Liste her türden olayı
gösterdiği için önemli operatör eylemleri (bürünme, dışa aktarma, 2FA sıfırlama) normal trafikte de birkaç günde görünmez oluyor. Önerim: ayrı
"Operatör eylemleri" listesi (yalnız operatör eylemleri), sütun başlığı "Yapan". Kayıtlar veritabanında kalıyor (kayıp yok). Yapalım mı?

**S10 — Bilgi tabanı sır kapısı: kod sözcüğü olmadan yazılmış 3 haneli / harfli kapı kodu ve kısaltmalı Wi-Fi şifresi (güvenlik, düşük).**
T3 ile aynı sınıf (bilinen ve pinli denge). Ör. "Anahtar kutusu: 459", "Wi-Fi: Ev / şifre-kelimesi". Önerim: T3 kararınızla birlikte, ölçülmüş
yanlış eleme sayısıyla (adres / daire numarası kaybı) sunayım. Ayrıntı public repoya yazılmadı.

**Kodda satır satır okunarak doğrulandı, deneme betiği / çürütücü koşmadı (uygulanmadan önce her biri testle yeniden üretilir):**

- **S11 — QR saatlik 40 mesaj tavanı aşıldığında açık tehlike mesajı kaydedilmiyor, kritik uyarı yok.** Günlük tavan dalları kritik olayı taşıyor;
  saatlik dal taşımıyor. Önerim: tavan aşımında açık tehlike → mesaj kaydedilir + kritik e-posta; misafirin gördüğü tavan metni aynı.
- **S12 — Bağlandıktan SONRA PIN üretilirse bağlı cihaz PIN'siz kalıyor** ve PIN'li konaklama sayıldığı için Wi-Fi bilgisini alabiliyor; doğru PIN'i
  giren gerçek misafir "başka cihazda" görüyor. Önerim: PIN üretilince bağlama sıfırlanır (bağlı misafir PIN'i bir kez girer) ya da Wi-Fi yalnız
  PIN'den sonra bağlanan cihaza.
- **S13 — Devir günü iptal edilmiş konaklama uyarısı kör.** Onaylı misafir sabah çıktıysa, öğleden sonra iptal edilmiş rezervasyonun misafiri
  QR'dan yazarsa mesaj kaydedilmiyor, size e-posta gitmiyor (ertesi öğlene kadar). Önerim: "yakında onaylı konaklama var" sayımına çıkmış
  konaklama girmesin. Ödünleşim: çıkışı geciken misafir yazarsa size "iptal" uyarısı gider.
- **S14 — Deneme e-postaları:** "Kartınızdan deneme boyunca hiçbir ücret alınmadı" kartsız denemede de yazıyor; "deneme bitti" e-postası "bize her
  zaman ulaşabilirsiniz" diyor ama iletişim adresi yok ve alt bilgi "yanıtlamayın" diyor. Önerim: kartsız denemede o cümle yok; destek adresi eklenir.

## 3. Bakılıp bulgu ÇIKMAYANLAR (kısa)
- Kiracılar arası: bilgi tabanının modele giden beş yolu da mülkü işletmeye doğrulanmış kayıttan alıyor; KB rotaları işletme kapsamlı.
- E-posta: bütün dinamik değerler kaçışlı, konu tek satır, alıcı daima kiracının kendi adresi; misafire hiçbir e-posta gitmiyor.
- Model çağrıları: her arıza kapalı küme, fırlatmıyor; zaman aşımında güvenli taraf.
- Düzenli ifadeler: seçim, dizin, sır taraması, talimat süzgeci üç kipte doğrusal (karesel yok).
