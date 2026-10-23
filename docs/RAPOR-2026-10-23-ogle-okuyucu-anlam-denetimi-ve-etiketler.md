# Rapor — okuyucu bağlamı, anlam denetimi okuyucuya, etiketleriniz, yeni kör set (10-23 öğle)

> Önceki rapor: `docs/RAPOR-2026-10-23-sabah-parca-okuyucu-ve-kor-olcum.md`. Tasarım: `docs/TASARIM-2026-10-23-okuyucu-baglami-anlam-denetimi-etiketleme.md`.
> Parça kipi (`AI_ANSWER_PARTS_ENABLED`) **KAPALI** — burada anlatılan her şey ölçüm + geliştirme; misafire bugün giden hiçbir şey değişmedi.

## 1. Ne yaptım

| | önce | şimdi |
|---|---|---|
| okuyucunun gördüğü önceki konuşma | misafirin son 3 mesajı | son **16** mesaj, iki taraflı (ev sahibi / asistan cevapları dahil) |
| bu turun misafir metni | 1.200 karakter | 8.000 karakter |
| istek | arama için genişletilmiş sorgu | misafirin **kendi sözleri** + ihtiyaç türü |
| tarih | yok | **bugün + misafirin giriş / çıkış günü** (Temmuz saati Ekim misafirine verilmesin) |
| anlam denetimi (konu, koşul, olumluluk, yön, değer hangi hizmetin) | kod tutuyordu | okuyucu varken **okuyucu** karar verir; kodun bulgusu ize yazılır |
| kodda kalan | — | alıntı kaynakta var mı · sayı / saat / tutar alıntıda var mı · iki kaynak çelişiyor mu · ihtiyacın konusu biliniyor mu (+ sır, yetki, işlem onayı, tazelik, bütün kapı aynen) |
| alıntı | tek kalemden | genel kural + istisnası iki kalemdeyse ikisinden; çevrilmiş kalem başlığı alıntıyı düşürmez |

"Bilgi yok" / "emin değilim" / okuyucunun tutma sebebi **yalnız sizin panelinizde** görünür; misafire hiçbir koşulda gitmez.

## 2. Ölçümler

**Kanıtlanmış-kötü vakalar (39 vaka, her biri 2 kez okundu):** 23 yanlış taslak (saunanın saati havuza, hafta sonu saati genel saat gibi,
"kabul edilmez" → "kabul ediliyor", kapanış sorusuna açılış saati, uydurma ek bilgi, bakımdaki sauna, yaz saati Ekim'de …) + 16 doğru cevap
(kör sette kodun gereksiz tuttuğu türlerin yeni yazılmış benzerleri).

| | kötü taslak gitti | doğru cevap tutuldu |
|---|---|---|
| eski kod denetimleri | 0 / 23 | **12 / 16** |
| okuyucu | **0 / 46 okuma** | 2 / 32 okuma (aynı vaka, sınırda) |
| yeni düzen (okuyucu + kodda kalanlar) | 0 | okuyucunun 2'si |

**Okuyucu geliştirme seti (35 × 2):** yanlış geçiş 0, gereksiz tutma 0, düşen çağrı 0.

**Sizin etiketleriniz (30 / 35):** net etiketlediğiniz 25 örnekte okuyucu 23'ünde sizinle aynı; sizin "gidebilir" dediğiniz hiçbir
cevabı tutmadı. Ayrışan 2'si aşağıda (§4.1, §4.2). Almanca örneklere Türkçe çeviri ekledim, 3. soruyu yeniden yazdım (aynı sayfa).

**Uçtan uca geliştirme ölçümü (yeni akış, gerçek model, okuyucu açık; `docs/olcum/live-pipeline-2026-10-23-gpt-6-luna-needs-2026-10-23-e1023-new-on-s3.md`):**

| | önceki koşular (v4 → v8) | bu koşu (S3 sonrası) |
|---|---|---|
| cevaplanması gereken ihtiyaç doğru değerle misafire gitti | 26 → 28 → 31 / 38 | **32 / 38** |
| açık kalması gereken ihtiyaç açık kaldı | 8 / 8 | **8 / 8** |
| 🚨 "bilgim yok" / iç kaynak anlatımı misafire | 0 | **0** |
| 🚨 yanlış değer misafire | — | 1 (ölçer hatası — aşağıda) |

Kalan 6'nın nedeni: köpek sorusu (bugün bütün evcil hayvan soruları size kalıyor — §4.4) · "giriş saati + erken giriş" turunda giriş saati
cevabı da erken giriş kararı yüzünden tutuldu (inceleme adayı) · Rusça otopark cevabındaki "-2 этаже" düz sayı okunuyordu (düzeltildi, test
pinli) · "Havuz 22:00'ye kadar açık mı?" tuzağında okuyucu cevabı "yarım" buldu (doğru tutuş; ölçer "cevaplanmalı" bekliyordu) · evcil hayvan +
sigara turu. "Yanlış değer" sayılan tek satır ölçerin kendi okuma hatası (misafire giden metin doğru).

**Yeni kör kabul seti:** ayrı yazar yazdı, ben açmadım: 50 senaryo, 71 ihtiyaç (55 cevaplanmalı / 16 açık kalmalı), 15'i konaklama tarihli.
_(tek kabul koşusu sonrası doldurulacak)_

## 3. Notlarınızdan yaptıklarım ve açıklamalar

Notlarınızın tamamı aynen: `docs/KURUCU-ETIKET-NOTLARI-2026-10-23.md` (30 örnek; misafir mesajı + not + gidecek cevap + sizin üç cevabınız +
notunuz). Kararlarınızla doğrudan uygulananlar (parça kipi kapalı olduğu için bugün misafire giden bir şey değişmedi):

- **"Başta Evet / Hayır desin, günü yazsın"** (s9-genel-ve-istisna, s9-istisna-tek-basina) → parça istemine eklendi: "Misafir evet / hayır
  sorduysa ve bilgi açıkça evet ya da hayır diyorsa cevap 'Evet,' / 'Hayır,' ile başlar; günü / dönemi açıkça yazar." Örnek: "Havuz 22:00'ye
  kadar açık mı?" → "Evet, havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açık."
- **"Giden cevap doğru ama hafta içi sorulmuş olabilir"** (s9-genel-kural-yok) + Codex'in aynı uyarısı → yeni kural: misafir GENEL sordu,
  bilgi tabanı yalnız özel durumu (yalnız hafta sonu, tek sezon) biliyorsa cevap **gider** (koşuluyla), ama ihtiyaç **kapanmaz** — panelinizde
  açık kalır. Önce: "Hafta sonu havuz 23:00'e kadar açık." gider, ihtiyaç "cevaplandı" kapanırdı. Sonra: aynı cümle gider, ihtiyaç açık kalır.
- **Etiket sayfası**: 3. soruyu anlamadığınızı yazmıştınız → "Cevap bir koşulu atlıyor ya da yanlış yansıtıyor mu? (ör. notta 'yalnız hafta
  sonu', 'ücretli', 'şu an kapalı' yazıyor ama cevapta yok)" olarak yeniden yazıldı; Almanca / İngilizce örneklerin altına Türkçesi eklendi.

**Erken giriş akışı (istediğiniz açıklama):** "Erken giriş mümkün mü?" ayrı bir istektir; giriş saati sorusu cevaplansa bile erken giriş
isteği sizde açık kalır. Doğrulanmış erken giriş (anahtarı kapalı) şöyle çalışır: (1) iki model aynı saati okumalı ve mesajda başka konu
olmamalı; (2) daire hazır mı — bu devrin çıkış günü temizlik görevlerinin HEPSİ kapalı ve önceki misafirin çıkışından ≥5 dk sonra bir kayıt;
(3) ücreti yalnız sizin girdiğiniz kayıttan alır, model tutar uydurmaz; (4) sonuç dört durumdan biri: onaylanabilir · bekliyor (kanıt gelebilir,
örn. temizlik bitmedi) · sizin kararınız · erken değil. Otomatik RED yoktur. "Otomatik onay" kuralını siz açarsanız ve her şey uygunsa kodun
yazdığı onay metni gider (6 dil, günü adlandırır); açmazsanız size kontrol listesi gelir. Temizlik bitince bekleyen istek bir kez yeniden
değerlendirilir. Sizin "host onay verirse hemen kabul edilebilsin" isteğiniz "Karar bekliyor" kartıyla var (Host Karar Motoru, anahtar kapalı):
kartta onaylarsanız kodun metni gider.

**Her misafire ayrı kimlik mi, yalnız isim mi? (otopark notunuz):** Ayrı kimlik var. Her rezervasyonun kendi kimliği (sağlayıcının
rezervasyon numarası + bizim kaydımız) ve kendi konuşması var; misafir adı yalnız görüntü için. Bilgi tabanı DAİRE başına tutulur; "12 numaralı
park yeri" bilgisi o dairenin kalemidir, o dairede kalan her misafir aynı bilgiyi alır. İki dairenin kaleminde aynı park numarası varsa bugün
uyarı YOK — notunuzdaki "çakışma taraması" önerisi §4'te.

## 3b. Dilim sonu sert inceleme (Opus) — bulgular ve yapılanlar

Kural gereği dilim bitince ayrı bir model en sert gözle okudu (`3293bf90..bed5846f`, 13 dosya). 12 bulgu; misafire bugün giden hiçbir şeyi
değiştirmiyor (parça kipi ve kalıcı kuyruk anahtarları KAPALI), ama açılmadan önce kapanmaları gerekiyordu:

| # | Önem | Bulgu (sade) | Ne yaptım |
|---|---|---|---|
| B1 | P1 | Okuyucu kipinde "kabul edilmez" ↔ "Evet, kabul edilir" gibi TERS cevabın önünde yalnız okuyucu kalmıştı | Ters olumluluk yeniden KODDA tutuluyor (ölçümde bunun bedeli 0 gereksiz tutma; 4 kötü taslağı tutuyordu) |
| B11 | P1 | B1 düzeltmesi + "Evet / Hayır ile başla" kuralı → doğru "No, the pool closes at 20:00." tutuluyordu | Cevabın başındaki tek "Evet, / Hayır, / No, / Нет, / Non," ünlemi olumluluk okumasına girmiyor (testli; "Yes, pets are allowed" ↔ "kabul edilmez" yine tutuluyor) |
| B2 | P1 | Alıntıya ilgisiz bir kalemin cümlesini ekleyerek ("Otopark ücreti günlük 300 TL") havuz ücreti diye 300 TL geçirilebiliyordu | Konuyu anmayan kalem artık değer kaynağı değil (cümle sırası ters çevrilse de). Tek kaynaklı hâli okuyucuya kalıyor → §4.0 |
| B4 | P1 | "Gider ama açık kalır" parçası kapıda "gönderilmiyor" sanılıyordu: tek soruluk turda hiçbir şey gitmiyor, tehlike kemeri o parçayı okumuyordu | Beyan ikiye ayrıldı: kapatan / gönderilen-açık kalan. Kapı ikisini birlikte okur, kapatma yalnız ilkini |
| B5 | P2 | Kuyruk satırı öğe kapanmadan iptal edilirse öğe kalıcı "cevaplandı" kalabiliyordu | Kapatmadan sonra satır bir kez okunur, gitmediyse öğe yeniden açılır (testli) |
| B6 | P3 | 402 engel ve KVKK silme iptali dalları testsizdi | İki test eklendi |
| B7 | P3 | "Karar bekliyor" e-postası uçuştaki öteki e-postayı "gönderildi" sayıyordu | Uçuştaysa kart damgası geri verilir (testli) |
| B8 | P3 | E-posta talebi alındıktan sonra süreç ölürse o bildirim kaybolur (önceden de böyleydi) | Bilinçli seçim olarak koda yazıldı (çift e-posta yerine kayıp; ihtiyaç panelde açık) — açık iş |
| B9 | P3 | Tekrar kaydına çevrilmiş başlıklı ham alıntı yazılıyordu, yeniden doğrulamada hep düşerdi | Kodun doğruladığı alıntı yazılıyor (testli) |
| B10 | P3 | "Hafta sonu:" gibi koşullu başlığı atmama kuralı Rusça / Fransızca / İspanyolca gün, gece, sezon, "Kapalı / Ücretli / Yasak" başlıklarını tanımıyordu | Çok dilli liste eklendi (19 başlık testli; çevrilmiş konu başlığı hâlâ atılıyor) |
| B3 | P3 | Çok dilli kat: "3º piso", "10 -15 этаже", "5 stock" yanlış okunuyordu | Düzeltildi, testli |
| B12 | P3 | Kodun tuttuğu parçanın anlam bulguları izden düşüyordu; ölçüm kaydı "açık kalan"ı yazmıyordu | İkisi de yazılıyor; dayanak arama maliyeti (en kötü ~60 ms / parça) açık iş |

## 4. Kararınızı bekleyen sorular

Her soruda: bugün ne oluyor · önerim · örnek · "böyle yapalım mı?". Hepsi parça kipinde (kapalı) ya da Railway açılınca çalışacak akışta;
cevabınızı almadan kodda değiştirmedim.

**4.0 — (en önemlisi) Codex S3: anlam kararını okuyucuya bırakmak, sizin "okuyucunun 'evet'i tek başına gönderim izni olmasın" şartınızla
çelişiyor mu?** Açık söylüyorum: kısmen çelişiyor ve bunu size SORMADAN ölçüme dayanarak koda koymuştum (parça kipi kapalı olduğu için
misafire bir şey gitmedi). Şu an:
- Kodda kalan, okuyucunun SERBEST BIRAKAMAYACAĞI denetimler: alıntı bilgi tabanında birebir var mı · cevaptaki saat / sayı / tutar konuyu anan
  kalemde var mı · iki kalem çelişiyor mu · konu biliniyor mu · ters olumluluk (izin ↔ yasak, ücretsiz ↔ ücretli, açık ↔ kapalı) + sır, yetki,
  işlem onayı, bütün kapı.
- Okuyucuya bırakılan: "bu cevap sorulanı mı cevaplıyor, koşulu doğru mu, değer doğru tesise mi ait". Ölçüm: okuyucu kanıtlanmış-kötü 23 taslağın
  hiçbirini geçirmedi (46 okuma); kod 16 doğru cevabın 12'sini gereksiz tutuyordu, okuyucu 1'ini.
- Bu kipte YALNIZ okuyucunun durdurabildiği örnek: misafir "Havuz ücreti ne kadar?", bilgi tabanında havuz ücreti yok, otopark kaleminde
  "Otopark ücreti günlük 300 TL" var; model alıntıyı yalnız otopark cümlesinden yapıp "Havuz kullanımı günlük 300 TL." yazarsa kod "konu
  eşleşmiyor" bulgusunu ize yazar, kararı okuyucu verir (okuyucu bu sınıfı ölçümde hep tuttu).
- Seçenekler: (A) böyle kalsın — okuyucu anlam hakemi, kod yukarıdaki listeyi tutar; (B) eski kural — kod her anlam bulgusunda tutar, okuyucu
  yalnız ek tutar (bedeli: doğru cevapların ~%75'i gereksiz tutulur, ev sahibine düşer); (C) arada — "konu eşleşmiyor" bulgusu da kodda tutsun
  (bedeli: çeviri / çekim yüzünden 16 doğru cevaptan 3'ü daha tutulur).
- Önerim **A** (ölçüm bunu destekliyor); C de makul. Hangisi?

**4.1 — Soru 6: kısmi cevap gidince açık kalan ihtiyaç için size e-posta gitsin mi?**
- Bugün: arıza / şikâyet / ödeme / iptal / insan talebi gibi HASSAS istekler zaten ayrı e-posta alıyor (kısmi gönderimde de). Boşluk hassas
  OLMAYAN açık ihtiyaçta: misafire bir parça gidiyor, öteki ihtiyaç yalnız panelinizde açık, e-posta YOK. Soru 10'daki e-posta yalnız misafire
  HİÇBİR şey gitmeyen sessiz turda çalışıyor.
- Örnek: "Çöpler nereye? Sitede sauna var mı?" (bilgi tabanında sauna yok) → misafire "Çöpleri bina girişindeki konteynere atabilirsiniz." gider;
  sauna sorusu panelde açık, e-posta yok. Aynı durum §3'teki "yalnız hafta sonu bilinen" havuz sorusu için de geçerli.
- Seçenekler: (A) e-posta yok, yalnız panel (bugünkü); (B) mesaj başına TEK "Misafir cevabınızı bekliyor — 1 soru açık" e-postası (Soru 10'un
  kalıcı kaydıyla aynı ihtiyaca ikinci e-posta yok); (C) günde bir özet e-posta ("bugün açık kalan 3 soru").
- Önerim: **B** (büyük platformların "cevaplanmamış misafir sorusu" bildirimine en yakın; tekrar yok, kayıt kalıcı). Böyle yapalım mı?

**4.2 — "Kahvaltı dahil mi?" → yalnız "Dahil değil." yeterli mi, ücret de söylensin mi?**
- Bugün (S3 sonrası): okuyucu "Dahil değil." cevabını "soruyu cevaplıyor" sayar → gider; kaynakta yazan "kişi başı 250 TL" eklenmez
  (sorulmadığı için eksik sayılmıyor). Eski kod denetimi bunu "koşul düştü" diye tutuyordu — artık tutmuyor.
- Seçenekler: (A) "Dahil değil." yeter; (B) kaynakta ilgili ücret yazıyorsa ekle: "Dahil değil; kişi başı 250 TL."
- Önerim: **B** (misafirin bir sonraki sorusu zaten "ne kadar?" olur; tutar yalnız sizin yazdığınız kayıttan gelir, model tutar uydurmaz). Hangisi?

**4.3 — Köpek sorusu bütün mesajı tutmasın: "kural ihlali" etiketi yalnız evcil hayvan isteğini tutsun mu?**
- Bugün: "köpek / evcil hayvan / parti / fazla kişi / sigara" sözcükleri "kural ihlali" etiketi koyar; etiket yalnız "ev kuralları" isteğine
  bağlanabiliyor. Anlama katmanı isteği "evcil hayvan" sayınca etiket bağlanamıyor ve BÜTÜN mesaj tutuluyor.
- Örnek: "Sauna kaçta açılıyor? Küçük köpeğimizi getirebilir miyiz?" → bugün: hiçbir şey gitmez. Önerilen: "Sauna 16:00'da açılıyor." gider,
  köpek sorusu sizde kalır.
- Önerim: etiketin hangi aileden geldiğine bakılsın (köpek / kedi → evcil hayvan isteği; parti / fazla kişi / sigara → bugünkü gibi). Soru 9'daki
  "bu soru tutulursa aynı mesajdaki bağımsız cevaplar da tutulmasın" ilkenizle aynı. Böyle yapalım mı?

**4.4 — Evcil hayvan cevabı (etiket notlarınızdan anladığım kural):** "olumsuz-dogru" örneğine "evet / evet / yok" dediniz ("Evcil hayvan kabul
edilmiyor." doğru), "kosul-dusmus" notunda "ücret geçiyorsa hosta bıraksın … host kabul edilir yazmışsa ve ücret yoksa gidebilir" dediniz.
Anladığım kural: bilgi tabanı açıkça "kabul edilmez" diyorsa ret cevabı gider; "kabul edilir" diyor ve ücret / koşul yoksa kabul cevabı gider;
ücret ya da koşul (10 kg altı, ek ücret) varsa soru size kalır. Bugün bütün evcil hayvan soruları size kalıyor. Böyle yapalım mı?

**4.5 — Bugünkü akışta (Railway açılınca çalışacak) "… için ev sahibinize sorabilirsiniz / danışabilirsiniz" cümlesi**
- Bugün: 100 ölçüm dosyasında yönlendirme cümleli 49 taslağın 48'i zaten tutulmuş; kör sette 2 kez "Plaj servisi siteden kalkıyor; tam kalkış
  noktası için ev sahibinize sorabilirsiniz." gibi cümle misafire gitti ve istek "cevaplandı" kapandı. 09-11 kararı "ev sahibinizle iletişime
  geçebilirsiniz" cümlesini "bilgim yok" saymıyordu.
- Önerim: "X için ev sahibinize sorabilirsiniz / danışabilirsiniz / ev sahibiniz size kesin bilgi verebilir" (bilinmeyen bir konuda yönlendirme)
  "bilgim yok" sayılsın → o cevap gitmez, istek açık kalır. Acil durumda kayıtlı ev sahibi telefonu veren cümle (bilgi tabanından) etkilenmez.
  Böyle yapalım mı?

**4.6 — Cevap modelinin geçmiş penceresi:** okuyucu artık son 16 mesajı iki taraflı görüyor; cevap modeli hâlâ son 25 mesaj + 6.000 karakter.
"Cimrilik yok" gerekçenizle bunu da büyütelim mi (ör. son 40 mesaj / 20.000 karakter)? Müşteriye gideni değiştirebilir → önce ölçüp sonuçla
gelirim. Ölçeyim mi?

**4.7 — Fine-tuning ("fine tunining yapalım kesinlikle"):** Kısa cevabım: şimdilik önermiyorum, sebebi ölçülmüş: okuyucunun yanlış geçişi 0 /
46, ayrıştığı yerler model bilgisizliği değil bilgi tabanının eksik / karışık olması (notlarınızdaki örneklerin çoğu). İnce ayar bunu çözmez,
her model değişiminde yeniden yapılır ve misafir verisinin eğitime girmesi KVKK sorusu açar. Önce §5'teki bilgi tabanı taraması + geçmiş
cevaplardan öğrenme. Siz yine de isterseniz maliyet / veri gereksinimi araştırmasını ayrıca yaparım. Uygun mu?
