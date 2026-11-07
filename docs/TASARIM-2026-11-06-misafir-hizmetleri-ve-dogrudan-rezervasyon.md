# YOL PLANI — Misafir hizmetleri, ev sahibi kazancı ve doğrudan rezervasyon (2. sürüm, 11-06 gece; kod YOK)

> **Kurucu 11-06 gece (1):** "Her zaman müşteriler sormak zorunda değil; öyle bir özellik olduğunu bilince kullanabilsin … web'in içinde ayrı
> bir akış gibi bir sistem koymak mantıklı olabilir, bunu planlayalım, çok niş ve güzel bir iş olur." · "Airbnb ve Booking kabul
> etmeyebilir … komple ayrı ama bağlantılı bir akış sistemi mi kursak … bu mesajları Airbnb'den sürekli yazmak tehlikeli olabilir." ·
> "İlerde S-3 gibi bir sistem olabilir … bol bol reklam verdiğimiz ve komisyonu en minimum tutarak … en az uğraşla en çok iş."
> **Kurucu 11-06 gece (2) — DÜZELTME:** "Sende çok büyük bir hata var … müşteri geldikten sonra host illa ödemeyi Airbnb'den almak zorunda
> değil; bu ayrı bir hizmet, Airbnb mesajları dışında ilerleyecek, hostların kazanç sağlamasına yönelik bir sisteme daha benzer olacak.
> Diğer rezervasyon sitesi için yeni domain almalıyım … yol planını çıkar, uzun uzun düşün, Haiku'dan öneriler al."
> **Bağlı belge:** `docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md` (belge → yetki; §16 iş fırsatı; §18 Faz 1a).
> **Bağlayıcı:** misafire giden her metin EV SAHİBİNİN AĞZINDAN (ben / biz) · SORMADAN SİSTEM KURULMAZ · müşteriye giden metin önce / sonra
> örnekli onaya tabi · para / e-posta akışı kurucuyla birlikte ilk denemeler.

## 0. Düzeltme — ne yanlıştı, ne değişti
- **Yanlış (1. sürüm):** Airbnb misafirine "İsterseniz Airbnb mesajlarından bize yazın, rezervasyonunuza ekleyelim" — hizmeti yeniden
  Airbnb'nin içine (mesaj + ödeme) taşıyordu. Hem kurucunun istediği "Airbnb mesajlarının dışında" akışa ters, hem de Airbnb'nin ek ödeme
  yolunun ek hizmetler için tasarlanmadığı (aşağıda) gözden kaçmıştı. "Platform dışı ödeme açıkça yasak" cümlem de fazla kesindi.
- **Doğru çerçeve (kurucu):** misafir geldikten sonra satılan transfer / tur / kahvaltı / geç çıkış gibi hizmet, konaklamadan AYRI bir
  hizmettir; teklif Lixus'un kendi sayfasında (dairedeki QR), talep ve ödeme ev sahibiyle doğrudan; Airbnb / Booking mesajlarına hiçbir şey
  yazılmaz. Lixus para tutmaz (kurucu S-2).
- **Doğrudan rezervasyon:** yeni alan adında ayrı tüketici markası (kurucu satın alacak); yalnız platform DIŞINDAN gelen misafir için.

## 1. Kural durumu (Haiku araştırması 11-06 gece; iki platformun sayfaları bu ortamdan açılmadı → ikincil kaynak, avukat + yazılı teyit P0'da)
| Konu | Airbnb | Booking.com | Güven |
|---|---|---|---|
| Platform dışı ödeme kuralının kapsamı | "Airbnb rezervasyonlarıyla ilgili ücretler" platform dışında alınamaz (açık izin yoksa). Rezervasyona bağlı OLMAYAN ayrı hizmet (transfer, tur) bu kuralın içinde mi — sayfalar netleştirmiyor (gri) | Tesiste ödenen ekstraları zaten tanıyor (ekstra ücretin "online / tesiste" alanı var); misafire tesiste hizmet satmayı yasaklayan kural bulunamadı | Orta / düşük |
| Platformun ek ödeme yolu | Çözüm Merkezi "para iste" yalnız belirli durumlar için; ek hizmet tahsilatına uygun değil (ikincil) | — | Düşük |
| Mesajlaşma | Rezervasyonu / ödemeyi dışarı taşıyan bağlantı ve iletişim bilgisi süzülür (1. sürüm araştırması, yüksek) | Bütün iletişim platformda; onaysız bağlantı süzülür | Yüksek |
| Gelecek rezervasyonu dışarı çekme | Açıkça yasak (rehber / ev içi materyal dahil) | Yasak (doğrudan pazarlama, komisyondan kaçınma) | Yüksek |
| Misafir iletişim bilgisi (m.4169) | 20 Kasım 2026 ve sonrası rezervasyonlarda misafirden telefon / e-posta / adres istemek sınırlanıyor | — | Orta |
| Dairedeki QR | Özel kural bulunamadı | Özel kural bulunamadı | Düşük |
| Tur satışı (Türkiye) | Yalnız TÜRSAB belgeli acenta; C grubu yalnız Türk vatandaşlarına yurt içi; acenta ürünü acenta dışı e-ticarette yalnız tanıtılır + acentaya yönlendirilir (yönetmelik m.17/3) | Aynı | Orta / yüksek |

→ Kurucunun okuması makul ve tasarım riski düşürecek biçimde kurulur: teklif yalnız Lixus'un kendi sayfasında, hizmet konaklamadan ayrı,
ödeme ev sahibine, platform mesajında iz yok, misafirden iletişim bilgisi alınmaz, "bir dahaki sefere bizden" hiçbir yerde yok.

## 2. Bir bakışta — üç katman
1. **Misafir hizmetleri (QR sayfası, "Konaklamanız boyunca"):** misafir sormadan görür, talep eder; ev sahibi onaylar; ödeme teslimde /
   IBAN / ev sahibinin kendi ödeme bağlantısı. Asistan, soru gelince aynı hizmeti ev sahibinin ağzından önerir — yalnız QR'da.
2. **Ev sahibi kazanç paneli:** hazır hizmet şablonları, talepler, takvim, kazanç özeti, iş fırsatı kartı (misafirlerin sorduğu konular +
   eşleşmiş belgelerin açtığı hizmetler).
3. **Doğrudan rezervasyon sitesi (yeni alan adı):** reklam / Google / sosyal medyadan gelen misafir için; yalnız izin numarası Bakanlık'tan
   doğrulanmış daireler; talep → ev sahibi onayı → ödeme ev sahibinde; komisyon %0 (önerim).

## 3. Katman 1 — Misafir hizmetleri (QR sayfası)
### 3.1 Misafir ne görür
- Sohbetin üstünde "Konaklamanız boyunca" bölümü: **en çok 3 kart**, konaklama gününe göre seçilir (varış günü: transfer, erken giriş ·
  ortası: tur, ekstra temizlik · son gün: geç çıkış, havalimanı transferi). "Tümünü gör" → kategoriler: Ulaşım · Deneyim · Yeme-içme ·
  Konfor. Ücretsiz istekler (fazladan havlu) ücretli hizmetlerden ayrı. [Haiku H1]
- Kart: ad, bir cümle açıklama, fiyat, son talep süresi, ödeme yolu. Örnekler (ev sahibinin ağzından, onaya tabi):
  - "Havalimanı transferi — 1.200 TL. Sizi havalimanından alıp daireye getiriyoruz. Ödemesi teslimde, nakit ya da kart."
  - "Geç çıkış (14:00'e kadar) — 500 TL. Temizlik takvimine bakıp onaylıyoruz."
  - "Kahvaltı sepeti — 450 TL. Bir gün önceden talep edin; sabah 09:00'da kapınızda."
- Misafirden e-posta / telefon İSTENMEZ: talep konaklama oturumuna (QR'daki cihaz bağı) bağlıdır, durum aynı sayfada görünür.
### 3.2 Talep akışı
1. Misafir hizmeti seçer → tarih / saat, adet, isteğe bağlı not (uçuş numarası gibi; misafir metni süzgeçlerinden geçer) → "Talep gönder".
2. Ev sahibine bildirim (panel + e-posta; WhatsApp ileride) → onaylar / reddeder (onay modu hizmet başına; ilk sürümde hepsi ev sahibi onaylı).
3. Misafir QR sayfasında durumu görür: "Onaylandı · 14 Kasım 10:30 · ödemesi teslimde".
4. Teslim → ev sahibi "teslim edildi / ödendi" işaretler (yalnız kayıt; para Lixus'tan geçmez). İptal ve gelmedi işaretleri.
### 3.3 Asistan
- Soru gelince (yalnız QR): "Havalimanından taksiyle yaklaşık 45 dakika sürüyor. İsterseniz transfer hizmetimiz var: 1.200 TL — aşağıdan
  talep edebilirsiniz." Fiyat ve ad KODLA hizmet kaydından gelir (model fiyat uydurmaz).
- Kendiliğinden öneri yok (rahatsız etmesin); sayfadaki 3 kart yeter. (D-6)
- Airbnb / Booking mesajlarında hizmet önerisi YOK — kanal ayrımı kodda (QR ↔ kanal), pinli olacak.

## 4. Katman 2 — Ev sahibi kazanç paneli
- **Hazır şablonlar** (tek dokunuşla aç): havalimanı transferi, erken giriş, geç çıkış, kahvaltı, ekstra temizlik; sonra çamaşır, bebek
  yatağı / mama sandalyesi, bisiklet, market alışverişi, tur (belge kapılı). Ölçülen veri: kısa dönem kiralamada siparişlerin büyük
  kısmı erken giriş / geç çıkış (Touch Stay mağaza verisi %38; otel verisinde erken giriş gelirin %58'i — ikincil, satıcı kaynaklı). Önerilen
  fiyat yalnız ev sahibinin kendi verisinden ya da "bilinmiyor" (V2 para etkisi kuralı gibi, uydurma rakam yok).
- **Hizmet ayarı:** fiyat + para birimi, kapasite (gün / saat), son talep süresi, onay modu, hangi daireler / günler, ödeme yolları
  (teslimde nakit / kart · IBAN · ödeme bağlantısı — yalnız https, izinli alan adları).
- **Talepler + takvim**, teslimden önce hatırlatma, gelmedi / iptal.
- **Kazanç özeti:** ay ve hizmet başına adet + "ödendi" işaretli tutar + ödenmemiş tutar (beyan; para işlemi yok).
- **Fatura hatırlatıcısı** (bilgi kutusu, vergi tavsiyesi değil): satış başına "fatura kestim" işareti + dışa aktarım (ev sahibinin e-arşiv
  yazılımına). GİB'in kısa dönem kiralamayı ticari faaliyet sayan özelgesi (12.01.2026, ikincil) → ek hizmet satışının durumu avukat /
  mali müşavir sorusu.
- **İş fırsatı kartı** (belge tasarımı §16.1): "Son 90 günde misafirlerinizden 23'ü havalimanı transferi sordu — transfer hizmeti ekleyin"
  (anlama katmanının konu etiketi sayılır; misafir metni taşınmaz). Belgesi eşleşen ev sahibine: "Acenta belgeniz (A grubu) eşleşti — tur
  hizmeti açabilirsiniz."
- **Tur (belge kapılı):** yalnız "eşleşti" acenta belgesiyle (Faz 1a işareti → Faz 3 yetki kapısı). Satış acentanın kendi kanalında:
  kartın düğmesi acentanın satış sayfasına gider (m.17/3). C grubu: misafirin vatandaşlığı bilinmediği için QR'da gösterilmez (avukat).

## 5. Katman 3 — Doğrudan rezervasyon sitesi (yeni alan adı)
### 5.1 Kime, ne
- **Kime:** yalnız platform dışından gelen misafir — reklam, Google, sosyal medya, ev sahibinin kendi çevresi. Airbnb / Booking misafirine
  hiçbir yerde gösterilmez (QR sayfası dahil).
- **Ne:** ayrı marka. Her daire için Lixus'taki veriden otomatik sayfa (fotoğraf, açıklama, kurallar, bölge, müsaitlik, fiyat) + şehir /
  semt sayfaları (arama motoru). Ev sahibi site kurmaz ("en az uğraş"). [Haiku H3]
- **Hukuki statü:** birden çok ev sahibinin ilanını gösteren site büyük olasılıkla "aracı hizmet sağlayıcı" (7464 + 2634 m.33 / 7565 +
  Genelge 2026/4): izin / belge numarası OLMAYAN daire tanıtılamaz bile ("rezervasyona kapalı" ilan da ihlal); numara Bakanlık doğrulama
  API'siyle ilk günden; Bakanlık uyarısında otonom kaldırma (kurucu S-7); aylık bildirim yükümlülüğü (adres, kiracı bilgisi, izin no —
  ikincil, avukat). Cezalar ilan / konut başına yüksek → kapılar kodda, şüphede yayın yok.
### 5.2 Rezervasyon akışı (en az uğraş)
- **Rezervasyon talebi:** misafir tarih + kişi + iletişim (burada alınabilir: platform misafiri değil, kendi müşterimiz; KVKK aydınlatma;
  pazarlama ancak açık rıza + İYS) → ev sahibi onaylar → ödeme ev sahibinin kendi yöntemiyle (IBAN / ödeme bağlantısı) → takvim Lixus'ta
  kilitlenir; iCal dışa aktarımı Airbnb / Booking takvimini kapatır (çift rezervasyon koruması — mevcut müsaitlik motoru).
- **Sonra (P5):** ödeme altyapısı yalnız avukat + ödeme kuruluşu sözleşmesiyle (pazar yeri / alt üye işyeri modeli — iyzico / PayTR;
  Lixus kendisi ödeme kuruluşu olmaz).
### 5.3 Gelir modeli — en az komisyon
- **Önerim: komisyon %0, Pro / Business'a dahil.** Rakip ölçeği (ikincil): Vrbo tek %12 (Ekim 2026), ev sahibi başına site araçları aylık
  ücret + %0–2. "Komisyonsuz doğrudan rezervasyon" reklamın ana cümlesi; ödeme altyapısı gelince yalnız işlem maliyeti kadar ücret.
### 5.4 Reklam — en çok iş
- Lixus markanın reklamını verir (Google / Meta) — yalnız izin numarası doğrulanmış ilanlara. Ev sahibine hazır paylaşım bağlantısı ve kendi
  çevresi için QR. Ölçüm: tıklama → talep → onay; rezervasyon başına reklam maliyeti. Google'ın tatil kiralama akışı ayrıca araştırılır.

## 6. Kırmızı çizgiler (kod kuralı olacak, pinli)
1. Airbnb / Booking mesajına ek hizmet teklifi, fiyat, dış bağlantı, doğrudan rezervasyon daveti YAZILMAZ (asistan dahil).
2. Doğrudan rezervasyon sitesi Airbnb / Booking misafirine hiçbir yerde gösterilmez; "bir dahaki sefere bizden / indirim kodu" yok.
3. QR'da misafirden iletişim bilgisi istenmez; hizmet talebi konaklama oturumuna bağlı.
4. Lixus para tutmaz (P5'e kadar); ödeme kaydı yalnız durum.
5. Tur yalnız eşleşmiş acenta belgesiyle; satış acentanın kendi kanalında.
6. İzin numarası doğrulanmamış daire doğrudan rezervasyon sitesinde yok (tanıtım dahil); Bakanlık uyarısında otonom kaldırma.
7. Pazarlama iletisi yalnız 6563 onayı + İYS kaydıyla; platform misafirinin verisi pazarlamada kullanılmaz.
8. Misafire giden her metin ev sahibinin ağzından; fiyat yalnız kayıttan.

## 7. Veri modeli (taslak — migration ister, onaylı DEĞİL)
- `HostService`: işletme, şablon / tür, ad, açıklama, fiyat, para birimi, kapasite, son talep süresi, onay modu, ödeme yolları, görünür
  daireler / günler, etkin, gereken belge türü (tur).
- `ServiceRequest`: hizmet, konaklama, istenen zaman, adet, not (misafir metni → saklama / maskeleme kapsamına girer), durum (talep ·
  onaylandı · reddedildi · iptal · teslim edildi · gelmedi), ödeme durumu (beyan), tutar (kayıttan kopya), CAS sürümü.
- `ServiceEvent`: yalnız-ekle olay günlüğü.
- Doğrudan rezervasyon (P4): `DirectListing` (daire, yayın durumu, izin no doğrulama durumu + son okuma), `BookingRequest` (misafir iletişimi
  — KVKK, saklama süresi; durum; tarih; kişi; teklif tutarı), aracı bildirim kayıtları.
- Kurallar: misafir metni taşıyan her kolon `anonymizeOldGuestData` + `maskReservationRows` kapsamında; tek yazıcı; kiracı kapsamı pinleri.

## 8. Yol planı (bağımlılık sırasıyla)
| Aşama | İçerik | Bağımlılık | Büyüklük |
|---|---|---|---|
| **P0 — hukuk** (kod yok) | Avukat: (a) varış sonrası ayrı hizmetin ev sahibine ödenmesi (Airbnb "rezervasyonla ilgili ücret" kapsamı, Booking sözleşmesi), (b) QR sayfasında tanıtım, (c) doğrudan sitenin aracı statüsü + aylık bildirim, (d) ev sahibinin hizmet satışında fatura / vergi, (e) acentaya yönlendirme biçimi. İki platformdan yazılı teyit (destek kaydı). | — | Küçük (sizin zamanınız) |
| **P1 — en hızlı kazanç** | 5 şablon (transfer, erken giriş, geç çıkış, kahvaltı, ekstra temizlik) + QR "Konaklamanız boyunca" + talep → onay → durum + e-posta bildirimi + ödeme kaydı (teslimde / IBAN / bağlantı). Asistan yalnız bilgi + kart. Anahtar KAPALI başlar. | P0 (a, b) | Orta |
| **P2 — kazanç paneli** | İş fırsatı kartı (sorulan konular), kazanç özeti, hatırlatma, gelmedi, fatura hatırlatıcısı, kalan şablonlar. | P1 | Küçük–orta |
| **P3 — belgeli tur** | Eşleşmiş acenta belgesiyle tur kartı, acentanın kendi satış sayfasına yönlendirme. | Faz 1a ✓ + Faz 3 yetki kapısı, P0 (e) | Orta |
| **P4 — doğrudan rezervasyon MVP** (yeni alan adı) | Yalnız izin numarası doğrulanmış daireler, otomatik sayfalar, şehir sayfaları, talep → onay → ev sahibinin ödemesi, takvim kilidi, Bakanlık uyarısına otonom kaldırma, aracı bildirimi, temel reklam ölçümü. | Faz 1b (konut izni + Bakanlık API), P0 (c) | Büyük |
| **P5 — ödeme altyapısı** | Pazar yeri / alt üye işyeri modeli (ödeme kuruluşu sözleşmesi). | P4 + avukat | Büyük |
| **P6 — büyüme** | Reklam kampanyaları, Google tatil kiralama akışı, ev sahibi paylaşım araçları. | P4 | Sürekli |

Önerilen ilk adım: **P0 + P1 tasarım ayrıntısı** (ekran taslakları, metinler) — P1 kodu P0'ın (a) ve (b) cevabından sonra.

## 9. Haiku önerileri (4 ajan, 11-06 gece) — alınan / alınmayan
- **Alındı:** ödeme yolu hizmet başına ("teslimde öde" mantığı), en çok 3 öneri konaklama gününe göre, talep → onay → sonra ödeme,
  kategoriler, kartta son talep süresi, zaman aralığı, ücretsiz istekleri ayırma, bildirim sınırı, şablon + kapasite + durum takibi,
  gelmedi, kazanç özeti, fatura hatırlatıcısı, tur için belge kontrolü; doğrudan sitede yalnız izinli ilan + numara rozeti, otomatik
  sayfalar, talep modeli, şehir sayfaları, Bakanlık API'si ilk gün, komisyonsuz / pakete dahil, ilk adım avukat.
- **Alınmadı (gerekçe):** uygulama içi kartla ödeme (Lixus para tutmaz — kurucu S-2; P5'e kadar) · misafir profiline göre hedefleme (veri
  azaltma; ilk sürümde yalnız konaklama günü) · varıştan önce e-postayla geç çıkış teklifi (platform misafirinin e-postası yok, kurala da
  aykırı) · rakiplerin satıcı kaynaklı dönüşüm rakamları (bağımsız doğrulama yok; karar verisi değil).

## 10. Riskler
- Platform kuralı gri (§1) → P0'da avukat + yazılı teyit; tasarım riski düşürecek biçimde (ayrı hizmet, kendi sayfamız, mesajda iz yok).
- Doğrudan site aracı yükümlülükleri ağır (cezalar ilan / konut başına) → izin doğrulaması olmadan P4 açılmaz.
- Ev sahibinin vergi / fatura yükümlülüğü ev sahibine aittir → bilgi kutusu, tavsiye değil.
- Misafiri rahatsız etme → en çok 3 kart, kendiliğinden mesaj yok.

## 11. Kurucuya sorular
- **D-1:** P1'in ilk 5 hizmeti: transfer, erken giriş, geç çıkış, kahvaltı, ekstra temizlik — tamam mı, başka?
- **D-2:** Ödeme yolları ilk sürüm: teslimde nakit / kart + IBAN + ev sahibinin kendi ödeme bağlantısı — üçü de mi?
- **D-3:** İlk sürümde her talep ev sahibi onaylı mı (önerim), yoksa bazıları anında mı (ör. bebek yatağı)?
- **D-4:** Doğrudan rezervasyon markası / alan adı: ad seçiminde yardım ister misiniz (müsaitliğe bakabilirim)?
- **D-5:** Doğrudan rezervasyonda komisyon %0, Pro / Business'a dahil — onay?
- **D-6:** Asistan hizmeti yalnız ilgili soru gelince mi önersin (önerim), yoksa kendiliğinden de mi?
- **D-7:** "Öneriler, plan" — misafire kısa gezi planı da olsun mu (bilgi tabanındaki yerel öneriler + hizmetler), yoksa yalnız hizmetler mi?

## 12. Sürüm geçmişi
- **1. sürüm (11-06 gece):** platform içi yol (Airbnb mesajı / rezervasyona ekleme) önerisi — kurucu düzeltti.
- **2. sürüm (11-06 gece):** ayrı hizmet + ev sahibine ödeme + mesajda iz yok; doğrudan rezervasyon yeni alan adında; yol planı P0–P6;
  Haiku önerileri; kural tablosu güven düzeyiyle.
