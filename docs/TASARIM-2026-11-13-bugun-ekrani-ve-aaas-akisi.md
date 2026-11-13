# TASARIM 2026-11-13 gece — "Bugün" ekranı (onaylı, ilk dilim kodda) · "kontrol bekliyor" için atomik çelişki tasarımı · AaaS akışı (Fable 5.2'ye gidecek paket)

> Kurucu 11-13 gece: "Önerini anladım, çok mantıksız değil ama milyar dolarlık bir şirketin sistemi böyle olmaz; en uzun vadeli çözümü düşün;
> birbiriyle çatışan bu tarz bir durum hemen atomik yakalanabilir, sen daha iyi fikri bul." · 1 "Olabilir, kontrol ederek görerek yap" ·
> 2 "Özet şimdilik istemiyorum, zaten yeterince bildirimle mail atıyoruz" · 3 "Tam anlamadım" · 4 "Bunu da tam anlamadım" · 5 "Bunu da açıkla"
> · 6 "Açıklar mısın, daha güzel" · "Uzun uzun düşün, en iyi akış; Fable 5.2'den sonra yardım alacağım; onay verdiklerimi şimdi yap."
>
> Bu belgenin bölümleri: §1 "Bugün" ekranı (onaylı — ilk dilim kodda) · §2 "kontrol bekliyor" vakasının uzun vadeli çözümü (KOD YOK, karar
> kurucuda) · §3 öneri 3–6'nın sade anlatımı · §4 ev sahibinin bir günü: uzun vadeli akış · §5 Fable 5.2'ye sorular · §6 kayıtlar.
> Derin araştırma ajanının bulguları geldiğinde ayrı bölüm olarak eklenir (kodda doğrulanmış olanlar).

## 1. "Bugün" ekranı (kurucu onayı 11-13: "olabilir, kontrol ederek görerek yap")

### 1.1 Bugün Panel'de ne var (kodda okundu, `src/app/(app)/dashboard/page.tsx`)
Selam başlığı → kurulum rehberi (yalnız kurulum bitene kadar) → **"Dikkat Gerektirenler"** kartı (`AttentionPanel`; 12 tür istisna,
`src/modules/intelligence/incidents/attention.ts`; sakin günde HİÇ basmaz) → dört kutucuk (Acil Görevler · Aynı Gün Devir · Doluluk ·
Sorunlu Konuşmalar) → dört liste kartı (Bugünkü Girişler · Bugünkü Çıkışlar · Bekleyen Mesajlar · Bugünkü Görevler).

### 1.2 Eksik olan iki şey
1. **Bugünkü girişlerin hazır olup olmadığı Panel'de yok.** "Bugünkü Girişler" kartı yalnız ad + saat gösterir; hazırlık (temizlik bitti mi,
   yapılamıyor denmiş mi, aynı gece çakışan konaklama, açık bakım görevi, gönderilemeyen giriş mesajı, açık söz) yalnız Girişler sayfasında.
   Ev sahibinin sabah ilk sorusu "bugün bir şey ters mi?" — cevabı başka sayfada.
2. **Sistemin ev sahibi yerine yaptığı iş hiçbir günlük yüzeyde yok.** Yalnız Raporlar'da 30 günlük toplam var. AaaS hissi tam bu satırdan
   doğar: "ben uyurken ne oldu?".

### 1.3 İlk dilim (kodlandı — §1.6)
- **"Dikkat Gerektirenler" kartı, bugünkü HAZIR OLMAYAN girişleri de taşır.** Satır: "Bugün 15:00 giriş hazır değil" · alt satır
  "Deniz Daire · Temizlik açık · Ayşe · 09:40" (ilk engel; birden çoksa "· 1 eksik daha") · dokununca Girişler. Kaynak Girişler'in KENDİ
  değerlendirmesi (`loadArrivalReadiness` → `evaluateStay`), ikinci kural YOK; yalnız "HAZIR DEĞİL" (engelleyen) satırlar girer —
  "bilinmiyor" ve bilgi satırları Panel'e girmez (her sabah dolup duvar kâğıdına dönerdi; 08-08 kart kaldırma gerekçesi).
- **"Son 24 saatte sizin yerinize" satırı** (kartın altında, küçük, sakin): "6 misafir sorusu cevaplandı · 2 giriş mesajı gönderildi ·
  3 görev açıldı". Yalnız KALICI kayıtlardan sayılır, tahmin yok; sayı 0 olan parça yazılmaz; hepsi 0 ise satır HİÇ basılmaz.
  - "cevaplandı" = YALNIZ kendiliğinden giden cevap (`authorType: "ai"`, eski satırlarda `senderName` sihirli değeri) — ev sahibinin
    onayladığı yapay zekâ taslağı (`aiAssisted`) "sizin yerinize" sayılmaz (ev sahibi gönderdi). Kuyruktan teslim edilmemiş satırlar düşer.
    Sayım Raporlar'ın sayımıyla AYNI yardımcıdan gelir (`aiReplyWhere`, `src/lib/reports.ts`); Raporlar'ın sayısı değişmedi.
  - "giriş / karşılama / çıkış mesajı gönderildi" = rezervasyon damgası son 24 saatte (Raporlar ile aynı kaynak) EKSİ ev sahibinin
    Girişler'den elle gönderdiği giriş mesajları (denetim kaydı `checkin_message.manual_send`).
  - "görev açıldı" = sistemin açtığı görev (`origin: "system"`) son 24 saatte.
- Saat penceresi "son 24 saat" (gece yarısı değil): sabah açıldığında dün geceyi bütünüyle kapsar; kurucu örneği "Gece 7 soruyu cevapladım".
- Bürünmede (destek görünümü) ve personel rolünde: Panel zaten yönetici sayfası (`requireManagerSession`); salt okuma, yazma yok.
- Intelligence bozulsa Panel çalışır: iki yeni okuma da `.catch` ile boş döner.

### 1.4 Bilerek DIŞARIDA (ilk dilim)
- Ayrı "Bugün" sayfası / menü değişikliği (AAS-1'in ikinci yarısı) — kurucu ekranı görünce karar verir.
- Satır içinde tek dokunuş eylem (atama, giriş mesajı) — Girişler'de var; Panel'e taşımak aynı bileşenleri ister, ekran görüldükten sonra.
- Yarınki girişler — yarın sabah ilk satırda zaten çıkar; bugün eklemek her akşam gürültü olabilir (ekran görülünce).
- Temizlikçi ataması sayımı ("3 temizliği atadım"): atamanın sistem mi ev sahibi mi tarafından yapıldığı kalıcı kayıtta AYRILMIYOR →
  sayılırsa makbuzsuz iddia olur. Kayıt gelince eklenir.

### 1.5 Sakin gün kuralı (08-08 kararının şartları, `dashboard/page.tsx` yorumu)
Kart kutucukların göstermediğini söylemeli (hazırlık ve "sizin yerinize" hiçbir kutucukta yok ✓), sakin günde hiç görünmemeli ✓
(engelleyen giriş yoksa ve diğer 12 tür boşsa kart basılmaz; sayaç 0 ise satır basılmaz).

### 1.6 Uygulama notu
Değişen / eklenen: `src/lib/reports.ts` (`aiReplyWhere` ortak yardımcı + `getAutomationDigest`) · `src/lib/today/*` (saf satır kurucu) ·
`src/components/attention-panel.tsx` (hazırlık satırı + sayaç satırı) · `dashboard/page.tsx` (iki okuma, `.catch`). Testler: saf çekirdek,
DB'li sayım (elle gönderim düşer, taslak onayı düşer, teslim edilmemiş kuyruk satırı düşer, Raporlar'ın sayısı aynı), görünüm (sakin günde
basılmaz). Gerçek uygulamada ekran görüntüsü (kurgusal veri) kurucuya.

## 2. "Kontrol bekliyor" vakası — uzun vadeli, atomik çözüm (KOD YOK — misafire gideni değiştirir, kurucu kararı)

### 2.1 Gerçek sorun "işaret" değil, KOPYA
Vaka: bilgi tabanında aynı dairenin iki giriş kaydı vardı (biri kapı kodu 1234, öteki 5678). Göç en yenisini seçti, "kontrol bekliyor" dedi,
gönderici işarete bakmadı. Kök sebep: **aynı olgu (kapı kodu) serbest metin içinde birden çok yerde kopya duruyor.** Bugün de sürüyor:
- giriş mesajı metni (`AutoMessageTemplate.body`) kapı kodunu / Wi-Fi şifresini düz yazı olarak taşır;
- bilgi tabanı kalemleri (`KnowledgeBaseItem`) aynı bilgiyi ayrıca taşır — yapay zekâ ve QR buradan okur;
- daire alanları (giriş / çıkış saati, adres) yapılandırılmış ama kapı kodu / Wi-Fi için alan YOK (`Property` modeli).
Ev sahibi kapı kodunu değiştirip yalnız bir yeri güncellerse **otomatik giriş mesajı 1234, yapay zekâ cevabı 5678 der** — bugün hiçbir şey
bunu yakalamaz. "Kontrol bekliyor" bu sınıfın göçte görünür olan tek örneği.

İkinci ders: **işaret ile kapı ayrı yerdeydi** — işareti göç koydu, kapıyı göndericinin hatırlaması gerekiyordu, hatırlamadı. Bu üründe aynı
sınıfın daha önce çözülmüş örneği var: doldurulmamış yer tutucu (`[AÇIK ADRES]`, `{daire}`) kontrolü göndericide değil METNİ KURAN
fonksiyonda; önizleme, otomatik gönderim ve elle gönderim aynı fonksiyondan geçtiği için hiçbiri unutamaz.

### 2.2 Seçenekler
| | Ne | Atomik mi | Bedel |
|---|---|---|---|
| A | Bugünkü: gider, kartta uyarı | — | yanlış kod misafire gidebilir |
| B | Önceki önerim: işaret kalkana kadar tut + Girişler'de satır | hayır — işaret ve kapı yine ayrı; ev sahibi farkı kendisi bulur | düşük |
| C | **Olgu düzeyinde tek kaynak + metinlerde atıf + yazım anında çelişki denetimi + kapı metni kuran fonksiyonda** | **evet** | orta (yeni tablo + daire sayfası alanları) |
| D | Yapay zekâyla periyodik çelişki taraması (bilgi tabanı içinde "bu iki kalem çelişiyor") | hayır (sonradan) | yanlış pozitif; model maliyeti; C'nin TAMAMLAYICISI |

### 2.3 Önerim: C ("daire gerçekleri")
1. **Tek kaynak.** Kritik olgular dairenin "Daire bilgileri" bölümünde TİPLİ alan olarak bir kez durur: kapı / kasa kodu, Wi-Fi adı, Wi-Fi
   şifresi, giriş saati, çıkış saati, yol tarifi / kat / daire no, otopark. Her olgunun tek değeri, sürümü ve "en son ne zaman doğrulandı"
   tarihi var. (Büyük platformlar aynı yolu kullanır: ilan üzerinde Wi-Fi / giriş yöntemi alanları ve mesajlarda kısa kodlar — dış doğrulama
   araştırma ajanında.)
2. **Metin kopya değil atıf taşır.** Giriş mesajı "Kapı kodumuz {kapı_kodu}" yazar; değer gönderim anında tek kaynaktan gelir. Kopya yoksa iki
   farklı değer de olamaz — çelişki YAPISAL olarak imkânsız (bugünkü `{isim}` / `{daire}` belirteçlerinin aynı mekanizması).
3. **Yazım anında atomik denetim.** Ev sahibi bir metne (giriş mesajı ya da bilgi tabanı kalemi) çıplak bir değer yazarsa ("kapı kodu 1234"),
   KAYIT İSTEĞİNİN İÇİNDE değer bulunur ve tek kaynakla kıyaslanır:
   - aynı → kaydedilir; "bunu {kapı_kodu} olarak bağlayalım mı? Kod değişince mesaj kendiliğinden güncellenir" önerisi (tek dokunuş);
   - farklı → **kaydedilmez**, aynı ekranda sorulur: "Daire bilgilerinde kapı kodu 5678; burada 1234 yazdınız. Hangisi doğru?"
     [1234 — daire bilgisini güncelle] [5678 — metni düzelt]. Veritabanındaki tekil kısıt gibi: çelişkili durum hiçbir an KAYDA geçmez.
     İki sekme aynı anda farklı değer yazarsa olgu satırının sürümü ikincisini reddeder.
4. **Kapı metni kuran fonksiyonda.** Gönderilecek metin, atıf yaptığı olgulardan biri doğrulanmamış / çelişkiliyse KURULAMAZ (bugünkü
   "doldurulmamış alan" ile aynı yerde, aynı sebep listesinde) → önizleme, otomatik gönderim, Girişler'den elle gönderim ve QR aynı kuraldan
   geçer; hiçbir gönderici "bakmayı unutamaz".
5. **Etkileşimsiz kaynaklar tek kaynağı EZMEZ.** Senkron, geçmiş mesajlardan öğrenme, ajan taslağı soru soramaz → farklı bir değer
   bulduklarında yalnız "aday" yazarlar; doğrulanmış değer değişmez, gönderim sürer; ev sahibine öneri: "Airbnb ilanınızda Wi-Fi şifresi
   farklı görünüyor: X. Güncelleyelim mi?". Böylece çelişki için GÖNDERİMİ DURDURAN bir ara durum da hiç doğmaz.
6. **Göç verisi bir kez çözülür.** Bugünkü "kontrol bekliyor" satırları için iki aday metin yan yana gösterilir, FARKLI olan olgular
   işaretlenir (kapı kodu 1234 / 5678). Adaylar yalnız selam / üslupta farklıysa risk yoktur → mesaj bugünkü gibi gider, işaret yalnız bilgi.
   Bir kritik olguda farklıysa o dairenin giriş mesajı, ev sahibi seçene kadar kurulamaz (madde 4) ve bu, çelişki görüldüğü AN (göç anında,
   varıştan günler önce) Panel'in istisna kartında "Daire 3: giriş mesajında kapı kodu iki farklı yazılmış (1234 / 5678). Hangisi doğru?
   [1234] [5678]" olarak çıkar — gönderim saatinde değil.

### 2.4 Misafire giden — önce / sonra
- **Önce:** iki kayıt (eski 1234, yeni 5678) → yeni seçildi → misafire "Kapı kodumuz 5678." gider; 5678 yanlışsa misafir kapıda kalır,
  ev sahibi bunu misafirin şikâyetinden öğrenir.
- **Sonra:** göç anında çelişki görülür → ev sahibi Panel'de tek dokunuşla 1234'ü seçer → daire bilgisi 1234, mesaj metni "{kapı_kodu}"
  → misafire "Kapı kodumuz 1234." gider. Ev sahibi kodu yarın değiştirirse yalnız daire bilgisini değiştirir; mesaj, yapay zekâ ve QR
  aynı anda yeni kodu kullanır. Bilgi tabanına yanlışlıkla eski kodu yazarsa kayıt anında sorulur.
- **Bedel:** ev sahibi seçene kadar o dairenin giriş mesajı gitmez (yalnız kritik olgu çelişkisinde; selam farkında gider). Çözüm tek
  dokunuş ve varıştan önce istenir.

### 2.5 Aşamalama (her adım ayrı onay)
C1 olgu tablosu + daire sayfasında "Daire bilgileri" + giriş mesajında atıf + metin kurucuda kapı + göç satırlarının bir kez çözülmesi
(yeni tablo = migration, taze yedek + onay) → C2 bilgi tabanı kaydında yazım anı denetimi → C3 yapay zekâ ve QR olguları tek kaynaktan okur
(istem değişikliği = ölçüm) → D ikincil süpürge (isteğe bağlı).

### 2.6 Kurucuya sorular
- **AT-1:** C yönü uygun mu (önerim), yoksa yalnız göç satırları için kısa yol (B) yeter mi?
- **AT-2:** Kritik olgu listesi: kapı / kasa kodu, Wi-Fi adı + şifresi, giriş / çıkış saati, yol tarifi / kat / daire no, otopark — eksik /
  fazla?
- **AT-3:** Göçteki "yalnız selam farkı" satırları gitmeye devam etsin mi (önerim), yoksa onlar da seçilene kadar dursun mu?

## 3. Öneri 3–6, sade anlatım (kurucu: "tam anlamadım")

### 3.1 (3) "Hangi işi kim yapar" tablosu
**Bugün:** tek düğme var: "Otomatik yanıt açık / kapalı". Açıkken sistem basit soruları kendisi cevaplar, riskli konuları (şikâyet, para,
güvenlik) size bırakır. Ama hangi işin kendiliğinden yapıldığını tek bir yerde göremezsiniz, iş bazında da ayarlayamazsınız.
**Öneri:** Ayarlar'da tek bir tablo. Her satır bir iş, her satırda üç seçenekten biri:
| İş | Kendim yaparım | Hazırlarım, siz onaylarsınız | Hep size bırakırım |
|---|---|---|---|
| Wi-Fi / giriş saati / yol tarifi sorusu | ● | | |
| Erken giriş / geç çıkış isteği | | ● | |
| Temizlik görevini açmak ve temizlikçiye atamak | ● | | |
| Şikâyet · para / iade · güvenlik | (kilitli) | (kilitli) | ● |
**Günlük örnek:** Saat 02:00'de misafir "Wi-Fi şifresi ne?" yazar → satır "kendim yaparım" → cevap gider; sabah Panel'de "1 soru cevaplandı".
Aynı gece başka misafir "Saat 11'de girebilir miyiz?" yazar → satır "hazırlarım" → sabah "Onaylayın / Düzenleyin" cevabı hazır bekler.
**"Güven rampası"** = sistem kendini yükseltmez, size teklif eder: "Son 30 Wi-Fi cevabımı hiç değiştirmeden onayladınız. Bundan sonra
kendim göndereyim mi? [Evet] [Hayır]". Karar hep sizde.
**Dürüst hüküm:** değerli ama acil değil. 10 dairede asıl kazanç ŞEFFAFLIK (ne kendiliğinden oluyor, tek yerde). Bugünkü kapıların yerine
geçmez; riskli satırlar kilitli kalır.

### 3.2 (4) "Gönderilmeden önce kısa bekleme / geri alma"
**Bugün:** otomatik cevap hazır olunca hemen gider. Siz o an uygulamaya bakıyor olsanız bile araya giremezsiniz.
**Öneri:** otomatik cevap gitmeden önce kısa bir süre (ör. 2 dakika) bekler. O sürede konuşmada "2 dakika içinde gidecek: [Şimdi gönder]
[Durdur]" görünür — Gmail'deki "Geri al" gibi. Gece (siz uyurken) fark yaratmaz; gündüz telefonunuz elinizdeyken kendiniz yazmak isterseniz
yakalarsınız. Aynı fikir sistemin yaptığı küçük işler için de: "Temizliği Ayşe'ye atadım [Geri al]".
**Günlük örnek:** 14:05 misafir "Otopark var mı?" → cevap hazır, 14:07'de gidecek → o an konuşmadasınız → "Durdur" → kendiniz yazarsınız:
"Otoparkımız yok ama hemen karşıda ücretli otopark var."
**Dürüst hüküm:** orta değer. Bedeli misafire cevabın 2 dakika gecikmesi. Güvenli uygulanması gönderim kuyruğuna bağlı (bugün kapalı);
kuyruk açılmadan yapılmaz.

### 3.3 (5) "Kurulum sohbeti"
**Bugün:** yeni bir ev sahibi daireleri, bilgi tabanını (Wi-Fi, giriş, kurallar…) ve otomatik mesajları formlardan tek tek doldurur.
Yeni müşterinin en çok vazgeçtiği yer burası.
**Öneri:** kurulum bir sohbet olur. "Airbnb ilan bağlantınızı yapıştırın" → ilandaki kurallar, giriş / çıkış saatleri, olanaklar okunur ve
"Doğru mu?" diye tek tek onayınıza gelir. Eksikler soru olarak sorulur: "Wi-Fi şifreniz nedir? (Misafire yalnız konaklama sırasında
verilir.)" Geçmiş mesajlarınızda sık sorulan sorulara verdiğiniz cevaplar taslak bilgiye dönüşür. Hiçbir bilgi onayınız olmadan girmez.
**Günlük örnek:** yeni bir ev sahibi 3 dairesini 10 dakikada kurar; formu hiç açmaz.
**Dürüst hüküm:** YENİ müşteri için çok değerli (satış), sizin kendi işletmeniz için düşük (zaten kurulu). §2'deki "daire bilgileri"
tablosu kurulduktan sonra yapılırsa sohbetin doldurduğu yer de hazır olur.

### 3.4 (6) Fiyat ve "değer raporu"
**Seçenekler:** (a) çözüm başına ücret — bazı büyük ajan ürünleri "çözülen konuşma başına" ücret alıyor (rakam ve şartları araştırma
ajanı kaynaklı doğruluyor). Sorunu: sistem ne kadar çok kendiliğinden gönderirse o kadar çok kazanır; bizim "riskli mesaj insana" ilkemizle
ters teşvik. (b) bugünkü gibi daire sayısına göre düz fiyat + ay sonunda ne kazandığınızı gösteren bir sayfa.
**Değer raporu örneği (yalnız Panel'de, yeni e-posta YOK — kurucu "zaten yeterince mail"):** "Kasım: 214 misafir sorusu cevaplandı (81'i
gece 23:00–08:00 arası). 31 giriş mesajı zamanında gitti. Size bırakılan 12 konuşmanın hepsi aynı gün cevaplandı." Sayılar §1.3'teki
sayaçla AYNI yardımcıdan gelir; "şu kadar saat kazandınız" gibi tahmin yazılmaz (makbuzsuz iddia).
**Dürüst hüküm:** (b). Fiyatı değiştirmez; ilk dilimi §1'in sayacıyla zaten başladı (aylık görünümü ekran onayıyla).

## 4. Ev sahibinin bir günü — uzun vadeli akış (Fable'a gidecek ana öneri)
İlke: **istisna yönetimi.** Sistem her şeyi yapar, yalnız sizin kararınızı gerektireni önünüze koyar; her istisna kendi çözüm düğmesini taşır;
yapılan her işin kaydı (makbuzu) vardır.
- **Sabah (uygulamayı açınca):** Panel'in tepesinde "Dikkat Gerektirenler (2)": "Bugün 15:00 giriş hazır değil — Deniz Daire · temizlik
  'yapılamıyor' dedi [Başka birine atayın]" · "Erken giriş isteği kararınızı bekliyor [Onaylayın] [Reddedin]". Altında küçük satır: "Son 24
  saatte sizin yerinize: 7 misafir sorusu cevaplandı · 2 giriş mesajı gönderildi · 3 görev açıldı". İki dokunuş, bitti.
- **Gün içinde:** acil bir şey olmadıkça hiçbir şey. Acil (güvenlik, su baskını, misafir kapıda kaldı) bugünkü gibi hemen e-posta. Yeni rutin
  e-posta YOK.
- **Akşam / gece:** sistem soruları cevaplar, yarınki temizlikleri açar ve atar, giriş mesajlarını zamanında yollar. Çözemediğini sabaha
  bırakır — riskli olanı asla kendisi çözmez.
- **Hafta / ay:** Panel'de değer görünümü (yeni e-posta değil).
- **Asla otomatik olmayanlar:** şikâyet, para / iade, güvenlik, kural ihlali, ev sahibi kararı gerektiren konaklama istekleri (erken giriş,
  geç çıkış, evcil hayvan…), kapı kodunu ilk kez öğrenen değişiklikler.
- **Temel taşlar (sıra):** (1) "Bugün" istisna kartı + sayaç [başladı] → (2) istisna satırlarında tek dokunuş eylem (Girişler'deki atama /
  giriş mesajı bileşenleri Panel'e) → (3) daire gerçekleri ve atomik çelişki (§2) → (4) "hangi işi kim yapar" tablosu → (5) kurulum sohbeti
  (yeni müşteri) → (6) aylık değer görünümü.

## 5. Fable 5.2'ye sorular (kurucu soracak)
1. "İstisna kartı + son 24 saat sayacı" Panel'in tepesinde mi kalmalı, yoksa ayrı bir "Bugün" sayfası mı (menü sadeleşmesiyle)?
2. §2'deki atomik çelişki tasarımında gözden kaçan bir sınıf var mı (ör. aynı olgunun farklı dillerdeki metinleri, ev sahibinin bilerek iki
   farklı kod kullanması — ana kapı / daire kapısı)?
3. "Hangi işi kim yapar" tablosunun satırları için doğru iş listesi ne? Güven rampasında hangi ölçü (değiştirmeden onay oranı mı, misafir
   şikâyeti olmaması mı)?
4. 10 daireli bir Türk ev sahibi için "otonomiyi hissettiren" en küçük üç değişiklik hangisi?
5. Çözüm başına fiyatlamanın güvenlik ilkesiyle ters teşviki doğru bir okuma mı; sonuç bazlı fiyatlamanın güvenli bir biçimi var mı?

## 6. Kayıtlar
- **Öneri 2 (sabah özeti e-postası): ŞİMDİLİK YOK** (kurucu 11-13: "zaten yeterince bildirimle mail atıyoruz"). Değer görünümü de e-posta
  değil, Panel'de.
- **Dört hukuk / karar sorusu** (kurucu: "o 4 sorunu kaydet"): `docs/claude/acik-isler.md` "11-13 gece — kurucunun kaydettirdiği dört soru".
