# Sızma testi — tur 1 (2026-11-14 gece)

Kurucu isteği (11-14 gece): "20 dakikada bir uyan, çok derin ve sert sızma testi yap; kötü niyetlilerin girebileceği yolları düşün,
alt ajanlarla öneri al, kontrol ettir, sorun varsa çöz."

Yöntem: dokuz derin ajan, her biri TEK bir saldırı yüzeyinde ve yalnız kod okuyarak çalıştı (A kimliksiz yüzey · B kimlik / oturum ·
C web kancaları · D yetki · E yapay zekâ · F kiracılar arası önbellek · G ayrıştırıcılar · I giden istek / SSRF · J kaynak tüketimi).
Ajanların her bulgusu kodda yeniden okundu; iki bulgu ayrıca bağımsız bir doğrulayıcı ajanla sınandı (V-E1, V-E3). DoS bulguları ÖLÇÜLDÜ.
Düzeltmelerin kendisi bir Haiku incelemesinden geçti (bulguları da kodda doğrulandı). Kural: hata olmayanı hata gibi göstermek, hatayı
kaçırmaktan kötüdür — doğrulanmayan "emin değilim" diye ayrı yazıldı.

## 1. Özet

| Yüzey | P1 | P2 | P3 / not | Sonuç |
|---|---|---|---|---|
| A kimliksiz | — | — | A-1 düzeltildi; A-2, A-3 kurucu sorusu | |
| B kimlik | — | — | B-1 düzeltildi (kalan risk soruda) | |
| C web kancaları | — | — | C-E1 ölçüldü + düzeltildi; C-1, C-E2 soruda | |
| D yetki | — | — | bulgu yok (G1 notu açık işlerde) | |
| E yapay zekâ | — | E-1, E-3 düzeltildi (kurucu onayına) | E-2 soruda; ödeme talimatı kapsamı soruda | |
| F önbellek | — | — | F-1 düzeltildi | kiracıya veri sızan önbellek YOK |
| G ayrıştırıcı | — | G E-1 (ölçüldü: 26 sn) düzeltildi | G-2.1 fotoğraf konumu soruda | |
| I giden istek | — | — | sertleştirme (IPv4-çevrilmiş IPv6) | SSRF / Host zehirleme YOK |
| J DoS | — | J-1 (ölçüldü: 17,6 sn) düzeltildi | J-2 not (bugün çağıran yok) | |

## 2. Düzeltilenler

### A-1 — NUL karakteriyle alarm bastırma (P3, sınıf sistemik)
Kimliksiz `GET /api/calendar/%00…` → PostgreSQL NUL'u reddeder → yakalanmayan hata → her istekte hata raporu; tek ortak "uncaught-request"
uyarı kovası saldırganın sahte hatasıyla doldurularak GERÇEK alarmlar bastırılabiliyordu. Kardeşleri: `leads` / kayıt gövdesinde NUL → "api"
kovası.
- Takvim belirteci biçim denetimi DB'den önce (`[A-Za-z0-9_-]{16,200}`).
- `readJsonCapped`: dize DEĞERİNDEN NUL silinir, ANAHTARDA NUL bozuk gövdedir (silmek iki anahtarı birleştirebilirdi).
- `withAuth`: adreste `%00` / NUL → 404 (deneme hesabı da alarm bastıramaz).
- ⚠️ İlk sürüm NUL'lu gövdeyi 400 ile reddediyordu; tam kapı bunun QR mesajının pinli sözleşmesini ("denetim karakteri sessizce silinir,
  mesaj 400 vermez") bozduğunu gösterdi → silme davranışına çevrildi (`canonicalStr` kuralıyla aynı). İlk sürüm yayınlanmadı.

### B-1 — 2FA kurtarma kodu özeti (P3)
Eski özet tuzsuz tek sha256'ydı: veritabanı dökümü ele geçirilirse ~59 bitlik kod alanı GPU ile BÜTÜN kullanıcılar için aynı anda taranabilirdi.
Yeni kodlar `v2`: scrypt + kullanıcı kimliği tuzu. Eski v1 satırları okumada kabul edilir (kimse kilitlenmez). Kalan risk §4 B-1.

### E-1 — QR'da kod sözcüğü olmadan yazılmış anahtar kutusu kodu (P2, kurucu kuralını sıkılaştırır)
Kurucu kuralı (F02, 10-11): QR'da kapı / anahtar kutusu kodu HİÇBİR biçimde verilmez. "Kod / şifre" sözcüğü geçmeyen doğal cümle
("Anahtar gri kutuda. Kutuyu 4590 ile açabilirsiniz.", "the combination is 4590") bilgi tabanı süzgecinden ve cevap taramasından geçiyordu;
taramada yazıyla ("dört beş dokuz sıfır"), virgülle ("4, 5, 9, 0") ve tuş başlığı emojisiyle yazılmış kod tanınmıyordu; bilgi tabanı muafiyeti
ters çalışıyordu ("PIN: 4590" cevabı, 4590 bilgi tabanında geçtiği için gidiyordu).
Kural: AYNI cümlede erişim adı (anahtar / kilit / kutu / kasa / key / lockbox / combination …) + kod benzeri sayı (fiyat / yıl / daire /
sokak / telefon değil — kilit kalıplarının ölçülmüş korumaları aynen) → o sayı erişim kodudur.

| Örnek | Önce | Sonra |
|---|---|---|
| Bilgi tabanı "Genel": "Anahtar gri kutuda. Kutuyu 4590 ile açabilirsiniz." — QR misafiri "Anahtarı nasıl alırım?" | Kalem QR modeline gider; cevap "Kutuyu 4590 ile açabilirsiniz." misafire gider | Kalem QR modeline gitmez; cevapta kod geçerse yine tutulur (bugünkü kapı kodu davranışı) |
| "Anahtar kaybı 1500 TL." / "Daire 1204, anahtar kutuda." | QR'da kalır | QR'da kalır (aşırı uygulama yok) |

Bilinen sınır (güvenli yön): "Anahtar 1500'de teslim edilir." ve posta kodlu anahtar adresi cümlesi QR'dan düşer.

### E-3 — İade / şikâyet tutulurken tazminat SÖZÜ veren cevap (P2)
Öğe kipinde iade / şikâyet / ödeme öğesi ev sahibinde tutulur, güvenli kısım gider. Model tutulan isteğe gelecek zamanlı bir söz yazarsa kod
onu durdurmuyordu (çıktı vetosu yalnız geçmiş zamanı tutuyor; telafi yasağının kod yedeği açılışta kapalı).

| Misafir | Model cevabı | Önce | Sonra |
|---|---|---|---|
| "Klima iki gün çalışmadı, bir gecenin ücretini geri alabilir miyim? Anahtarı nereye bırakayım?" | "Anahtarı çıkışta kutuya bırakabilirsiniz. Bir gecelik ücreti iade edeceğiz." | GİDER | Tutulur (ev sahibi görür) |
| aynı | "Anahtarı çıkışta kutuya bırakabilirsiniz." | gider | gider (değişmez) |
| aynı | "Bir gecelik indirim yapabiliriz, ister misiniz?" | GİDER | Tutulur (teklif de sözdür) |
| aynı | "We cannot refund the night." | GİDER | Tutulur (iade REDDİ de ev sahibinin kararı) |

Ücretsiz tekrar oynatma (`docs/olcum`, 6.568 kayıtlı cevap): 4 isabet, dördü de zaten gönderilmeyecek kötü cevap (IBAN'lı indirim, devir
cümlesi). Nezaket fiilleri ("özür dileriz", "teşekkür ederiz") ve "gelecek ay" sıfatı söz sayılmaz.

### C-E1 — CSV içe aktarmada geniş başlık (P2, ölçüldü)
Çok geniş başlık satırı sütun eşlemede karesel iş → 15 sn olay döngüsü kilidi. Sütun tavanı 200 (gerçek dışa aktarımlar 20–30 sütun).

### J-1 — Getirme katmanında yazım toleransı (P2, ölçüldü)
Karşılaştırma SAYISI sınırsızdı: ev sahibi bilgi tabanını rastgele sözcüklerle doldurup uzun anlamsız mesaj gönderince tek istek olay
döngüsünü kilitliyordu — 30 kalem 1,6 sn, 300 kalem 17,6 sn (paylaşılan süreçte bütün işletmeler bekler). Sorgu başına 250.000
karşılaştırma bütçesi; maliyet önbellekten bağımsız önceden düşülür (aynı sorgu aynı sonucu verir).
Dürüst kullanım ÖLÇÜLDÜ (`evals/rag-scale/dev.json`, 276 kalem, 1.066 soru, 2.488 çağrı): çağrı başına en çok 10.203 karşılaştırma →
seçim değişmez, misafire giden cevaba etkisi yok. Önce 1.425 ms → sonra 108 ms.

### G E-1 — Kötü niyetli takvim beslemesi (P2, ölçüldü)
Takvim adresini ev sahibi girer; elle senkron dakikada 12, zamanlanmış senkron 2 dakikada bir. 10 MB'lık besleme 26 sn, gerçekçi 9.000
etkinlik 3,7 sn, 60 bin farklı uydurma dilim adı 2,3 sn sürüyordu. Kök neden: ayrıştırıcı TZID'yi büyük harfe çeviriyor
("EUROPE/ISTANBUL"), liste araması harf duyarlı olduğu için her tarih her seferinde yeni `Intl.DateTimeFormat` kuruyordu; sonuç tavanı
okunamayan etkinliği saymıyordu. Düzeltme: biçimlendirici önbelleği, harf duyarsız liste, 20.000 blok tavanı (eksik okuma hüküm vermez),
besleme başına 32 liste dışı dilim adı. Sonra 436 / 364 / 233 ms. Gün sonuçları değişmedi (120 takvim / saat dilimi testi yeşil).

### F-1 — Yeniden işlenen ödeme olayında takip numarası karışması (P3)
Yalnız süper-admin olay günlüğü: A işletmesinin onay numarası senkron geçişinin kalanına ve B işletmesinin ödeme olaylarına yazılıyordu.
Her yeniden işlenen olay artık kendi takip bağlamında.

### Diğer
- Meta (WhatsApp) web kancasında sağlayıcı dizesinden NUL silinir (imzalı NUL teslimatı her denemede 500 olurdu).
- IPv4-çevrilmiş IPv6 (`::ffff:0:a.b.c.d`) gömülü IPv4 olarak çözülür (I ajanı "emin değilim" → zararsız sertleştirme).
- Ürün kaynağında 16 dosyada GERÇEK görünmez / yön denetim karakteri vardı (işlevleri doğru ama incelemede görünmüyordu — "Trojan Source"
  sınıfı); kaçış dizisine çevrildi + pin (`tests/unit/source-invisible-chars.test.ts`).

## 3. Bulgu yok / sağlam bulunanlar (kısa)
- Kiracılar arası: bütün önbellek anahtarları girdinin tamamını ya da işletme kimliğini taşıyor; takip bağlamı istek başına; Next.js önbellek
  API'si ve Prisma uzantısı yok (F).
- SSRF: belirteç taşıyan her istemcinin hedefi sabit ya da operatör ortam değişkeni (https zorunlu); Hospitable `links.next` takip edilmiyor;
  Node köken değişince `Authorization`ı siliyor; iCal korumaları (pinli DNS, yönlendirme yok, onluk / sekizlik IP yazımları) yerinde (I).
- Yönlendirme / Host: `?next=` aynı köken + `/api` reddi; e-posta bağlantıları sabit tabandan; `X-Forwarded-Host` okunmuyor (I).
- Belge içe aktarma sunucuda ayrıştırılmıyor (tarayıcıda) → zip bombası / XXE yüzeyi yok; fotoğraf sunucuda açılmıyor → piksel bombası yok (G).
- Yetki: IDOR / rol yükseltme / toplu alan atama bulunamadı (D).

## 4. Kurucu soruları
- **E-1 / E-3 onayı** (misafire gideni değiştirir — örnekler §2). Onaylamazsanız ikisi de tek commit'le geri alınır.
- **B-1 kalan risk:** eski (v1) kurtarma kodları kullanıcı kodlarını yeniden üretene kadar durur. Seçenek: (a) girişte eski satırları
  kullanıcı tuzuyla scrypt'e "yerinde sarmak" (düz metin gerekmez, kimlik akışına dokunur), (b) Railway açılınca 2FA kullananlara "kurtarma
  kodlarınızı yenileyin" demek, (c) bırakmak. Önerim (a). Ayrıca v2 değişikliği kimlik akışıdır — Railway açılınca bir kurtarma kodu
  girişini birlikte deneyelim.
- **A-2:** QR anahtarı döndürülmediği için QR'ı bir kez görmüş herkes "daire şu an dolu mu" bilgisini okuyabiliyor (kişisel veri yok; boş
  daire penceresi). Bilinen karar ("rotasyon YOK") yeniden değerlendirilsin mi?
- **A-3:** "İlk açan kazanır" kasıtsız da olur — eski misafirin arka planda kalmış sekmesi yeni konaklamayı sahiplenebilir; ev sahibinin QR'dan
  yeni misafire yazdıkları eski misafirin ekranına düşer. PIN açık değilse.
- **C-1:** WhatsApp numara bağlama yanıtı "bu numara başka bir hesapta bağlı mı" sorusunu hâlâ cevaplıyor (başarı 200 / ret 400); kodun
  yorumu tersini söylüyor. Ret de "kod gönderildi" gibi görünsün mü?
- **C-E2:** Bağlama kodu aktarma (sosyal mühendislik: saldırgan kurbanın numarasını yazar, kodu kurbana yollatır). Kod hangi işletmeye ait
  olduğunu söylemiyor; kurban "DUR" ile kapatabilir. Bilinçli tasarım mı?
- **E-2:** QR kapısının sözcük ağları yalnız SON mesaja bakıyor; model önceki (devredilmiş, cevapsız) misafir mesajlarını görüyor. Kanal
  yolunda hepsi taranıyor. QR da öyle olsun mu?
- **Bilgi tabanındaki ödeme talimatı:** ev sahibinin kendi yazdığı "IBAN …" / "girişte nakit" kalemi modele girer; ödeme yöntemi denetimi
  yalnız ödeme öğesi tutulurken koşuyor. Kapsam bilinçli mi?
- **G-2.1:** Yüklenen fotoğrafların konum (GPS) bilgisi silinmeden saklanıyor; görev başka temizlikçiye geçince yeni kişi okuyabilir (KVKK —
  veri en aza indirme). Yüklemede konum bilgisi silinsin mi? (sunucuda görüntü işleme ekler.)

## 5. Kanıt
Kırmızı-önce: her düzeltmede (A-1 3, B-1 4, E-1 7, E-3 18+, C-E1 2, J-1 2, G E-1 6, F-1 1, NUL 1, IPv6 5). Mutasyon 46 / 46 (§6). Tam kapı + derleme: push öncesi.

## 6. Mutasyon sonucu
46 mutant (A-1, B-1, E-1, E-3, C-E1, J-1, G E-1, F-1, NUL, IPv6, görünmez karakter pini) — M0 yeşil, ilk geçişte 42 öldürüldü, dört
mutant YAŞADI ve dördü de eksik pin çıktı (ölü kod değil):
- C11 — iade sözü dedektörünün görünmez karakter temizliği: test karakteri sözcüklerin ARASINA koyuyordu → sözcüğün içine gömülü test eklendi.
- Q7 — geçmiş maskesinde virgüllü kod ("4, 5, 9, 0") testsizdi → eklendi.
- Q8 — tek erişim adı "combination": var olan İngilizce örnekte "key" / "box" da geçiyordu → yalnız "combination" geçen örnek eklendi.
- Q9 — kod sözcüğü OLMADAN aralıklı / yazıyla kod: var olan testler etiketliydi ("Kapı kodu …") → etiketsiz örnek eklendi.
Pinlerden sonra dördü de öldürüldü → 46 / 46.

## 7. Tur 2 (aynı gece) — enjeksiyon · kalan kaynak tüketimi · toplu alan atama
Üç ajan daha (K başka bağlama enjeksiyon · L kalan DoS yüzeyleri · M toplu alan atama / prototip kirletme), aynı kurallarla.

**Bulgu yok (kodda okundu):** K — OTA'nın okuduğu takvim beslemesine satır / etkinlik enjeksiyonu yok (tek yazıcı, RFC 5545 kaçışı doğru),
CSV dışa aktarımı yok (formül enjeksiyonu yüzeyi yok), e-posta konusu tek satıra iniyor, gövde kaçışlı, `dangerouslySetInnerHTML` yalnız
sabit içerikte. M — hiçbir şema bilinmeyen alanı geçirmiyor, derin birleştirme yok, personel yalnız kendi görevinin işaretini değiştirebiliyor.

**Düzeltilenler (kırmızı-önce 13, mutasyon 16 / 16 — dört eksik pin eklendi):**
- K sertleştirme: takvim metin kaçışında NEL / U+2028 / U+2029 de satır sonu.
- M-1 / M-2: kullanıcının tetikleyebildiği 500'ler artık 400 — 10000 yılı tarih (görev, rezervasyon, KB sürüm tarihi), 32 biti taşan otomatik
  mesaj sürümü, içe aktarmada dosya yerine metin. Sahte 500'ler ortak uyarı kovasını doldurup gerçek alarmları bastırabiliyordu (A-1 sınıfı).
- L-7 (doğrulandı): Ayarlar saat dilimini yazıldığı harf biçimiyle saklıyordu ("eUrOpE/iStAnBuL" geçerli); görünüm katmanının biçimlendirici
  önbelleği bu dizeyle anahtarlanıyor ve tavansızdı (kodun yorumu "anahtar asla kullanıcı girdisi değil" diyordu) → her varyant kalıcı bellek.
  Dilim artık kanonik adla saklanır; önbellekler 1.000 tavanlı.
- L-8 (doğrulandı): pasif bilgi tabanı kalemi plan sınırına sayılmıyor (sayısı sınırsız) ve hafıza önyüklemesi her yazımda / zamanlanmış
  geçişte hepsinin METNİNİ okuyordu → metin yalnız etkin + okunabilir kalemler için okunur.

**Doğrulanan ama ürün kararı gerektirenler (kod yok — kurucu sorusu):**
- L-1 (doğrulandı): konuşma sayfası bütün mesajları sınırsız yükler ve 30 sn'de bir yenilenir. Öneri: son 300 mesaj + "Daha eski N mesaj
  gösterilmiyor — tamamını göster" bağlantısı (ev sahibinin ekranı değişir).
- L-8 devamı: pasif kalem sayısına da üst sınır (öneri: daire başına 1.000 kayıt toplam; bugün kimse yakın değil). Ev sahibine görünen yeni sınır.
- L-4: işletme başına depolama / mesaj hacmi kotası yok (deneme hesabı günde GB'larca metin yazabilir). Plan kotası tasarımı ister.
**Doğrulanmadı / ölçülmedi (sonraki tur):** L-2 hesap dökümü eşzamanlı üç istek · L-3 raporlar sayfası mesaj okuması · L-5 elle takvim
senkronunun bağlantı havuzunu tutması · L-6 konuşma tekilleştirme · L-9 tavansız listeler · L-10 vektör ısıtma bütçesi · L-11 elle Hospitable
senkronu ile zamanlanmış geçişin atlanması. M-3 (not): yönetici elle "GuestOps AI" adıyla misafir mesajı yazarsa ekranda "Lixus AI" görünür
(yalnız kendi verisi; giden cevapta zaten reddediliyor).
