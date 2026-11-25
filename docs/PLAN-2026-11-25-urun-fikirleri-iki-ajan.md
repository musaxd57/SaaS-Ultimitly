# Lixus AI — ürün fikirleri ve geliştirme planı (FİKİR-A + FİKİR-B ortak önerisi)

> Bu belge ÖNERİDİR, karar değil. Kod yazılmadı, test koşulmadı, depoda hiçbir dosya değişmedi.
> İki ajan dört tur karşılıklı yazıştı (A: ev sahibinin ve misafirin günü · B: yapılabilirlik, sıra, risk, para).
> **(okuma)** = bugünkü durum kod / belge okunarak yazıldı, çalıştırılarak ölçülmedi. **Emin değiliz** = doğrulanamadı.
> Rakip bilgisi: depodaki araştırma belgelerinden gelenler işaretsiz; **(genel bilgi)** yazanlar bu oturumda kaynağından doğrulanmadı.
> Örneklerde daire adı kurgusal: "Lale". "Köprü" = bugünkü Hospitable bağlantısı; "köprüsüz" = yalnız takvim bağlantısı + QR ile çalışan hesap.

## Özet — önerilen sıra (10 satır)
1. **Önce ön koşul (özellik değil):** Railway açılışı dalga dalga · geçmiş veriden "hangi dert ne sıklıkta" sayımı · işletme başına yapay zekâ maliyeti · demo hesabı ve Airbnb dosyası sayıları.
2. **Açılışı beklemeden yazılabilecek üç küçük iş** (veritabanı değişikliği yok · misafire giden değişmez · yeni anahtar yok): çıkıştan önce açık konu satırı (V2) · "son bakım işi" notu (V3) · temizlikçi gün sırası + ay sayımı (V3).
3. **Açılıştan sonraki ilk 4–6 hafta — köprüsüz de satılabilen ürün (kapı 2'nin satış yüzü):** takvim + QR ile başlama yolu · QR ana sayfası · bitiş tarihli not · yazmadan kurulum · kimlik bildirimi işareti.
4. **V1 hafıza:** bitiş tarihli not · yazmadan kurulum · yorumlardan "bilinen sorunlar" · ilk sabah yoklaması (yalnız ölçümle).
5. **V2 dikkat akışı:** çıkıştan önce açık konu · iş varsa tek satır WhatsApp.
6. **V3 eylem ve görev:** son bakım notu · temizlikçi sırası · usta rehberi · periyodik bakım · toplu duyuru · kademeli ulaşma. **Geniş otonomi adımı (yürütme sırasının 5. adımı):** deneme karnesi.
7. **V4 kanıt:** hasar / unutulan eşya dosyası (yapay zekâ puanı yok; önce dosya). **V5 hazırlık:** kimlik bildirimi işareti · "bu konaklamaya dikkat".
8. **V6–V8 için yeni öneri yok:** yorum akışı ve gelir Airbnb doğrudan bağlantısını, "Lixus'a sor" eylem altyapısını bekliyor.
9. **Ortak görüşümüz:** bugün darboğaz fikir değil, yayımlanmamış iş. Yeni fikirlerin çoğu açılıştan SONRA.
10. **Öne aldıklarımız** köprüsüz hesabı satılır yapanlar: o hesapta "yapay zekâ mesajlarıma cevap versin" vaadi zayıf; parası günlük operasyondan çıkmak zorunda.

### Tek bakışta (numara = faz sırası, ÖNCELİK DEĞİL; öncelik "ne zaman" sütununda)
| # | Öneri | Faz | Ne zaman | Büyüklük | Veritabanı değişikliği | Köprüsüz çalışır mı |
|---|---|---|---|---|---|---|
| 1 | Takvim + QR ile başlama yolu | kapı 2'nin satış yüzü | açılışla birlikte | küçük–orta | yok | evet |
| 2 | QR ana sayfası | kapı 2'nin satış yüzü | açılış sonrası ilk 4–6 hafta | orta | ilk hâli yok; çeviri için küçük | evet |
| 3 | Bitiş tarihli not + QR şeridi | V1 | açılış sonrası ilk | küçük | şerit: yok · nottan cevap: küçük | evet |
| 4 | Yazmadan kurulum | V1 | açılış sonrası ilk 4–6 hafta | orta | yok | evet |
| 5 | Yorumlardan "bilinen sorunlar" | V1 | kredi + avukat sonrası | orta | yok | evet |
| 6 | İlk sabah yoklaması | V1 | köprü açılırsa ölçüm; yoksa Airbnb bağlantısından sonra | küçük–orta | muhtemelen yok | **hayır** |
| 7 | Çıkıştan önce açık konu | V2 | **açılışı beklemeden** | küçük | yok | evet |
| 8 | İş varsa tek satır WhatsApp | V2 → V3 | Meta onayından sonra | küçük–orta | emin değiliz | evet |
| 9 | "Son bakım işi" notu | V3 | **açılışı beklemeden** | küçük | yok | evet |
| 10 | Temizlikçi gün sırası + ay sayımı | V3 | **açılışı beklemeden** | küçük | yok | evet |
| 11 | Usta rehberi | V3 | ekip kişisi kaydı açılınca | orta | küçük | evet |
| 12 | Periyodik bakım + boşluğa yerleştir | V3 | açılış sonrası ilk paket | orta | yeni tablo | evet |
| 13 | Toplu duyuru (kanal) | V3 | kanal + ayrı onay | orta | küçük | hayır (QR karşılığı madde 3'ün şeridi) |
| 14 | Kademeli ulaşma | V3 | WhatsApp tek kişiye çalışınca | orta–büyük | evet | evet |
| 15 | Deneme karnesi | geniş otonomi adımı | taslak ↔ gönderim bağı canlıda | orta | yok (bağ yazılmış) | hayır (taslak kanalda) |
| 16 | Hasar / unutulan eşya dosyası | V4 | temizlikçi WhatsApp adımından sonra | orta | başlangıçta yok | evet |
| 17 | Kimlik bildirimi işareti | V5 | avukat cevabı gelince hemen | küçük | küçük | evet |
| 18 | "Bu konaklamaya dikkat" | V5 | madde 4 + kredi (yeniden ölçüm) sonrası | orta–büyük | yok (madde 4'ün kaydıyla) | kısmen |
| 19 | "Abonelik kendini ödedi" satırı | sonrası | hukuk cevabından sonra | küçük | misafir hizmetleri tablolarıyla | evet |
| 20 | Tavsiye bağlantısı | sonrası | ilk 5 ödeyen müşteriden sonra | orta | evet | evet |

Öncelik sırasıyla dizilmiş hâli ve tam bağımlılık tablosu: `docs/PLAN-2026-11-25-urun-fikirleri-sira-tablosu.md` (aynı klasörde; bu plan faz faz, o tablo yapılış sırasıyla — birlikte okunur).

---

## Ön koşul bandı (özellik değil — tek soru)
- **Açılış dalgaları.** Dalda bekleyen yaklaşık 40 veritabanı değişikliği ve onlarca kapalı anahtar tek günde değil, haftada en çok bir dalgayla açılsın; her dalganın yanında "ev sahibi bu hafta neyi fark edecek" cümlesi ve çıkış ölçütü yazsın. İlk hafta misafire giden HİÇBİR şey değişmesin; ilk görülen şey Panel'in tepesindeki "Sizi bekleyenler" ve Girişler olsun.
- **Geçmiş veriden ihtiyaç sayımı.** Aşağıdaki fikirlerin dayandığı dört derdin gerçek sıklığı, veritabanı açılınca (yedekten sonra, siteden önce) salt-okuma, modelsiz bir sayımla ölçülsün: aynı dairede aynı hafta aynı konuda 3+ soru · açık konuyla biten konaklama · aynı dairede tekrarlanan bakım görevi · aynı gün çıkış + giriş olan gün sayısı. Çıktı yalnız sayı. Sayısı düşük çıkan fikir plandan düşer.
- **Maliyet karnesi.** "Başlangıç planındaki bir işletme bize ayda yaklaşık kaç liraya mal oluyor?" bugün ölçülmüyor (okuma). Fiyat ve fazladan mesaj doğuran her öneri bu sayıya bakarak kararlaştırılsın.
- **Demo hesabı + Airbnb başvuru dosyasının sayıları** (kapı 4–5–6).
- **On köprüsüz deneme bulmak** bir edinim işi (çevreniz + talep listesi); bu olmadan "önce ölçelim" cümleleri boşta kalır.

**Sizin elinizdeki beş dış iş — hangisi neyi açıyor:**
| Dış iş | Kilitlediği maddeler |
|---|---|
| Railway açılışı + taze yedek | ön koşul bandının tamamı; 7, 9, 10 dışındaki her şeyin canlıya çıkması |
| OpenAI kredisi | 5 · 3'ün "nottan cevap" adımı · 18 · 15'in "aynı şeyi söylüyordu" hâli · bekleyen bütün ölçümler |
| Kurucu işletmenin Hospitable aboneliği | kapı 5 (gerçek kullanım kanıtı) · 6'nın ölçümü · 15 |
| Meta (WhatsApp) kurulumu — **bugün başlatılabilir** | 8 · 14 · temizlikçi WhatsApp akışı (köprüsüz paketin en güçlü ayağı) · 16'nın fotoğraf yolu |
| Avukat paketi | 17 · 5 (Airbnb kaynaklı metin) · 2 ve 19'un ücretli kısmı · tanıtım ve yasal metinlerde Hospitable zorunluluğu (1) |

B'nin öncelik sırasıyla dizdiği tam bağımlılık tablosu ayrı dosyada: `docs/PLAN-2026-11-25-urun-fikirleri-sira-tablosu.md` (bu plan faz faz; o tablo öncelik sırasıyla — birlikte okunmalı).

**Böyle yapalım mı?**

---

## Kapı 2'nin satış yüzü — köprüsüz de satılabilen ürün
> V0'ın kalan teknik işleri (eski kolonların okuyucuları, kanal bilgisi yazıcıları, Airbnb deneme ortamını bekleyen giriş) ön koşul bandındaki açılış dalgalarındadır; onlar için yeni öneri getirmiyoruz. Kapı 2 kod olarak 10-09'da tamamlandı; buradaki iki madde onun satışa dönmüş hâli.

### 1 · Takvim + QR ile başlama yolu
- **Bunu şöyle yapıyoruz (okuma):** başlangıç rehberinin ilk adımı takvim bağlantısıyla da tamamlanıyor (10-09), ama kurulum sayfası hâlâ ağırlıkla kanal bağlantısını anlatıyor. Mesaj kutusu yalnız köprüyle doluyor; yeni müşteri aboneliğin üstüne ona da ödemek zorunda.
- **Büyük ürünler:** kanal bağlantısını şart koşuyor; küçük ev sahibi araçlarında takvim bağlantısıyla başlamak yaygın (genel bilgi).
- **Önerimiz:** kayıt → takvim bağlantısı → QR'ı yazdır → ilk misafir sohbeti, birinci yol olarak anlatılsın; kanal kutusu "Airbnb bağlantısı gelince" diye dürüstçe ikinci sırada.
- **ÖRNEK:** 3 daireli bir ev sahibi bugün "Hospitable hesabım yok" deyip çıkar → öneriyle kısa sürede (hedef; ölçülecek) takvimini bağlar, QR'ı daireye koyar, ilk misafir çöp saatini QR'dan sorar.
- **Böyle yapalım mı?** · Kime yarar: yeni müşteri · Bağlı: metin onayınız, yasal metinler (avukat) · Ölçü: QR'ı okutan konaklama oranı, kayıt → ilk QR sohbeti süresi, deneme → ödeme · Risk: bu paket BUGÜNKÜ hâliyle aylık ücreti taşımaz diye düşünüyoruz; onu satılır yapacak üç şey temizlikçi akışının bütünü, kimlik işareti (17) ve QR ana sayfası (2). Fiyat ŞİMDİ değişmesin; on denemenin verisinden sonra ayrı bant konuşulsun.

### 2 · QR ana sayfası (tek ekran kararı: hazır kartlar + duyuru şeridi + "Çıkış yaptık" + erken giriş / geç çıkış isteği)
- **Bunu şöyle yapıyoruz (okuma):** QR sayfası yalnız sohbet; misafir her şeyi yazarak sorar. Misafirin çıkış saati yalnız kendi yazdığı beyan olarak tutuluyor.
- **Büyük ürünler:** dijital konaklama rehberi (Touch Stay vb.) — misafir sormadan görür.
- **Önerimiz:** sayfa açılınca üç-dört kart (çıkış saati, çöp, otopark, Wi-Fi adı), üstte madde 3'ün şeridi, çıkış günü tek düğme "Çıkış yaptık", ve yalnız üründe zaten olan iki istek: erken giriş, geç çıkış (her istekte son cevap saati; süre dolunca misafir net durumu görür). Kart metni sohbet cevabıyla AYNI gizlilik süzgecinden geçer; Wi-Fi şifresi ve kapı kodu karta girmez. İlk hâli çevirisiz çıkabilir; çeviri bilgi başına bir kez yapılıp saklanırsa maliyet konaklama başına sıfır olur (saklamak küçük veritabanı değişikliği ister).
- **ÖRNEK:** bugün misafir "Çöpü nereye bırakacağım?" yazar, cevap bekler → öneriyle kartta görür. Çıkışta düğmeye basar; temizlikçinin satırında "Lale 3 misafiri çıktığını bildirdi" görünür. Bu bir beyandır: "daire boş" denmez, erken giriş kanıtı sayılmaz.
- **Böyle yapalım mı?** · Kime yarar: misafir, ev sahibi, temizlikçi · Bağlı: sohbet kodunun açılması, metin onayınız; erken giriş / geç çıkış isteği sizin karar kartınıza düşer → karar kartının açılmış olması (yazılmış, kapalı; açılışın son dalgası); ücretli hizmet ve "ödendi" kaydı hukuk cevabından SONRA (ücretsiz, sizin onayladığınız istek kartı beklemez; 11-18 kuralınız aynen: fiyatı bildirmek kabul sayılmaz) · Ölçü: okutma oranı, kart sonrası konaklama başına soru sayısı, düğmeye basış → temizliğin başlaması · **Size soru:** "Wi-Fi adı" kartı — "sohbet kodu istenmeyen konaklamada Wi-Fi QR'da verilmez" kuralınız ad için de geçerli mi? · Risk: kart yanlış bilgiyi sormadan gösterir — yalnız onaylı bilgiler; "çıkış yaptık"ın asıl kazancı temizlikçiye bildirim yolu açılınca.

---

## V1 — daire hafızası

### 3 · Bitiş tarihli not + QR duyuru şeridi
- **Bunu şöyle yapıyoruz (okuma):** bilgi kaleminde bitiş tarihi yok; geçici durum ya hiç yazılmıyor (her misafire elle anlatılıyor) ya da yazılıp silinmesi unutuluyor. QR'da duyuru şeridi yok.
- **Büyük ürünler:** bitiş tarihli bilgi görmedik (emin değiliz); Hospitable'ın istek panosunda bir kullanıcı isteği bilgi merkezinin çabuk eskidiğini söylüyor.
- **Önerimiz, iki ayrı adım:** (a) *Şerit:* tek satır + bitiş tarihi yazarsınız; QR sayfasının tepesinde yazdığınız gibi görünür, süresi dolunca kalkar. Model yok, çeviri yok (isterseniz ikinci dili kendiniz yazarsınız), ölçüm gerekmez. (b) *Nottan cevap:* yapay zekâ o konudaki soruyu nottan cevaplar — bilgi kalemine bitiş tarihi alanı (küçük veritabanı değişikliği) + kör ölçüm + kredi ister; daire hafızasındaki kayıt bugün bilerek yapay zekâya gitmiyor.
- **ÖRNEK:** "Asansörümüz Cuma gününe kadar bakımda; 3. kata merdivenle çıkılıyor." Bugün bu cümle iki hafta sonra da bilgi tabanında durur → öneriyle Cuma gecesi kalkar.
- **Böyle yapalım mı?** · Kime yarar: ev sahibi, misafir · Ölçü: not süresince aynı konuda elle yazdığınız cevap sayısı; süresi geçmiş notun misafire gitmesi = 0 · Risk: nota yanlışlıkla kod yazılırsa şerit basılmaz, size söylenir; şeridin başlığı üçüncü şahıs olamaz. **Vaat etmediğimiz:** "su yok" mesajı yine şikâyet olarak size düşer; güvenlik kapısı nota göre gevşetilmez.

### 4 · Yazmadan kurulum: "Bulduklarım" listesi + beş kısa soru
- **Bunu şöyle yapıyoruz (okuma):** bilgi tabanı formdan tek tek dolduruluyor; şablondan öneri canlı; dosyadan taslak çıkaran kod yazılmış ama hiçbir ekrana bağlı değil.
- **Büyük ürünler:** Hospitable bilgi merkezini ilan + mesaj geçmişinden kendisi kuruyor.
- **Önerimiz:** şablonlardan ve otomatik mesaj metinlerinden çıkan bilgiler tek listede, her biri onayla kaydedilsin (model yok). Yanında beş soru: kat · asansör · otopark · bebek yatağı · en çok kişi. Kritik erişim bilgileri (kapı kodu, Wi-Fi) bu soruların DIŞINDA — o karar sizde bekliyor. Beş cevap daire hafızasına sizin kaydınız olarak yazılır, yapay zekâya gitmez, veritabanı değişikliği gerektirmez. Bu beş soruyu açmak da size soru.
- **ÖRNEK:** bugün yeni ev sahibi boş forma bakar → öneriyle "Şablonlarınızdan ve otomatik mesajlarınızdan 9 bilgi buldum, gözden geçirin" görür.
- **Böyle yapalım mı?** · Kime yarar: yeni müşteri · Bağlı: 09-11'de kaldırdığınız iki yüzeyin geri açılması SİZE soru · Ölçü: kayıt → daire başına 5 onaylı bilgi süresi · Risk: düşük; hiçbir bilgi onaysız yapay zekâya gitmez.

### 5 · Kurulum anı: yorumlardan "bilinen sorunlar"
- **Bunu şöyle yapıyoruz (okuma):** yorum için tablo da kaynak da yok; tekrarlayan sorun yalnız Lixus'a geldikten sonraki mesajlardan birikiyor — yeni müşterinin hafızası boş başlıyor.
- **Büyük ürünler:** yorum analizi var ama kanal bağlantısına dayanıyor (genel bilgi).
- **Önerimiz:** tek seferlik: "Son yorumlarınızı yapıştırın." Adlar modele gitmeden maskelenir; konuyu model okur (kelime listesi değil); size aday gösterilir; onayladığınız her biri "bilinen sorun" olarak sizin kaydınız olur. Yorum metni SAKLANMAZ, yorum tablosu açılmaz. Sürekli yorum takibi V6'da kalır.
- **ÖRNEK:** 40 yorum yapıştırılır → "Lale 5: sıcak su (7 yorum), akşam gürültüsü (4 yorum) — bilinen sorun olarak kaydedeyim mi?"
- **Böyle yapalım mı?** · Kime yarar: yeni müşteri (ilk gün değer) · Bağlı: OpenAI kredisi; aydınlatma metnine bir cümle ve Airbnb kaynaklı metin politikası (avukat) · Ölçü: onaylanan aday oranı · Risk: model yanlış konu çıkarır — onaysız hiçbir şey kaydedilmez. Not: yol planı sırasında V6 işi; öne almak sizin kararınız.

### 6 · İlk sabah yoklaması
- **Bunu şöyle yapıyoruz (okuma):** otomatik mesaj üç tür: karşılama, giriş, çıkış.
- **Büyük ürünler:** zamanlanmış mesajlarda "ilk sabah" şablonu yaygın (genel bilgi); cevabı okuyup daire hafızasına çeviren görmedik.
- **Önerimiz:** girişten sonraki sabah tek mesaj (metni siz yazarsınız); cevap sorun içeriyorsa size ve daire hafızasına düşer, "her şey güzel" ise kimse rahatsız edilmez ve yapay zekâ cevap yazmaz. Tek gecelik konaklamada, çıkış sabahında ve "Sorunlu" konuşmada gitmez.
- **ÖRNEK:** "Günaydın! Dairede her şey yolunda mı? Bir eksik olursa buradan yazmanız yeterli." Bugün sıcak suyun azlığını 4 yıldızlı yorumdan öğrenirsiniz → öneriyle konaklama sürerken.
- **Böyle yapalım mı?** · Kime yarar: ev sahibi (puan) · Bağlı: kanal mesajı ister; köprü kapı 5 için zaten yenilenirse kurucu işletmede ölçülür, yoksa Airbnb bağlantısından sonra · Ölçü: daire başına aç / kapa (varsayılan kapalı), 4 hafta, iki sayı — konaklama sürerken öğrenilen sorun oranı ↔ konaklama başına size düşen konu; ikincisi %30'dan fazla artıp birincisi artmıyorsa kapatılır · Risk: şikâyet davet eder; başka dildeki misafire çeviriyle gider (maliyet); Airbnb'nin konaklama içi mesaj kuralı doğrulanmadı (emin değiliz).

---

## V2 — dikkat akışı

### 7 · Çıkıştan önce açık konu satırı *(açılışı beklemeden yazılabilir)*
- **Bunu şöyle yapıyoruz (okuma):** "Dikkat Gerektirenler" cevapsız mesajı, size bırakılan isteği ve tutulmamış sözü ayrı satırlarda gösteriyor; çıkış gününe bağlı tek satır yok.
- **Büyük ürünler:** Guesty "söz takipçisi" sunuyor; çıkışa bağlayan görmedik (emin değiliz).
- **Önerimiz:** çıkışa 24 saat kala o konaklamanın açık konuları TEK satırda birleşsin (yeni satır türü değil, var olan üçünün birleşimi). Yapay zekâ misafire özür ya da telafi yazmaz; yalnız size hatırlatır.
- **ÖRNEK:** "Lale 3 yarın 11:00'de çıkıyor; sıcak su konusu açık." Bugün bunu yorumdan öğrenirsiniz → öneriyle arayıp kapatma şansınız olur.
- **Böyle yapalım mı?** · Kime yarar: ev sahibi · Ölçü: açık konuyla biten konaklama oranı (önce / sonra) · Risk: "cevaplandı ama çözülmedi" ayrımı henüz kodda yok (11-18 tasarımı) — ilk hâli yalnız açık istek + açık söz + "Sorunlu" durumunu okur.

### 8 · İş varsa tek satır WhatsApp
- **Bunu şöyle yapıyoruz (okuma):** bildirim e-posta + panel; sabah özeti için "şimdilik yok" dediniz.
- **Önerimiz:** yalnız hazır olmayan giriş ya da bekleyen karar varsa sabah tek mesaj; sakin günde hiç. Kanal kuralı: acil = e-posta, Meta onayı gelince WhatsApp birincil · bugünün işi = Panel · bilgi = Panel. Yeni e-posta türü yok.
- **ÖRNEK:** "Bugün 2 iş sizi bekliyor: Lale 3'ün temizliği bitti olarak işaretlenmedi (giriş 15:00) · 1 erken giriş isteği."
- **Böyle yapalım mı?** · Bağlı: Meta onayı + ev sahibi WhatsApp kanalının açılması + "günde en çok bir kez" kaydı (veritabanı değişikliği olmadan yapılabilir mi ölçülmeli) · Ölçü: hazır olmayan girişin giriş saatinden önce çözülme oranı · Risk: bildirim yorgunluğu.

---

## V3 — eylem ve görev

### 9 · "Son bakım işi" notu *(açılışı beklemeden yazılabilir)*
- **Bunu şöyle yapıyoruz (okuma):** görev güncellemesinde not ve fotoğraf alanı var; ama aynı dairede sorun yeniden gelince önceki çözüm önünüze gelmiyor.
- **Önerimiz:** bakım görevi kapanırken tek satır istenir (zorunlu değil); tekrarlayan sorun satırında ve konuşma panelinde gösterilir.
- **ÖRNEK:** "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)." "3. kombi arızası" DEMEZ — cihaz kaydı yok.
- **Böyle yapalım mı?** · Ölçü: not taşıyan bakım görevi oranı · Risk: not yazılmazsa boş kalır.

### 10 · Temizlikçi gün sırası + ay sayımı *(açılışı beklemeden yazılabilir)*
- **Bunu şöyle yapıyoruz (okuma):** Girişler her konaklamanın hazırlığını gösteriyor; aynı gün birden çok dönüşte hangi daireden başlanacağını siz planlıyorsunuz. Ay sonu sayımı yok.
- **Büyük ürünler:** Turno işi asıl ve yedek temizlikçiye dağıtıyor; ödemeyi de yapıyor (genel bilgi); Guesty'de günlük görev planlayıcı var.
- **Önerimiz:** önerilen sıra (girişi en erken olan, erken giriş istenen önce) + "Ayşe — 23 temizlik (yalnız 'bitti' işaretlenenler)". Lixus para tutmaz; birim ücret alanı ikinci adım.
- **Böyle yapalım mı?** · Ölçü: "bitti" işaretlenme oranı (temizlikçi WhatsApp akışının da ön ölçüsü) · Risk: "bitti" kaydı güvenilmezse sayım tartışma çıkarır.

### 11 · Usta rehberi
- **Bunu şöyle yapıyoruz (okuma):** usta / servis kaydı yok.
- **Önerimiz:** daire başına tesisatçı / elektrikçi / klimacı kaydı; tek dokunuşla kendi telefonunuzdan hazır WhatsApp metni (adres, sorun, uygun saat). Kendi telefonunuzdan gittiği için Meta onayı gerekmez. Misafir adı ve mesajı metne girmez.
- **ÖRNEK:** bugün arıza gelince rehberde numara ararsınız → öneriyle görevin içinden "Ahmet Usta'ya yaz".
- **Böyle yapalım mı?** · Bağlı: ekip kişisi kaydı (yazılmış, kapalı) · Ölçü: bakım görevinden ustaya yazma oranı. Not: elde tutar, tek başına satın aldırmaz.

### 12 · Periyodik bakım + "boşluğa yerleştir"
- **Bunu şöyle yapıyoruz (okuma):** tekrarlayan görev yok; boş günleri müsaitlik motoru zaten hesaplıyor.
- **Büyük ürünler:** Breezeway'de periyodik bakım görevleri var (genel bilgi).
- **ÖRNEK:** "Kombi bakımının vadesi geldi. Lale 3 önümüzdeki 30 günde yalnız 3 Aralık 11:00–15:00 boş — oraya koyalım mı?" Takvim eksik okunuyorsa bunu açıkça söyler, tahmin etmez.
- **Böyle yapalım mı?** · Bağlı: madde 9 · Ölçü: vadesi geçen bakım sayısı, boşlukta yapılan bakım oranı.

### 13 · Toplu duyuru (kanal)
- **Bunu şöyle yapıyoruz (okuma):** birden çok misafire tek seferde duyuru yolu yok; her konuşmaya ayrı yazılıyor.
- **Önerimiz:** madde 3'teki notu, içerideki ve o gün girecek misafirlere tek onayla, her birinin dilinde göndermek. Yeni bir kendiliğinden mesaj türü olduğu için ayrı onay + ilk gönderimler birlikte.
- **ÖRNEK:** "Merhaba, yarın 10:00–14:00 arasında mahallemizde planlı su kesintisi olacak. Bilginize."
- **Böyle yapalım mı?** · Bağlı: kanal (köprüsüz hesapta yalnız QR şeridi), çeviri (model), Airbnb mesaj kuralları · Ölçü: duyurudan sonra aynı konuda gelen soru sayısı · Risk: yanlış misafire giden duyuru geri alınamaz.

### 14 · Kademeli ulaşma
- **Bunu şöyle yapıyoruz (okuma):** acil bildirim e-posta + panel; "gördüm" onayı ve sıra yok.
- **Önerimiz:** acil bildirim 10 dakikada "gördüm" almazsa ikinci kişiye gider; "bu gece ulaşılamam" seçeneği sırayı değiştirir. Misafire metin gitmez (10-11 kararınız aynen).
- **Böyle yapalım mı?** · Bağlı: WhatsApp önce tek kişiye çalışmalı (e-postayla yapılırsa çalışıyor görünür, gece kimseyi uyandırmaz) · Ölçü: acil bildirimde ilk "gördüm"e kadar geçen süre · Not: asıl anlamı 8–25 daireli, birden çok kişili işletmede.

### 15 · Deneme karnesi (geniş otonomi adımı)
- **Bunu şöyle yapıyoruz (okuma):** otomatik cevap kapalı doğuyor; deneyen kişi 14 gün taslak görüyor.
- **Büyük ürünler:** özerkliği kademeli ve mesaj türü başına açtırıyor.
- **Önerimiz:** denemenin ikinci haftasında tek kart — sistem önerir, siz açarsınız; kendiliğinden açılmaz. Yüzde değil, konu örneği gösterir.
- **ÖRNEK (ilk hâli):** "Wi-Fi, çıkış saati ve otopark sorularında 10 taslağı değiştirmeden gönderdiniz. Bu soruları ben cevaplayayım mı? [Aç] [Sormaya devam et]"
- **Böyle yapalım mı?** · Büyüklük: orta · Bağlı: taslak ↔ gönderilen metin bağı (yazılmış, kapalı; açılışla gelir); kanal kutusu olmayan hesapta ÇALIŞMAZ (taslak yok) · Ölçü: denemede otomatik cevabı açan işletme oranı, deneme → ödeme · Risk: ev sahibi cevabı alışkanlıkla Airbnb uygulamasından yazarsa sayaç boş kalır. İkinci adım — "sizin yazdığınız cevap taslağımla aynı şeyi söylüyordu" — anlam benzerliği ölçümünün açılmasını (kredi) ve eşiğin canlı veriyle ayarlanmasını ister; eşik ölçülmeden o cümle kurulmaz.

---

## V4 — kanıt

### 16 · Hasar / unutulan eşya dosyası
- **Bunu şöyle yapıyoruz (okuma):** "çıkış kontrolü" görev türü ve fotoğraf alanı var; hasar ya da unutulan eşya için akış yok.
- **Büyük ürünler:** Breezeway ve Turno'da fotoğraflı sorun bildirimi var (genel bilgi).
- **Önerimiz:** o türde bir görev + fotoğraflı güncellemeler = konaklamaya bağlı, zaman damgalı dosya. Görsel model yok. Unutulan eşyada size onaylık taslak (çıkıştan sonra gider; QR oturumu kapanmış olur → yalnız kanal kutulu hesapta gönderilebilir).
- **ÖRNEK:** "Merhaba, dairede bir şarj aleti bulduk. Size nasıl ulaştıralım?"
- **Böyle yapalım mı?** · Bağlı: temizlikçinin fotoğrafı gerçekten atması (bugün panelden; temizlikçi panele girmiyor → WhatsApp adımı) · Risk: fotoğraf kişisel veri taşıyabilir (saklama ve silme kuralı). "Talep için son gün" sayacı Airbnb kuralı resmi sayfadan doğrulanmadan YAZILMAZ (emin değiliz).

---

## V5 — hazırlık ve risk

### 17 · Kimlik bildirimi işareti
- **Bunu şöyle yapıyoruz (okuma):** yok.
- **Önerimiz:** Girişler'de bilgi satırı: "Kimlik bildirimi: işaretlenmedi / işaretlediniz". Engelleyen etken değil, bildirim göndermez. Lixus bildirimi kendisi yapmaz, kimlik fotoğrafı toplamaz, "yapıldı" diye iddia etmez. Hatırlatma ve ay dökümü ikinci adım.
- **Böyle yapalım mı?** · Kime yarar: izin belgeli ev sahibi; yabancı rakipte yok — köprüsüz paketin yerel farkı · Bağlı: avukat — yükümlülüğün kısa dönem konuttaki kapsamı ve hatırlatmanın sorumluluk doğurup doğurmadığı (emin değiliz) · Ölçü: işareti kullanan hesap oranı.

### 18 · "Bu konaklamaya dikkat"
- **Bunu şöyle yapıyoruz (okuma):** misafirin açık isteği Girişler'de "açık ihtiyaç" olarak görünüyor; ama yazdıklarından çıkan ihtiyaç dairenin özellikleriyle karşılaştırılmıyor.
- **ÖRNEK:** misafir "Annemle geliyoruz, 74 yaşında, dört büyük bavulumuz var" yazar → size: "Lale 7 (4. kat, asansör yok) — yaşlı yolcu ve ağır bavul. [Görev aç]". Misafire bir şey gitmez.
- **Büyük ürünler:** Guesty'de rezervasyon hazırlık denetimi var; misafirin yazdığını dairenin özelliğiyle karşılaştıran görmedik (emin değiliz). Kurucu talimatınızın 9. maddesi.
- **Böyle yapalım mı?** · Bağlı: madde 4'teki beş soru + ihtiyacı model okuduğu için anlama katmanının yeniden ölçümü (kredi). Kapı kodu / Wi-Fi kararınıza bağlı DEĞİL · Ölçü: satırdan açılan görev oranı.

---

## Sonrası

### 19 · "Abonelik kendini ödedi" satırı
Misafir hizmetleri planınızın (11-06) devamı: onayladığınız hizmetlerin, sizin "ödendi" işaretlediğiniz toplamı — açıkça "beyan" etiketiyle. Hukuk cevabından sonra.

### 20 · Tavsiye bağlantısı
Ödeyen müşteri başka ev sahibini getirirse iki tarafa bir ay. Para akışı olduğu için sizin onayınızla ve ilk denemeler birlikte; ilk 5 ödeyen müşteriden sonra.

**V6 (yorum), V7 (gelir), V8 ("Lixus'a sor"):** yeni öneri yok — nedenleri aşağıda.

---

## Bekleyen kararlarınız (biz açmıyoruz; yalnız bağlı olanları anıyoruz)
"Daire gerçekleri" yönü (kapı kodu, Wi-Fi gibi kritik bilgiler) · misafir notu · 09-11'de kaldırılan iki bilgi yüzeyinin geri açılması · Meta kurulumu · OpenAI kredisi · kurucu işletmenin Hospitable aboneliği.

## Önermediklerimiz ve nedeni
- İçerideki misafire uzatma fırsatı satırı — kısa boşluk satırı zaten var; tutar göstermeme kararınız var.
- Sürekli elle yorum girişi — "ev sahibi siteye girip elle iş yapmasın" yönünüze ters.
- Hospitable'ın yorum olayından yorum almak — Hospitable'a özgü yeni iş yapılmıyor.
- Airbnb ilan sayfasından bilgi çekmek — platform şartı.
- Fotoğrafı yapay zekâyla puanlama — yeni maliyet ve yeni veri işleyen; önce dosya (madde 16).
- Fiyat önerisi / gelir beyni — fiyat verisi yok.
- Misafir profili — kararı sizde bekliyor.
- Sabah özeti e-postası — "şimdilik yok" dediniz; yerine madde 8.
- Köprüsüz hesap için ŞİMDİ ucuz bant — önce on denemenin verisi.
- E-postada "gördüm" ile kademeli ulaşma — sahte güven.
- Akıllı kilit — entegrasyon ve kimlik bilgisi yükü; erken.
- Çözüm başına ücret — devretmeyi cezalandırır, "riskli iş insana kalır" ilkesine ters.
- Kimlik fotoğrafı toplama — kişisel veri yükü ağır.
- Tarayıcı / telefon bildirimi — yeni alt sistem; yalnız Meta onayı açılıştan 4 hafta sonra hâlâ yoksa yedek.
- "Su yok mesajı şikâyet sayılmasın" — güvenlik kapısını gevşetir; ölçümsüz önerilmez.

## AYRIŞMA
Dört turun sonunda **açık ayrışma kalmadı.** Yol boyunca tartışıp uzlaştığımız üç nokta (hangi yöne karar verdiğimizi görün diye):
1. **Yeni özellik mi, açılış mı?** B: "ilk işler yeni kod olmamalı". A: "kurucu fikir istedi". Uzlaşma: açılış ön koşul bandı; açılıştan önce yalnız üç küçük, risksiz iş (7, 9, 10).
2. **Yorumlar.** A: elle içe alma V6'yı öne çeker. B: sıra, Airbnb kaynaklı veri politikası, elle iş. Uzlaşma: madde 5 — tek seferlik, metin saklanmaz, yalnız sizin onayladığınız "bilinen sorun".
3. **Köprüsüz paketi ne satar?** B'nin ilk tahmini: kimlik işareti + temizlikçi sayımı + usta rehberi. A: temizlikçi akışının bütünü + kimlik işareti + QR ana sayfası. Uzlaşma: A'nın üçlüsü; ama en güçlü ayağı Meta onayına bağlı — bugün elimizde olmayan tek dış bağımlılık.

Tek ince fark: **ilk sabah yoklaması (6)**. A onu puanı en doğrudan koruyan fikir sayıyor; B bedelinin (size düşen konu sayısı) ölçülmeden bilinemeyeceğini vurguluyor. İkimiz de aynı ölçüm planında birleştik.

**B şerhi (FİKİR-B; ayrışma değil, plana düştüğüm üç kayıt — B-onay.md'deki düzeltmelerin hepsi işlendi):**
1. **Yığın kuralı.** Açılışta bekleyen iş (yaklaşık 40 veritabanı değişikliği, onlarca kapalı anahtar) bitmeden yeni kapalı anahtar eklenmesin: "açılışı beklemeden" yazılabilecekler yalnız 7, 9, 10'dur. Madde 1'in metinleri ve madde 3'ün şeridi dahil diğer her şey, ilk açılış dalgası (misafire dokunmayanlar) sorunsuz kapandıktan SONRA başlasın. Plan bunu "çoğu açılıştan sonra" diye yumuşak söylüyor; ben kural olarak öneriyorum.
2. **Köprüsüz denemenin "ödeme anı" planda yok.** Madde 15 (deneme karnesi) yalnız kanal kutulu hesapta çalışıyor. Köprüsüz denemede ödemeye geçiren bir karşılığı ayrı öneri olarak yazmadık; en ucuz yol var olan "sizin yerinize" sayacının QR sürümünün deneme bitiş kartında gösterilmesi ("QR'da 18 soruyu cevapladım, 2'si size kaldı"). On köprüsüz deneme ölçülürken bunun eksikliği sonucu aşağı çekebilir — sayı okunurken hatırlansın.
3. **Büyüklükler okuma tahminidir.** 20 maddenin 9'u "orta" ya da üstü; hiçbiri için tasarım belgesi yazılmadı. Sıra ve bağımlılık için `docs/PLAN-2026-11-25-urun-fikirleri-sira-tablosu.md` (öncelik sırasıyla 22 satır + dış iş → kilitlediği sıralar + hangi öneri hangi değişmezi zorluyor).

---

## Ana oturum doğrulaması (11-25)

Kurucu isteği (AYNEN): "bana fikir bulacak geliştirme önerileri bulacak 2 tane fable 5.2 ajanı çalıştır 2'si karşılıklı birbirlerine mesaj atsın
konuşarak önerilerini eklenebilecek özellikleri benim V'lerede bakarak bir plan kursunlar."

Planın "bugün yok / var" dediği 15 iddia ayrı bir doğrulama ajanıyla KODDA arandı (salt okuma); 15'i de doğru çıktı:
bilgi kaleminde bitiş tarihi yok · QR sayfası yalnız sohbet · periyodik görev yok · usta kaydı yok · toplu duyuru yok · kimlik bildirimi
alanı yok · otomatik mesaj üç tür · Dikkat panelinde çıkışa bağlı birleşik satır yok (`departing_unanswered` yalnız cevapsız mesaj) · görev
notu / fotoğrafı var, önceki çözümü gösteren yüzey yok · `checkout_review` türü var · temizlikçi başına sayım ve gün sırası yok · "gördüm" /
kademeli ulaşma yok · misafir yorumu tablosu yok · dosyadan taslak çıkaran kod ekrana bağlı değil · deneme öneri kartı yok.

İki inceltme: (a) madde 4'te dosyadan taslak hattını ekrana bağlamak yalnız çağrı eklemek değil, yeni rota + ekran ister; (b) madde 7 için
var olan `departing_unanswered` satırı ve 24 saatlik pencere yeniden kullanılabilir.

Bu belge ÖNERİDİR; hiçbir madde kurucu onayı olmadan yazılmaz. Büyüklükler okuma tahminidir, tasarım belgesi yazılmamıştır.
