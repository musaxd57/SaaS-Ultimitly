# Lixus AI: Tasarım ve Metin İncelemesi Sonuç Raporu

## Kapsam ve genel hüküm

- **Eksik yok:** 61 sayfanın tamamı incelendi; incelenemeyen sayfa ya da yakalanamayan bölüm yok.
- **Sınırlar:** İnceleme ekran görüntüsü, sayfa metni ve ölçümlere dayanıyor; düğmelere basılıp denenmedi. Örneğin "silmeden önce onay soruluyor mu" görülemedi.
- **Ortam notları:** Veriler demo verisi. QR sohbeti, cevap modeli bağlı değilken çekildi; yargılanan şey cevabın yokluğu değil, misafirin o anda ne gördüğü. Ödeme sağlayıcısı sahte anahtarla kuruluydu; "ödeme ekranı yüklenemedi" türü uyarılar kusur sayılmadı.
- **Genel hüküm:** Hiçbir sayfada yana taşma yok, iskelet sağlam. Ürün üç yerde kaybediyor:
  1. Telefonda parmakla kullanılamayacak kadar küçük hedefler ve aşağıda kalan ana düğmeler.
  2. Ev sahibine değil geliştiriciye yazılmış metinler.
  3. Sorunu gösterip çözüme götürmeyen ekranlar.
- **En ağır bulgular:** 30'dan fazla kayıt en ağır seviyede (P0). Çoğu aynı birkaç sorunun tekrarı: sessiz kalan misafir sohbeti, çıkmaz ekranlar, hata göstermeyen kayıt formu, belirsiz abonelik, güven vermeyen satıcı bilgileri.

---

## 1. İlk izlenim (tanıtım sayfası, giriş, kayıt)

### Ev sahibi telefonda ilk beş saniyede ne görüyor?

**Tanıtım sayfası**
- İlk ekran işini yapıyor: başlık, alt metin ve iki düğme ürünün ne olduğunu ve kimin için olduğunu söylüyor.
- Üstteki yaklaşık 80 px boşluk yüzünden "Kredi kartı gerekmez…" satırı alttan kesiliyor.
- Kaydırınca ilk kanıt çöküyor: "Lixus AI iş başında" önizlemesi masaüstü genişliğinde kalmış. Ekranın yarısı sol menü, mesaj "Hi! What's the WiFi passw" diye kesik, yapay zekânın cevabı hiç görünmüyor.
- Kurulum önizlemesinin başlığı "API bağlama anlatımı", alt satırı "token'ı yapıştır". Aynı sayfa "Kurulum ekibi, eğitim, kod yok" diyor.
- Önizlemenin içinde gerçek gibi duran ama çalışmayan bir "14 gün ücretsiz dene" düğmesi var.
- Yarı saydam üst çubuk ekranın yaklaşık dörtte birini kaplıyor. Altından geçen başlıklar, plan adı "Pro" ve düğmeler yarım ve bulanık görünüyor.
- Sayfa telefonda 24 ekran. İlk 8 ekranda fiyata dair tek rakam yok.
- 9–16. ekranlar arasında sayfa içinde tek bir çağrı düğmesi yok; aynı vaatler üçer dörder kez tekrarlanıyor.

**Giriş**
- Telefonda yalnızca logo, "Tekrar hoş geldiniz" ve "Operasyon panelinize giriş yapın." var.
- Airbnb, Booking, misafir mesajı ya da ev sahibi kelimeleri hiç geçmiyor. Davetle gelen temizlikçi doğru yerde olduğunu anlayamaz.

**Kayıt**
- Telefonda neye kaydolunduğu yazmıyor.
- Dört satırlık yeşil deneme kutusu yüzünden onay kutusu ve "Hesap Oluştur" düğmesi ilk ekranda görünmüyor.
- Düğme soluk gri ve neden pasif olduğu yazmıyor.

### Neye güvenmiyor?

| # | Güveni düşüren şey | Nerede |
|---|---|---|
| 1 | Hatalı alanlarla gönderince hiçbir hata mesajı çıkmıyor; form bozuk gibi duruyor | Kayıt |
| 2 | Deneme bitince ne ödeyeceği kayıt ekranında yok; fiyat bağlantısı da yok | Kayıt |
| 3 | Fiyat kartlarında "Başla" düğmesi: deneme mi başlıyor, ödeme mi isteniyor belli değil | Tanıtım |
| 4 | Fiyat alt başlığı çelişkili: "daire sayınıza göre seçin; daire başına değil, sabit ücret". "Aylık planda iptal" deniyor ama yıllık plan görünmüyor | Tanıtım |
| 5 | Şikayet örneğinde yapay zekâ misafire yazıyor gibi görünüyor ("Yatıştırır + bilgi toplar"). Sayfanın başka yeri "şikayeti asla kendi yanıtlamaz" diyor | Tanıtım |
| 6 | Örnek yanıt hem "müsait" diyor hem "I'll confirm with the host" diyor; ev sahibinden üçüncü kişi gibi söz ediyor | Tanıtım |
| 7 | Pencere çerçeveli kartlar ekran görüntüsü vaat ediyor; içlerinde iki satır yazı var | Tanıtım |
| 8 | Boş rozetler: "Kullanıcı dostu arayüz", "KVKK odaklı tasarım" | Tanıtım |
| 9 | Boş slogan: "Kurallara uygun, sağlam, uzun ömürlü operasyon platformu." | Giriş, kayıt, şifre (masaüstü) |
| 10 | Giriş sayfasında gizlilik, koşullar ve destek bağlantısı yok; alt bilgide şirket unvanı ve destek e-postası yok | Giriş, tanıtım |
| 11 | Demo hesabının adresi başka marka: `demo@guestops.ai` | Giriş, Hesap ayarları |
| 12 | "Türkçesi çeviri kokmaz" diyen sayfada yazım hatası: "Soruların sizin üslubunuzla yanıtlanır" | Tanıtım |
| 13 | Kurulum bir yerde 3, bir yerde 4, bir yerde 5 adım; cevap hızı bir yerde "anında", bir yerde "dakikalar içinde" | Tanıtım |
| 14 | Demo formu ne olduğuna karar verememiş: "Kurulumda yardım", "Ücretsiz demo iste" ve "Kredi kartı gerekmez" aynı formda. Alan etiketleri yok, düğme soluk | Tanıtım |

### Yasal sayfalara tıklarsa (ödeme öncesi en çok bakılan yer)

- **Satıcı bilgisi:** Şahıs adı "[satıcı adı]" (Türkçe karaktersiz), [adres] adresi, [telefon] ve `[e-posta]`. Alan adı lixusai.com iken iletişim [e-posta servisi].
- **Yanlış etiket:** yurt dışı adresinin yanında Türkiye'ye özgü "MERSİS/Vergi No" yazıyor.
- **Tarih:** Dört yasal metinde "Son güncelleme: Kasım 2026". Gün yok ve tarih ileri tarihli görünüyor; gerçek tarihi kontrol edin.
- **Taslak notu:** Güvenlik sayfasında kırmızı bayrakla "nihai metni avukat incelemesindedir" notu yayında duruyor.
- **Tek kişi vurgusu:** Aynı sayfa iki kez "tek kişilik ekip" diyor.
- **Cayma hakkı:** Bir madde "14 gün hak var" diyor, sonraki madde "sona erebilir" diyor. Müşteri parasını geri alıp alamayacağını anlayamıyor.
- **Yıllık plan:** Ön bilgilendirmede yenileme maddesi yıllık planı atlıyor.
- **Entegrasyonlar:** İkinci bir ücretli abonelik (Hospitable) gerektiğini söylüyor ama tutarını vermiyor.

---

## 2. Telefonda bozulanlar (en kötüden)

Yana taşma hiçbir sayfada yok. Sorun üç başlıkta toplanıyor: 40 px'ten küçük dokunma hedefleri, ana eylemin ekran dışında kalması ve çok uzun sayfalar.

### Her panel sayfasında tekrar eden üç sorun

- **Üst çubuk:** Menü, tema (ay) ve çıkış simgeleri küçük. Çıkış etiketsiz ve tema simgesine bitişik; yanlış dokunuş oturumu kapatır, formda yazılanı kaybettirir.
- **Çift başlık:** Sayfa adı üst çubukta ve hemen altında iki kez yazıyor (Girişler, İptaller, Mülkler, Bilgi Tabanı, Misafir Sohbetleri, Ayarlar). Dar ekranda bir satır boşa gidiyor.
- **Küçük hedefler:** Panel sayfalarının çoğunda dokunulabilir öğelerin neredeyse tamamı 40 px'in altında.

### Sayfa sayfa

| Sıra | Sayfa | Telefonda ne bozuk | Küçük hedef |
|---|---|---|---|
| 1 | Konuşma ayrıntısı | "Gönder" düğmesi ilk ekranda yarım kesik, klavye açılınca tamamen kayboluyor. Başlık ve araçlar ekranın üçte birini kaplıyor. "Sil", geri okunun dibinde | 17/18 |
| 2 | Tanıtım sayfası | İki önizleme sağdan kesik. Üst çubuk içeriğe biniyor. 24 ekran. Onay kutusu yaklaşık 16 px; alt bilgi bağlantıları yalnızca yazı yüksekliğinde | 12 |
| 3 | Ayarlar: Yapay zekâ ve otomasyon | 8 ekran (5246 px). Aynı açıklama üç kez. 12 örnek çipi "…" ile kesik ve bir ekran tutuyor. Onay kutuları yaklaşık 12 px | 39/42 |
| 4 | Daire ayrıntısı | 10 ekran (6208 px), bölümler arası gezinme yok. QR ve rezervasyonlar en dipte. "Mülkü sil", "Geri"ye bitişik | 51/56 |
| 5 | Görevler | İlk ekranda neredeyse hiç görev yok; başlık, bilgi kutusu ve üç sıra filtre dolduruyor. Çöp kutusu her kartta başparmağın yolunda | 34/34 |
| 6 | Bilgi tabanı | Kartlardaki dört simge küçük ve etiketsiz; sil, aç/kapatın dibinde. Mevcut kayıtlar formun altında, iki ekran aşağıda | 45/46 |
| 7 | QR sohbeti (panelden yanıt) | Yanıt kutusunun ipucu yazısı kesik ve telefonda anlamsız ("Shift+Enter"). İki önemli uyarı sayfanın en küçük yazısı (9 metin 12 px altı) | 9/9 |
| 8 | Girişler | Kart altındaki "Konuşma / Mülk / Görevler" bağlantıları küçük, bitişik ve bağlantı gibi görünmüyor | 7/7 |
| 9 | Temizlikçi: görevler | Ekranın yarısı 9 filtre. "Başladım" ancak en altta. "Yapamıyorum" küçük kırmızı yazı, "Bitti"ye çok yakın | 23/23 |
| 10 | Pano | Kurulum kartı ilk ekranın tamamını kaplıyor. Bekleyen mesaj 3. ekranda, acil görev 4. ekranda | 10 |
| 11 | Gezinme menüsü | Raporlar ve Ayarlar kullanıcı kartının altında kalıyor, hiç görünmüyor. Satırlar yaklaşık 38 px ve bitişik | 26 |
| 12 | Gelen kutusu | Liste ekranın alt yarısında başlıyor. Daire adı "Kadıköy Deniz Manz…" diye kesik. Arama ipucu yarım | 14/17 |
| 13 | Ayarlar: Bağlantılar | Yapıştırma kutusu ve "Bağla" düğmesi iki sarı uyarının altında, ikinci ekranın dibinde. "Bağla" dar ve sola yaslı | 7/7 |
| 14 | Şablonlar | "Kendime uyarla" düğmesi kartın sağ yarısını kaplıyor; şablon metni sol yarıda tek satırda kesiliyor. 16 şablon 5 ekran | 22/22 |
| 15 | Takvim | Boş ve dolu geceler telefonda hiç görünmüyor. Daire filtreleri yaklaşık 24 px, ay okları yaklaşık 30 px | 9/9 |
| 16 | Ayarlar: Genel | Gizlilik onay kutusu yaklaşık 12 px. Açıklama 8 satır küçük gri yazı | 12/12 |
| 17 | Ayarlar: Abonelik | Onay kutusu çok küçük, sözleşme bağlantıları hemen yanında. İşletme kartına inince onay kutusu ekran dışında | 11/11 |
| 18 | Ayarlar: Hesap | 4 ekran metin duvarı (2094 px). Kritik notlar soluk küçük yazıda | 11/11 |
| 19 | Kayıt | Ana düğme ve onay kutusu ilk ekranda yok. Onay kutusu ve göz simgesi küçük | 4 |
| 20 | Şifre: gönderildi ekranı | Dört eylemin dördü de alt alta dar aralıklı çıplak yazı | 4/4 |
| 21 | Raporlar | İlk iki ekranı dört tane "0" kartı kaplıyor; açık şikayet çok aşağıda | — |
| 22 | Yeni görev, yeni daire, yeni konuşma | Giriş kutuları yaklaşık 36–38 px. Ana düğme ikinci ekranın dibinde, dar ve sağa yaslı | 13/14, 14/15, 11/12 |
| 23 | Misafir sohbeti | Saatler, kapı kodu notu ve "Gizlilik" bağlantısı 12 px altı ve soluk | 1 |
| 24 | Yasal sayfalar | Gizlilik 15 ekran, Koşullar 9 ekran; içindekiler ve "başa dön" yok | 6/6 |
| 25 | Boş sayfalar (yeni hesap) | Pano, Mesajlar, Daireler, Görevler, Takvim, Girişler, Bilgi Tabanı: düğme ve simgelerin neredeyse tamamı küçük | 13/16 – 15/15 |

**Tek kural yeter:** Telefonda her düğme, kutu, çip ve simge en az 44 px yükseklikte olsun. Çıkış, menünün en altına yazılı etiketiyle taşınsın.

**Masaüstü notu:** Aynı küçük hedef sorunu orada da ölçüldü (örneğin Görevler 48/49, Daire ayrıntısı 65/71). Fareyle etkisi sınırlı, tablet ve dokunmatik dizüstünde aynı dert.

---

## 3. Yazılar

### 3.1 Aynı şeye farklı ad

| Kavram | Ekranda geçen adlar | Öneri (tek ad) |
|---|---|---|
| Kiralanan yer | Mülk, Daire, ilan, konaklama | **Daire** |
| Airbnb/Booking yazışması | Mesajlar, konuşma, Gelen kutusu, sohbet | **Mesajlar** |
| QR ile gelen yazışma | Misafir Sohbetleri, Misafir Chat (QR), QR concierge | **QR Sohbetleri** |
| Otomatik cevap | Oto-yanıt, Otomatik yanıt, "AI misafir mesajlarını yanıtlasın", "yapay zekânın beklemesi" | **Otomatik yanıt** |
| Cevap | yanıt, cevap ("Oto-yanıt" ile "Cevaplandı" aynı ekranda) | **yanıt / Yanıtlandı** |
| Ürünün zekâsı | AI, yapay zekâ, asistan, bot, robot | **yapay zekâ** |
| Varış ve ayrılış | Check-in, Giriş, Check-out, checkout, Çıkış | **Giriş / Çıkış** |
| Hospitable kodu | bağlantı anahtarı, token, Personal Access Token, access token | **bağlantı anahtarı** |
| Ödeme bölümü | Faturalandırma, Aboneliğiniz, plan, Abonelik | **Abonelik** |
| Müşteri | ev sahibi, host, profesyonel, Müşteri | **ev sahibi** |
| Güvenli giriş | 2FA, iki adımlı giriş, iki adımlı doğrulama | **iki adımlı giriş** |
| Sayfa adları | "Hazırlık" / "Hazırlık & Alışveriş"; "Gönderilenler" / "Otomatik Gönderilenler" | Menü ve başlıkta aynı ad |
| Şablon | Hazır mesaj metni ve formdaki hazır örnek çipleri (iki ayrı anlam) | Çipler için **"Hazır örnek"** |
| Hitap | "kurulumun 3/6 tamam" (sen) ile "misafirlerinize" (siz) | Her yerde **siz** |
| Düğme kipi | Giriş Yap, Hesap Oluştur, Başla, Ücretsiz Dene, Bağla, Kaydet, Girişe dön | **-in kipi**, yalnızca ilk harf büyük |

**Saat ve tarih biçimi de bu listeye girer:**
- Daire formlarında ve yapay zekâ ayarlarında saatler "03:00 PM / 11:00 AM".
- Yeni görevde tarih "mm/dd/yyyy, --:-- --".
- Türk kullanıcı 15:00 ve gün.ay.yıl bekler. Yanlış saat doğrudan misafire yanlış bilgi olarak gider.

### 3.2 Teknik, çeviri kokan ya da makine ağzı metinler

| Sayfa | Mevcut metin | Önerilen metin |
|---|---|---|
| Giriş | Operasyon panelinize giriş yapın. | Airbnb ve Booking misafir mesajlarınızı yanıtlayan asistan. Hesabınıza giriş yapın. |
| Giriş, Kayıt | Giriş Yap / Hesap Oluştur / Hemen üye olun | Giriş yapın / Hesap oluşturun / Hesap oluşturun |
| Giriş, Kayıt (masaüstü) | Temizlik ve check-in görevleri otomatik akışta | Giriş ve temizlik işlerini kendiliğinden sıraya koyar |
| Giriş, Kayıt (masaüstü) | Kurallara uygun, sağlam, uzun ömürlü operasyon platformu. | Kaldırın ya da: Verileriniz KVKK'ya uygun saklanır. |
| Kayıt | İşletmenizi ekleyin ve operasyonu yönetmeye başlayın. | Evinizi ekleyin, misafir mesajlarını yanıtlamaya başlayın. |
| Kayıt | (dört satırlık yeşil deneme kutusu) | 14 gün ücretsiz deneyin. Kart gerekmez, süre bitince otomatik ücret alınmaz. |
| Şifre | …bir sıfırlama kodu gönderelim, ardından yeni şifrenizi oluşturun. | E-postanıza 8 haneli bir kod göndereceğiz. Kodu girip yeni şifrenizi oluşturun. |
| Şifre: gönderildi | E-postayı tekrar gönder (28) | 28 saniye sonra tekrar gönderebilirsiniz |
| Tanıtım | Lixus AI — API bağlama anlatımı / token'ı yapıştır | Kurulum nasıl yapılır? / Hesap açın → e-postanızı onaylayın → Airbnb / Booking'i bağlayın |
| Tanıtım | Kanban'da takip edersiniz | Görevleri tek listede takip edersiniz |
| Tanıtım | Para/iade tespit edilir; otomatik cevap GÖNDERİLMEZ — taslak + e-posta ile size düşer | Para veya iade istenirse yanıt göndermez; taslağı hazırlar ve size e-postayla haber verir |
| Tanıtım | Koda gömülü kırmızı çizgiler | Hiçbir ayarla değişmeyen yedi kural |
| Tanıtım | Başla (üç plan kartında) | 14 gün ücretsiz deneyin (altına: Kart istenmez) |
| Tanıtım | Günde 150 AI işlemi (otomatik yanıt · öneri · çeviri) | Günde yaklaşık 150 misafir mesajı |
| Tanıtım | Daire başına 60 bilgi kaydı — AI her yanıtta en güncel 30'unu okur | Daire başına 60 bilgi notu |
| Tanıtım | QR concierge / hostlar / (opsiyonel) | QR misafir sohbeti / ev sahipleri / (isteğe bağlı) |
| Pano | insan incelemesi bekleyen / Aynı Gün Devir | Sizi bekleyen konuşma / Aynı gün çıkış ve giriş |
| Pano, Görevler | Check-out Kontrol / Check-in Hazırlık | Çıkış kontrolü / Giriş hazırlığı |
| Gelen kutusu | Oto-yanıt (7/24): Kapalı | Otomatik yanıt: Kapalı — Açın (aç/kapa anahtarı olarak) |
| Konuşma | Sorunlu konuşmada yapay zekâ cevap göndermez (hemen altında "AI cevap öner") | Bu konuşmada yapay zekâ kendiliğinden cevap göndermez; cevabı siz gönderin. İsterseniz öneri alın. |
| Yeni konuşma | Misafir (ad / telefon / e-posta) · Bağlama yok · Manuel | Misafirin adı · Rezervasyon yok · Elle giriş |
| QR sohbetleri (panel) | Ev sahibine iletildi | Yanıtınızı bekliyor |
| QR sohbeti (panel) | Cihaz kilidini sıfırla | Misafirin erişimini yenileyin |
| Girişler | Temizlik yalnız çıkıştan sonraki "bitti" kaydıyla hazır sayılır; bilinmeyen hazır gösterilmez. | Bugün ve önümüzdeki iki günün girişleri. Ev, önceki misafir çıktıktan sonra temizlik tamamlanınca hazır görünür. |
| Girişler | Temizlik açık · atanan: Ayşe Temizlik · başlanmadı — eksik: çıkıştan (11:00) sonra "bitti" kaydı | Temizlik başlamadı — Ayşe'ye atandı. Önceki misafir 11:00'de çıkıyor. |
| Hazırlık | Malzeme profili tanımlı değil … Mülkler → daire → "Malzeme Profili"nden… | Bu hafta 1 girişiniz var. Her giriş için kaç havlu, çarşaf ve malzeme gerektiğini girin; alışveriş listenizi biz hazırlayalım. |
| İptaller | Bir rezervasyon iptal/red/süresi-dolmuş olduğunda burada dairesine göre listelenir. | İptal edilen rezervasyon yok. İptal edilen, reddedilen veya süresi dolan rezervasyonlar burada görünür. |
| Takvim | Rezervasyonlar bağlantınızdan otomatik gelir. / N dolu | Rezervasyonlar Airbnb ve Booking.com hesabınızdan kendiliğinden gelir. / 2 daireden 1'i dolu |
| Daireler | 3 rez. · 2 bilgi · 2/5 hazır · 16:00 → 11:00 | 3 rezervasyon · 2 bilgi notu · Kurulum: 5 adımdan 2'si tamam · Giriş 16:00 · Çıkış 11:00 |
| Daire formları | Temizlik tamponu (dk) | Temizlik süresi (saat olarak seçtirin) |
| Daire ayrıntısı | Kanal Takvimleri (içe aktar) / Takvim Senkronizasyonu (dışa aktar) | Airbnb / Booking takvimini buraya getirin / Bu dairenin takvimini dışarıya verin |
| Daire ayrıntısı | Bir giriş (turnover) başına ortalama tüketim… Boş/0 bıraktığınız kalem sayılmaz. | Her misafir değişiminde ortalama ne kadar malzeme gidiyor? Boş bıraktıklarınız hesaba katılmaz. |
| Şablonlar | Merhaba {{guestName}}, … {{checkInTime}} | Türkçe etiketli rozetler: "Misafir adı", "Giriş saati" |
| Raporlar | AI Risk Görünümü · Düşük güven — onay bekledi · Sayım olay bazlıdır… | Size bırakılan mesajlar · Emin olamadığı için size sorduğu · Riskli mesajları ve şikayetleri AI yanıtlamaz, size bırakır. |
| Gönderilenler | Gönderim kuyruğu durumu | Bekleyen mesajlar (ya da kaldırın) |
| Bağlantılar | Hospitable Personal Access Token | Bağlantı anahtarı (ipucu: Anahtarı buraya yapıştırın) |
| Bağlantılar | API erişimi içeren (ücretli) bir planda olması gerekir | Hospitable'ın ücretsiz planı bağlantıya izin vermiyor; ücretli plana geçin. |
| Genel ayarlar | Saat dilimi (IANA) · Africa/Abidjan… | Saat dilimi · İstanbul (GMT+3) |
| Genel ayarlar | iCal… KVKK veri minimizasyonu… blok-tarih için ad gerekmez (KAPALI) | Takviminizi Airbnb, Booking veya Google Takvim ile paylaştığınızda misafirin adı görünmez, yalnızca dolu tarihler görünür. |
| Abonelik | Ödeme, satıcı olarak Paddle üzerinden güvenli şekilde alınır; fatura ve KDV Paddle tarafından düzenlenir. | Ödemenizi, ödeme ortağımız Paddle güvenle alır. Faturanızı da Paddle keser ve e-postanıza gönderir. İstediğiniz zaman iptal edebilirsiniz. |
| Yapay zekâ ayarları | güvenlik kapısından geçen… / Mesaj çözümlemesi kusursuz değildir, varsayılan KAPALI | Güvenli bulunan cevaplar kendiliğinden gider, gerisi size kalır. / Mesajı her zaman doğru anlamayabilir, o yüzden kapalı gelir. |
| Yapay zekâ ayarları | Oto-yanıt Aktif Saat Aralığı (00:00–00:00) | Yapay zekâ hangi saatlerde yanıtlasın: "Tüm gün" / "Belirli saatler" |
| Hesap | 2FA · Verilerimi indir (JSON) · Şifreyi değiştir (e-postaya kod gönder) | İki adımlı giriş · Verilerimi indir · Şifrenizi değiştirin |
| Temizlikçi | Temizlik, bakım ve check-in görevlerini yönetin. · 0/4 | Bugün size verilen işleri burada görün ve tamamlayın. · 4 adımdan 0'ı tamam |
| Güvenlik (yasal) | YALNIZCA, HEDEFLERdir, DURUN | Küçük harf, gerekiyorsa kalın |

**Düzeltmeye bile gerek olmayan, silinmesi gerekenler:**
- Yapay zekâ ayarlarındaki deneme çiplerinde "Ignore previous instructio…" ve "bu ne rezalet yer aptallar". İç test kalıntısı gibi duruyor.
- Yapay zekâ ayarlarında aynı notun üç kez yazılması.
- Görevler, Gönderim kuyruğu ve Misafir ekranı önizlemesinde aynı bilginin üç kez verilmesi.
- Bilgi tabanı satırlarında "Wi-Fi — Wi-Fi", "Otopark — Otopark" tekrarı.

**Varsayılan şablonlarda ben/biz karışık:**
- Aynı şablonda "buradayım" ile "Keyifli günler dileriz" yan yana.
- "gürültü yapmayınız", "yasaktır" gibi tabela dili var.
- Hepsi birinci tekil kişiye çekilmeli ("dilerim", "rica ederim", "size yazacağım").

### 3.3 Ne yapılacağını söylemeyen hata mesajları

| Sayfa | Mevcut | Önerilen |
|---|---|---|
| Giriş | E-posta veya şifre hatalı | E-posta veya şifre hatalı. Tekrar deneyin ya da **şifrenizi sıfırlayın** (bağlantı kutunun içinde). |
| Kayıt | (hiçbir mesaj çıkmıyor) | Alanın altında: "Geçerli bir e-posta girin", "Şifre en az 8 karakter olmalı", "İşletme adını yazın", "Devam etmek için koşulları kabul edin" |
| E-posta doğrulama | Bağlantıda doğrulama anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun. | Bu bağlantı eksik ya da bozuk. E-postadaki düğmeye yeniden dokunun ya da yeni bir bağlantı isteyin. (düğme: Yeni bağlantı gönderin) |
| Uyarı adresi doğrulama | Bağlantıda onay anahtarı yok… (düğme yok) | Bu bağlantı eksik görünüyor. E-postadaki onay butonuna yeniden dokunun ya da yeni bir onay e-postası isteyin. (iki düğme) |
| Şifre: gönderildi | Doğrulama kodunu o bağlantının açtığı sayfada gireceksiniz — kodu bu ekrana yazamazsınız | E-postadaki bağlantıyı açın ve yeni şifrenizi oluşturun. (başlık: E-postanızı kontrol edin) |
| Panelde bulunamadı | 404 · Bu kayıt bulunamadı | Bu konuşmayı bulamadık. Silinmiş olabilir ya da bağlantı artık geçerli değil. (düğme: Mesajlara dön) |
| Genel 404 | …taşınmış veya hiç var olmamış olabilir · Ana sayfaya dön | Bu adres yanlış ya da sayfa kaldırılmış olabilir. · Ana sayfaya dönün (+ Giriş yapın / Panele gidin) |
| Daire ayrıntısı | Bu mesaj boş — gönderilmez. (turuncu, altı kez) | Henüz mesaj yazmadınız, misafire bir şey gitmez. (nötr renk, tek satır, yanında "Örnek metni kullanın") |

**Ayrıca:**
- E-posta doğrulama hata kutusunda iki uyarı simgesi yan yana duruyor.
- "E-postadaki" kelimesi "E-" / "postadaki" diye satır sonunda bölünüyor.
- Hata durumunda başlıklar değişmiyor: "Tekrar hoş geldiniz", "Uyarı adresini onaylayın", "Son adım: şifrenizle doğrulayın" kırmızı hatanın üstünde duruyor.

---

## 4. Akış

### 4.1 Çıkmaz sokaklar (ekran sorunu söylüyor, düğme vermiyor)

| Sayfa | Durum | Ne eklenmeli |
|---|---|---|
| Uyarı adresi doğrulama | Dokunulabilir tek öğe yok; logo bile tıklanmıyor | "Onay e-postasını yeniden gönderin" + "Giriş yapın" |
| Hazırlık (boş) | Düğme yerine oklu yol tarifi | "Malzeme adetlerini girin" düğmesi, doğrudan ilgili bölüme |
| Girişler | Üç eksik sayılıyor (temizlik başlamadı, kontrol atanmadı, giriş mesajı kapalı), hiçbirinde eylem yok | "Ayşe'ye hatırlat", "Birini ata", "Giriş bilgisini gönder" |
| Girişler | Sonraki iki gün için ne başlık ne "giriş yok" yazısı | Üç günü her zaman göster |
| Gönderilenler, Gönderim kuyruğu (boş) | "Bağlantıyı kurup açtığınızda…" diyor, düğme yok | "Airbnb / Booking'i bağlayın" ya da "Otomatik yanıtı açın" |
| Gelen kutusu (boş) | "Bağlantıyı kurunca mesajlar buraya akar"; tek düğme "Yeni konuşma" | Birincil: bağlantı düğmesi. Boşken filtre ve aramayı gizle |
| Takvim (boş) | Telefonda yönlendirme yok. Masaüstünde 30 boş kutu, mesaj bile yok | Boş durum mesajı + bağlantı düğmesi |
| Girişler (boş), Görevler (boş) | Neden boş olduğu ve asıl adım (daire/takvim bağlamak) söylenmiyor | Tek cümle + tek düğme |
| Raporlar | "Bağlantı kurulunca dolar" kutusu veri varken de duruyor ve tıklanmıyor | Yalnızca bağlantı yokken göster, içine düğme koy |
| Daireler | "Eksik: Ev kuralları, Çıkış mesajı, Kanal bağlantısı…" düz yazı | Her eksik ilgili ayara götüren bağlantı olsun |
| E-posta doğrulama | "Yeni bağlantı isteyebilirsiniz" diyor, düğme yalnızca "Girişe dön" | "Yeni bağlantı gönderin" |
| Hesap silme | "Önce aboneliği iptal edin" uyarısı en altta, bağlantısız; silme düğmesi aktif | Uyarı en üste, "Aboneliği iptal et" düğmesiyle |

### 4.2 Birincil eylemin belirsiz olduğu yerler

- **Soluk, açıklamasız düğmeler** (ürün genelinde aynı kalıp): Kayıt "Hesap Oluştur", abonelikte üç "Bu plana geç", demo formu, "Bağla", QR "Yanıtla", misafir "Gönder", ayarlardaki "Kaydet"ler.
  - Çözüm: Düğme hep basılabilir olsun; eksik varsa basınca eksik gösterilsin.
- **Abonelik:**
  - "Şu anki planınız: Tam erişim (daire sınırı yok)" yazıyor; altında 2, 7 ve 25 daire sınırlı ücretli planlar duruyor. Bunun deneme olduğu, kaç gün kaldığı, bitince ne olacağı yok.
  - Üç kart birbirinin aynısı, önerilen plan yok.
  - Fark yalnızca daire sayısı mı, KDV dahil mi, yazmıyor.
- **Bağlantılar:**
  - Başlık "Airbnb / Booking Bağlantısı", ama tüm metin Hospitable üzerine. Hospitable'ın ne olduğu ve neden ayrı ücretli hesap gerektiği hiç açıklanmıyor.
  - Adımlardaki adres tıklanmıyor; İngilizce menü yolu iki olasılıklı.
- **Birden fazla "Kaydet":**
  - Daire ayrıntısında dört, yapay zekâ ayarlarında dört, genel ayarlarda üç farklı görünümde.
  - Anahtarların ve mesaj kutularının kendiliğinden kaydedilip kaydedilmediği belli değil.
  - Çözüm: Her şeyi anında kaydedip "Kaydedildi" gösterin ya da tek, sabit "Değişiklikleri kaydedin" çubuğu kullanın.
- **Görev tamamlama:**
  - "Bitti" demek için açılır liste gerekiyor. Altında aynı görünümde ikinci bir liste (atanan kişi) var.
  - Temizlikçi ekranında açılır liste ile "Başladım / Bitti" düğmesi aynı işi yapıyor.
  - Çözüm: Tek büyük düğme (Başlayın → Tamamlayın).
- **Tıklanabilir olduğu anlaşılmayan satırlar:** Pano özet kartları ve liste satırları, daire kartları, QR sohbet kartı, takvimdeki rezervasyon satırları (hiçbir yere götürmüyor), raporlardaki açık şikayet satırı, "Eldeki stok" satırı, bilgi tabanı satırları.
- **İki eşit birincil düğme:** Boş Daireler ("Yeni mülk" ile "İlk mülkü ekle"), boş Görevler ("Yeni görev" ile "Görev ekle"), boş Gelen kutusu (iki "Yeni konuşma").
- **Gelen kutusu:**
  - Ürünün ana özelliği kapalıyken soluk gri bir etiketle geçiştiriliyor.
  - Acil klima şikayeti listede ikinci sırada, küçük bir üçgenle duruyor.
- **Pano:** Kalan kurulum adımları 1, 4, 6 diye numaralı; "3 adım tamam" denirken 1 numara açık.
- **Daire ayrıntısı, QR kartı:** "Dairenin içine asacağınız QR" diyor; kartta QR görseli, indirme ya da yazdırma yok.
- **Menü:**
  - 14 madde gruplanmadan tek listede.
  - Mesajlar, Misafir Sohbetleri ve Gönderilenler'in farkı adlardan anlaşılmıyor.
  - Bekleyen iş sayısı yok.
  - Girişler, Takvim ve İptaller neredeyse aynı simgeyi kullanıyor.
  - Temizlikçinin menüsünde yalnızca içinde bulunduğu sayfa var; çıkış menünün içinde değil.
- **Hesap, iki adımlı giriş:**
  - Uzun anahtarı elle yazdırıyor; QR kod ya da tek dokunuşla aktarma yok.
  - Telefon kaybolursa kurtarma kodu ya da destek yolu yok.

### 4.3 Yıkıcı eylemler yanlış yerde

- **Konuşma:** "Sil", geri okuna birkaç piksel uzakta.
- **Daire ayrıntısı:** Kırmızı "Mülkü sil", "Geri"ye bitişik ve sayfanın en üstünde.
- **Görevler:** Çöp kutusu her kartın sağ üstünde, tamamlanmış görevde bile.
- **Bilgi tabanı:** Çöp kutusu aç/kapatın dibinde. Kapı kodu ya da Wi-Fi kaydı silinirse asistan eksik cevap verir.
- **QR sohbeti:** Ev sahibi tek mesaj yazınca yapay zekâ tüm konaklama boyunca susuyor. Bu, küçük ve hata renginde bir paragrafla anlatılıyor; geri açma düğmesi o an ekranda yok.
- **Çözüm:** Silmeyi üç nokta menüsüne alın, onay isteyin, mümkünse "Geri alın" sunun.

### 4.4 Birbirini yalanlayan bilgiler

- **Raporlar:**
  - Şikayet oranı %33 iken skor 91/100 "Mükemmel"; altında "Az veri: 3 konuşma" uyarısı var.
  - "Açık Şikayetler 1" yazarken yan kartta "Şikayet — size bırakıldı 0".
  - Doluluk bir kartta %100 (bu gece), diğerinde %31 (bu ay).
  - Yeşil "+38" rozeti yüzdenin aynısı ve açıklamasız.
- **Daire ayrıntısı:**
  - Bilgi Tabanı kartında 5 kayıt varken altındaki kart "0 bilgi kayıtlı" diyor.
  - Dışa aktarma bağlantısı `http://127.0.0.1:3100/…` gösteriyor. Demo ortamından olabilir; canlıda da böyle çıkıyorsa takvim hiç eşitlenmez. Mutlaka kontrol edin.
- **Konuşma:** Başlıkta "16:00 → 11:00" görünüyor, kart "Bağlı rezervasyon yok" diyor.
- **Pano, 6. adım:** "Deneme süreniz bittiyse önce planınızı seçin" derken kenar çubuğu "Abonelik: Tam erişim" diyor.
- **QR sohbet listesi ve önizleme:** Aynı sohbet masaüstünde 1, telefonda 2 mesaj gösteriyor. Büyük olasılıkla çekim arası veri değişti; önizlemede "son güncelleme" bilgisi yok.
- **Takvim:** Doluluk rozeti masaüstünde "1 dolu", telefonda "1/2 dolu".

### 4.5 Zorunlu alanlar ve formlar

- Yeni görev, yeni daire ve yeni konuşmada hangi alanın zorunlu olduğu belli değil.
- Yeni görevde "Durum: Tamamlandı" seçilebiliyor.
- Daire önceden seçili geliyor (yanlış eve görev açma riski).
- "Atanmadı" seçiliyken kimseye bildirim gitmeyeceği söylenmiyor.
- Yeni konuşma formu, düğmeye basınca misafire mesaj gidip gitmeyeceğini söylemiyor.

---

## 5. Misafirin gördüğü ekran (QR sohbeti)

Düzen temiz, yazma alanı başparmağa yakın, taşma yok. Yine de ürünün en zayıf yeri burası: kapıda bekleyen misafire ekran hiçbir şey söylemiyor.

### 5.1 En ağır sorun: sessizlik

- Misafir "Merhaba, Wi-Fi şifresi nedir?" yazıyor. Altında "gönderildi" işareti, "yazıyor…" göstergesi, cevap ya da hata yok.
- Ekran görüntülerinde misafir aynı soruyu 04:08 ve 04:10'da iki kez, sonra 04:12'de bir kez daha yazmış. Geri bildirim olmayınca insanlar tam olarak bunu yapar.
- Cevap gecikse ya da hiç gelmese bile ekran şunları göstermeli:
  1. Balonun altında "Gönderildi".
  2. "Yazıyor…" göstergesi.
  3. Bir süre sonra ev sahibinin ağzından: "Mesajınızı aldım, en kısa sürede buradan yanıt vereceğim."
  4. Gönderim başarısızsa: "Gönderilemedi. Tekrar deneyin."

### 5.2 Kim konuşuyor, hangi ev?

- Başlık yalnızca "Lixus AI Misafir Asistanı" / "Lixus AI Guest Assistant". Evin ya da ev sahibinin adı hiçbir yerde yok. Misafir Lixus'u tanımaz.
- Metinler ev sahibinin ağzından değil. Üstte "işletme ekibi", altta "Otomatik asistan + ev sahibi", engel ekranında "bize yazın": aynı ekranda üç ayrı anlatıcı.
- Telefonda karşılama mesajı kayboluyor. Masaüstünde "Merhaba! 👋 …" kartı var, telefonda yok.
- "Wi-Fi şifresi", "Çıkış saati", "Otopark" gibi dokunulabilir hazır sorular yok.

| Mevcut metin | Önerilen metin |
|---|---|
| Lixus AI Misafir Asistanı | [Ev adı] · [ev sahibi adı] (altta küçük: Lixus AI ile çalışır) |
| Yanıtlar yapay zekâ tarafından hazırlanabilir. Gerektiğinde işletme ekibi görüşmeye katılabilir. | Sorularınızı önce yapay zekâ asistanım yanıtlar; gerektiğinde ben de yazarım. |
| Otomatik asistan + ev sahibi. | (kaldırın) |
| Kapı kodu gibi giriş bilgileri güvenlik için burada paylaşılmaz. | Kapı kodunu güvenlik nedeniyle buradan paylaşmıyorum; rezervasyon yaptığınız uygulamadaki mesajlarda bulabilirsiniz. |
| Our team can join the conversation when needed | My AI assistant answers first. I step in whenever needed. |
| …the door code are not shared here | For security, I send the door code only through your Airbnb / Booking.com messages. |
| Şu an aktif bir konaklama görünmüyor | Sohbet şu an kapalı. Sizinle konaklamanız boyunca buradan yazışıyorum. |
| (başka cihaz) …uygulamanın mesaj bölümünden bize yazın | Bu sohbet başka bir telefonda açık. O telefondan devam edin ya da bana Airbnb mesajlarından yazın. |

### 5.3 Dil

- Türkçe açılışta her şey Türkçe; dil seçici yok. Yabancı misafir kapı kodu uyarısını okuyamaz.
- İngilizce açılışta misafir Türkçe yazsa da arayüz İngilizce kalıyor.
- Üç engel ekranı (geçersiz QR, başka cihaz, konaklama dışı) yalnızca Türkçe.
- Çözüm: Arayüz telefonun diline göre açılsın, misafirin ilk mesajının diline uysun, başlığın sağında küçük bir dil seçici olsun.

### 5.4 Üç çıkmaz ekran

- **Geçersiz ya da kapatılmış QR:**
  - Dokunulabilir öğe sayısı 0.
  - Başlık "şu anda kullanılamıyor" (geçici), alt satır "artık geçerli değil" (kalıcı) diyor.
- **Sohbet başka cihazda açık:**
  - Tek tıklanabilir öğe "Gizlilik".
  - Aynı evdeki ikinci kişi ya da telefon değiştiren misafir yardımsız kalıyor.
  - Altta hâlâ "kapı kodu burada paylaşılmaz" yazıyor.
- **Konaklama dışı:**
  - Dokunulabilir öğe sayısı 0.
  - Girişten önce de çıkıştan sonra da aynı mesaj; "Giriş gününüzde karekodu tekrar okutun" çıkış yapmış misafire anlamsız.
  - Beyaz çerçeveli kutu düğme gibi duruyor ama tıklanmıyor.
- **Üçüne de eklenmeli:** Ev adı, "Yeniden deneyin" düğmesi, ev sahibine ulaşma yolu (rezervasyon uygulaması adıyla: Airbnb, Booking.com) ve en az İngilizce karşılık.

### 5.5 Okunabilirlik

- Saat etiketleri, kapı kodu notu ve "Gizlilik / Privacy" bağlantısı 12 px altı ve soluk. Sayfanın en önemli uyarısı en zor okunan yazı.
- "Gönder / Send" düğmesi gri-mavi zeminde beyaz yazıyla soluk. Cevap gelmeyen ekranda "bozuk" izlenimini güçlendiriyor.

### 5.6 Ev sahibinin aynı sohbeti gördüğü taraf

- **Wi-Fi çelişkisi (en ağır):** Misafir Wi-Fi şifresi soruyor. Yanıt kutusunun altındaki uyarı ev sahibine "Wi-Fi şifresini bu kanala yazmayın" diyor. Ev sahibi çıkmazda.
  - Çözüm: Tek dokunuşluk hazır yanıt ("Şifreyi Airbnb mesajından gönderdim, oradan bakabilirsiniz").
- **Rozet:** "Ev sahibine iletildi" yazıyor. Okuyan zaten ev sahibi; "Yanıtınızı bekliyor" olmalı. Neden yapay zekânın cevaplamadığı ve misafirin ne kadardır beklediği görünmüyor.
- **"Misafirin gördüğü ekran" önizlemesi:** Yazı kutusu ve gönder düğmesi çizilmemiş. Ev sahibine not ile misafire görünen metin aynı gri yazıyla karışıyor.
- **Tanıtım sayfasındaki örnek yanıt** da aynı kuralı çiğniyor: "I'll confirm with the host."

---

## 6. Önce bunlar (etkisi en yüksek 15 düzeltme)

1. **Misafir sohbeti (tüm durumlar):** Mesajın altına "Gönderildi" ve "yazıyor…" koyun; cevap gecikirse ev sahibinin ağzından "Mesajınızı aldım, en kısa sürede yanıt vereceğim" gösterin.
2. **Konuşma ayrıntısı:** Telefonda cevap kutusunu ve "Gönder"i ekranın altına sabitleyin; klavye açıkken de görünsün.
3. **Kayıt:** Düğmeyi hep basılabilir bırakın; basınca her hatalı alanın altına kırmızı kısa mesaj yazın ve onay kutusunu vurgulayın.
4. **Ayarlar: Abonelik (dolu ve yeni hesap):** "Tam erişim" yerine denemenin bitiş tarihini ve sonrasını yazın; plan düğmelerini etkin yapın, uygun planı öne çıkarın, "KDV dahil" ve "fark yalnızca daire sayısı" bilgisini ekleyin.
5. **Yasal sayfalar (Gizlilik, Koşullar, Mesafeli satış, Ön bilgilendirme, Güvenlik):** [e-posta servisi] yerine @lixusai.com adresi kullanın, "MERSİS" etiketini doğru adla değiştirin, "Kasım 2026" tarihini gerçek gün-ay-yıl yapın, "avukat incelemesinde" notunu kaldırın, cayma hakkını tek net cümleyle yazın.
6. **Misafir sohbeti (başlık ve engel ekranları):** Başlığa ev ve ev sahibi adını koyun, metinleri birinci ağızdan yazın, arayüzü telefonun diline göre açın, üç çıkmaz ekrana düğme ve İngilizce karşılık ekleyin.
7. **Ayarlar: Bağlantılar:** En üste Hospitable'ın ne olduğunu ve neden gerektiğini tek cümleyle yazın; her yerde "bağlantı anahtarı" deyin; kutuyu ve "Bağla"yı sayfanın üstüne alın, tıklanabilir bağlantı verin.
8. **QR sohbeti (panelden yanıt ve liste):** Wi-Fi sorusuna tek dokunuşluk hazır yanıt ekleyin; "Ev sahibine iletildi"yi "Yanıtınızı bekliyor" yapın, bekleme süresini gösterin.
9. **Girişler:** Her eksik satırının yanına tek dokunuşluk eylem koyun ("Ayşe'ye hatırlat", "Birini ata", "Giriş bilgisini gönder"); üç günü her zaman gösterin.
10. **Daire ayrıntısı ve Raporlar:** 127.0.0.1 bağlantısının canlıda üretilmediğini doğrulayın; "0 bilgi kayıtlı" ve şikayet/doluluk çelişkilerini giderin; veri azken "Mükemmel" skoru göstermeyin.
11. **Tüm panel (telefon):** Her düğme, çip, kutu ve simgeyi en az 44 px yapın; çıkışı üst çubuktan alıp menünün en altına yazılı olarak taşıyın.
12. **Konuşma, Daire ayrıntısı, Görevler, Bilgi tabanı:** Sil düğmelerini geri okundan ve aç/kapattan ayırıp menüye alın; onay ve "Geri alın" ekleyin.
13. **Çıkmaz ekranlar (Uyarı adresi doğrulama, Hazırlık, Gönderilenler, boş Gelen kutusu/Takvim/Girişler/Görevler, E-posta doğrulama) ve menü:** Her birine tek bir sonraki adım düğmesi koyun; telefondaki menüde Ayarlar ve Raporlar görünür olsun.
14. **Tanıtım sayfası (telefon):** İki önizlemeyi telefona sığacak hale getirin, "API" ve "token"ı silin, üst çubuğu opak ve alçak yapın, fiyatı ilk ekrana tek satırla ekleyin, "Başla"yı "14 gün ücretsiz deneyin" yapın, şikayet örneğini netleştirin.
15. **Tüm ürün (tek sözlük ve biçim):** Daire, Mesajlar, Otomatik yanıt, yapay zekâ, Giriş/Çıkış adlarını sabitleyin; düğmeleri "-in" kipine çekin; saatleri 24 saat, tarihi gün.ay.yıl gösterin; demo hesabını @lixusai.com'a taşıyın.

---

## 7. İyi olanlar (dokunmayın)

- **Yana taşma yok:** 61 sayfanın hiçbirinde içerik yana taşmıyor; tek sütunlu telefon düzeni sağlam.
- **Giriş ve şifre sıfırlama:** Sade, tek ekrana sığıyor, ana düğme belirgin.
- **Tanıtımın ilk ekranı:** Başlık, alt metin ve iki düğme ürünü net anlatıyor; "Kredi kartı gerekmez" doğru yerde. Kurucu hikâyesi güven veriyor.
- **Fiyat ve SSS:** Fiyat rakamları net, KDV notu var, SSS doğru kaygılara değiniyor.
- **Kayıttaki deneme koşulları:** Açık yazılmış; yalnızca kısaltılmalı.
- **Gelen kutusu listesi:** Kimden, hangi daireden, ne durumda olduğu bir bakışta görülüyor.
- **Konuşma ayrıntısı (masaüstü):** Düzenli. "Sorunlu konuşmada yapay zekâ cevap göndermez" kuralı ürünün en değerli sözü.
- **Pano (masaüstü):** Derli toplu. Yeni hesapta kurulum listesinin en üstte olması doğru.
- **Takvim:** Masaüstünde aylık ızgara, telefonda gün listesi doğru tercih.
- **Yapay zekâ ayarları:** En üstteki dört anahtarlı "Otomasyon durumu" kartı net. Sayfanın geri kalanı bu sadeliğe çekilmeli.
- **Temizlikçi ekranı:** "Başladım" ve "Bitti" düğmeleri anlaşılır.
- **Boş Bilgi Tabanı ve boş Daireler:** Ne eksik ve sonraki adım ne, belli.
- **Misafir sohbetinin iskeleti:** Yazma alanı altta, düzen sade. Geçersiz QR ekranındaki "bize yazın" tonu doğru yönde.
- **Kapı kodu kuralı:** Kapı kodunu QR sohbetinde paylaşmamak doğru; yalnızca nereden alınacağı söylenmeli.
- **Dürüst metinler:**
  - Hesap silme bölümü neyin silineceğini açıkça söylüyor.
  - Entegrasyonlar sayfası ücretli Hospitable planı gerektiğini saklamıyor.
  - Güvenlik sayfası araştırmacı için net.
- **404 sayfası ve yasal sayfaların tipografisi:** Sade, okunaklı, başlıklar düzenli.