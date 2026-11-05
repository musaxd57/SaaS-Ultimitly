# Codex 43fb93e incelemesi — doğrulama, düzeltmeler ve kurucu soruları (2026-11-05 akşam)

> Kurucu: "43fb93e sürümünü inceledi codex yani sonradan yapıpta düzelttiklerin olma ihtimali var doğrula onun bulgularını … uzun uzun
> çalış. bol bol kontrol agenti çalıştır." Codex'in önerisi KARAR DEĞİLDİR; her bulgu bugünkü kodda yeniden çalıştırılarak doğrulandı,
> daha doğru çözüm biliniyorsa o uygulandı ve gerekçesi yazıldı. Para akışı (ödeme) kodu DEĞİŞMEDİ — §3'te önce/sonra örnekli soru.

## 1. Özet tablo

| # | Codex bulgusu | 43fb93e'den bu yana düzelmiş mi? | Ne yapıldı | Kanıt |
|---|---|---|---|---|
| 1 | [P1] Çift ödeme kalkanı iki durumda erken kalkıyor | **Hayır** — iki durum da bugünkü kodda var: (a) yalnız ödeme niyeti anahtarı AÇIKKEN, (b) anahtar açık da kapalı da | Kod YOK (para akışı) → §3.1–3.2 soru | kodda okuma + Codex'in sahte sağlayıcı denemesi |
| 2 | [P1] Paddle sırrı eksikse ödeme olayları kayboluyor | **Hayır** | Kod YOK (para akışı) → §3.3 soru | `webhooks/paddle/route.ts` eksik sırda `200` |
| 3 | [P2] Hız sınırı bellek yedeği sınırsız | Hayır | **Düzeltildi** `e7ebbd15` + `bd7fe880` + `0da7fabb` | 30.000 anahtar: eski 6151 ms → yeni 497 ms; 5 test eski kodda kırmızı; mutasyon 8/8 |
| 4 | [P2] Kuyruk anahtarı kapatılınca aynı istek ikinci kez gidebiliyor | Hayır | **Düzeltildi** `148ffeb2` + `bd7fe880` + `088ed22b` | 14 test (7 eski kodda kırmızı); mutasyon 13/13 + 2/2 |
| 5 | [P2] Elle rezervasyon API'sinde tekrar güvenliği yok | Hayır (birinci taraf çağıran yok, API açık) | Kod YOK → §4 öneri (ortak işlem kaydı, J tasarımıyla) | `api/reservations` POST'u çağıran bileşen yok |
| 6 | [P2] Wi-Fi önerisi yeni elle düzenlemeyi eziyor | Hayır | **Düzeltildi** `c22b6324` | yarış testi eski kodda kırmızı; mutasyon 2/2 |
| 7 | [P2] QR sohbeti yavaş bağlantıda hiç güncellenmiyor | Hayır | **Düzeltildi** `c67fa308` + `b9047c94` + `2a3a375b` | 8 test (4 eski kodda kırmızı); mutasyon 10/11 → yaşayan pinlendi |
| 8a | [P2] QR okuması IP başına 60/dk (aynı binada 6 cihaz takılıyor) | Hayır | **Düzeltildi** `a3db7955` | 4 test (2 eski kodda kırmızı) |
| 8b | [P2] Tekilleşen 200 "Mesaj gönderildi" diye duyuruluyor | Hayır | **Düzeltildi** `151d7cf6` | arayüz 5 + rota 1 test (3 eski kodda kırmızı) |
| — | Gizlilik metni ↔ kalite denetçisi uyumsuzluğu | Hayır | **Kod metne uyduruldu** `bbfb706f` (+ pin) — metne dokunulmadı | 1 rota + 3 birim test |
| — | Next 15.5.29 güvenlik sürümü | — | **Yükseltildi** `e410f221` | `npm run audit:check` yeşil |

Bulgu 1–8'in hepsi 43fb93e'den bu yana DEĞİŞMEMİŞ dosyalardaydı (bu tur düzeltilmeden önce hepsi bugünkü kodda da geçerliydi).

## 2. Yapılan düzeltmeler (müşteriye giden metin DEĞİŞMEDİ)

### 2.1 Hız sınırı bellek yedeği (bulgu 3)
Yalnız veritabanı arızasında koşan yedek sayaç. Önce: 5.000 kayıttan sonra her yeni anahtar bütün haritayı tarıyordu (karesel), süresi
dolmamış kayıt için üst sınır yoktu. Sonra: sert tavan 10.000 anahtar; temizlik ekleme başına en çok 64 kayıt; tavan doluyken yeni anahtar
1.024 yuvalı taşma dizisinde sayılır (çakışma yalnız SIKILAŞTIRIR, kimsenin hakkı sıfırlanmaz); etkin kayıt asla silinmez.

### 2.2 Elle cevapta istek kimliği (bulgu 4)
Önce: kuyruk yolu yalnız kuyruk satırına, doğrudan yol yalnız 2 dakikalık gövde talebine bakıyordu. Senaryo: istek kuyruğa yazıldı, bağlantı
koptu, anahtar kapatıldı (geri alma), aynı istek yeniden denendi → doğrudan da gitti (işçi kuyruk satırını da boşaltır) → misafire iki mesaj.
Sonra: iki yol da aynı istek talebini atomik alır; doğrudan yol önce kalıcı kuyruk satırına bakar. **Codex'in önerisinin üstüne** eklenen:
doğrudan yolda yanıtı kaybolan BAŞARILI gönderimin 2 dakika sonraki tekrarı da artık ikinci mesaj olmaz (eskiden olurdu). Belirsiz sonuçta
bugünkü "konuşmayı kontrol edip yeniden gönder" penceresi (2 dk) DEĞİŞMEDİ.
Örnek: ev sahibi "Kapı şifresi 4512" yazdı, ağ koptu, sayfa "doğrulanamadı" dedi, ev sahibi aynı metni tekrar gönderdi → önce: kuyruk
anahtarı arada değiştiyse ya da 2 dk geçtiyse misafire iki kez; sonra: tek mesaj, ekranda "Bu mesaj az önce gönderildi veya hâlâ
gönderiliyor." (mevcut metin).

### 2.3 Wi-Fi önerisi (bulgu 6)
Önce: öneri onayı kalemi okuduktan sonra ev sahibi kalemi elle düzenlerse eski öneri yeni şifrenin üstüne yazılıyor, karar "onaylandı"
kaydediliyordu. Sonra: yazım okunan sürümle koşullu; kalem değişmişse öneri "artık geçerli değil" (409) döner, elle yazılan korunur, onay
kaydı yazılmaz.

### 2.4 QR sohbeti sorgu döngüsü (bulgu 7)
Önce: 5 sn'de bir yeni sorgu; cevap 5 sn'den geç gelirse ekran hiç güncellenmiyordu. Sonra: aynı anda tek sorgu, öncekisi bitince sonraki
planlanır; 15 sn'de bitmeyen sorgu iptal; 3 ardışık hatadan sonra bekleme 10 → 20 → 40 → 60 sn (uyarı yine ~15 sn'de); gönderim sonrası
ve kilit açılışı yenilemesi uçuştaki eski sorguyu iptal edip en yeni durumu getirir; eski sonuç koruması korundu.

### 2.5 QR okuma sınırı (bulgu 8a)
Önce: IP başına 60/dk. Aynı bina internetindeki 6 farklı dairenin açık sohbeti 72/dk → altıncı donuyordu. Sonra: daire (QR anahtarı) başına
IP bütçesi bugünkü gibi 60/dk (aynı dairede zaten tek cihaz okur), kaba IP tavanı 240/dk (~20 eşzamanlı sohbet). Anahtar özet olarak
tutulur (sır başka tabloya yazılmaz); kova istekte bulunanın IP'sini taşır → başkası bu misafirin kotasını tüketemez. Token 244 bit
rastgele: tahmin saldırısı sınırın konusu değil, yük öyle.

### 2.6 Gönderim duyurusu (bulgu 8b)
Önce: tekilleşen kuyruk tekrarı 200 döner, ekran okuyucuya "Mesaj gönderildi." deniyordu (satır hâlâ sırada / başarısız olabilir). Sonra:
sunucu satırın şu anki durumunu döner; ekran "gönderildi"yi yalnız gerçekten gönderilmişse söyler, sıradaysa mevcut kuyruk notunu, değilse
mesaj balonunun mevcut etiketini ("Gönderilemedi" vb.). Yeni metin yok.

### 2.7 Gizlilik metni ↔ kalite denetçisi
Gizlilik metni: "Anthropic … misafir mesajı iletilmez". Kalite denetçisi (yalnız operatör tetikler) adı / e-postası / telefonu maskelenmiş
misafir mesajlarını Claude'a gönderir ve yalnız `ANTHROPIC_API_KEY`e bakıyordu → açılış planında karar yazıcısı için bu anahtar
tanımlanınca denetim kendiliğinden açılacaktı. Hukuki metne dokunulmadı (avukat paketi); denetim ayrı `QUALITY_AUDIT_ENABLED` anahtarına
bağlandı (varsayılan KAPALI). Açmak isterseniz önce metin avukatla güncellenir. Codex'in notu doğru: maskeleme anonimlik garantisi değildir.

### 2.8 Next.js 15.5.29
Üç orta düzey danışma: kendi sunucusunda koşan uygulamada iletilen yanıt ifşası (bizi ilgilendirir), görsel iyileştiricide SVG (bizde
kapalı), Edge rotalarında HttpOnly çerez ifşası (ara katmanımız Edge'de). Aynı sürüm hattında yama; tam kapı + build ile doğrulandı.

## 3. Ödeme — kod DEĞİŞMEDİ, kararınız gerekiyor

### 3.1 P-1 · "Ödendi, abonelik bağlanması bekleniyor" 10 dakikada kendiliğinden kalkıyor (bulgu 1b — anahtar açık da kapalı da)
**Bugün:** Ödeme ekranı başarıyla kapanınca "Ödemeniz işleniyor" kilidi 10 dk tutulur; Paddle'ın abonelik bildirimi gelince kalkar.
Bildirim 10 dakikadan geç gelirse kilit SÜREYLE kalkar ve yeni ödeme ekranı açılabilir.
**Örnek:** Müşteri 14:00'te öder. Paddle'da gecikme var, abonelik bildirimi 14:25'te gelir. 14:10'da kilit kalkar; müşteri planını hâlâ
göremediği için 14:12'de yeniden öder → iki abonelik, iki tahsilat (Codex sahte sağlayıcıyla 9. dk ret / 11. dk yeni işlem gördü).
**Büyük şirketler:** süre dolması "ödeme yok" demek sayılmaz; sağlayıcıya sorulur (uzlaştırma), sonuç kesinleşmeden ikinci tahsilat açılmaz.
**Önerim:** ödeme tamamlanınca işlem kimliği sunucuda saklanır (Paddle'dan doğrulanarak). 10 dk dolunca müşteri yeniden denerse sistem
Paddle'a sorar:
- işlem ödendi + abonelik Paddle'da var → aboneliği bildirim beklemeden kendisi yazar, müşteri planını görür, ikinci ödeme açılmaz;
- işlem ödenmedi / iptal → kilit kalkar, yeni ödeme açılır (bugünkü davranış);
- Paddle'a ulaşılamıyor → "Ödemeniz işleniyor. Planınız birkaç dakika içinde görünecek." (mevcut metin) sürer; 30 dk sonra size uyarı.
Migration gerekmez. Paddle deneme (sandbox) ortamında sizinle birlikte denenmeden açılmaz. **Böyle yapalım mı?**

### 3.2 P-2 · İptali doğrulanamayan açık ödeme 24 saatte kapanıp yeni ödemeye yer açıyor (bulgu 1a — yalnız ödeme niyeti anahtarı açıkken)
**Bugün:** `PADDLE_CHECKOUT_INTENT_ENABLED=1` iken, eski işlemin iptali Paddle'dan doğrulanamazsa niyet açık tutulur; ama 24 saati aşınca
kapanır (size uyarı gider) ve yeni işlem açılabilir. Eski işlem o arada ödenebilirse iki tahsilat olur (24 saatten eski onayla ödenen işlem
işletmeye bağlanamaz → para alınmış ama plan yazılmamış).
**Önerim (iki seçenek):**
- **A (güvenli):** 24 saatte de kapanmaz; yeni ödeme açılmaz, size uyarı gider, Paddle panelinden eski işlemi iptal edersiniz, sistem
  sonraki denemede iptali görür ve yer açılır. Müşteri bu sürede "Açık bir ödemeniz var…" (mevcut metin) görür.
- **B (bugünkü):** 24 saatte kapanır + uyarı (çift tahsilat riski kabul).
Ben **A**'yı öneriyorum (anahtar zaten kapalı; açılışta sandbox denemesiyle birlikte). **Hangisi?**

### 3.3 P-3 · Paddle sırrı eksikken webhook `200` dönüp olayı atıyor (bulgu 2)
**Bugün:** `PADDLE_WEBHOOK_SECRET` yoksa olay "teslim alındı" (200) cevabıyla atılır + size bir kez uyarı. Paddle bir daha göndermez → ödeme
alınır, plan yazılmaz. Bilerek kapalı kurulum (ödeme hiç yapılandırılmamış) ile "ödeme açık ama sır kaybolmuş" ayrılmıyor.
**Paddle'ın davranışı (belgesi):** başarısız teslimi canlı hesapta 3 günde 60 kez yeniden dener (ilk saatte 20); süresi dolanı panelden /
API'den 90 güne kadar yeniden gönderebilirsiniz.
**Önerim:** ödeme yapılandırılmışken (Paddle istemci anahtarı + fiyat kimliği var) sır yoksa webhook `503` döner → Paddle 3 gün yeniden
dener, sır düzeltilince olaylar kendiliğinden işlenir; `/api/health?strict=1` "hazır değil" der; açılışta uyarı. Ödeme hiç
yapılandırılmamışsa bugünkü gibi `200` (sessiz kapalı). Ek olarak salt-okuma bir betik: başarısız Paddle bildirimlerini listeleyip
yeniden gönderir (siz onaylayınca). **Böyle yapalım mı?**

## 4. R-1 · Elle rezervasyon API'sinde tekrar güvenliği (bulgu 5)
**Doğrulandı:** `POST /api/reservations` (elle tek rezervasyon) referanssız aynı iki istekte iki rezervasyon açar; rezervasyon yazılıp görev
oluşturma hata verirse yeniden deneme ikinci rezervasyonu açar. Bu rotayı çağıran birinci taraf form YOK (API yine de açık; CSV yolundaki
düzeltme bu rotayı kapsamıyor).
**Önerim:** bağımsız PMS hedefi için elle rezervasyon formu zaten gelecek; personel daveti / iş kabulü (H3) de aynı ihtiyacı taşıyor. Tek
seferlik yama yerine ORTAK bir "işlem kaydı" tablosu: işletme + işlem türü + istek kimliği tekil, istek özeti saklanır (aynı kimlik farklı
içerikle → 409), sonuç saklanır (tekrar aynı sonucu döner), işlem ve kalıcı yan etki aynı veritabanı işleminde. İsim / tarih benzerliği
anahtar yapılmaz. Bu ortak mimari tasarımına (J) girer; migration gerekir. **Bunu J tasarımına alalım mı?**

## 5. Diğer teknik başlıklar (Codex'in listesi)
- **Parola özeti (bcrypt ana iş parçacığında):** doğrulandı — `bcryptjs` maliyet 12, eşzamanlılık kapısı (2 aynı anda / 32 sıra / 8 sn).
  Uzun vadeli öneri: sunucu tarafı sınırlı işçi havuzu (ya da yerel kütüphane) + ölçülmüş Argon2id geçişi; eski özetler başarılı girişte
  kademeli yükseltilir (girişte yükseltme yolu repoda zaten var). Önce yük ölçümü; ayrı tur. **Soru S-2:** ölçüm + tasarım turu açalım mı?
- **Sızmış parola engeli:** yok (doğrulandı). Öneri: yalnız YENİ parola oluşturma / değiştirmede, k-anonimlik yöntemiyle (parolanın
  özetinin ilk 5 karakteri dışarı çıkar, parola çıkmaz) bilinen sızıntı listesine bakmak; mevcut kullanıcılar kilitlenmez. Müşteriye yeni
  bir hata cümlesi gerekir, örnek: "Bu şifre daha önce bir veri sızıntısında görülmüş. Başka bir şifre oluşturun." **Soru S-1:** ekleyelim mi,
  metin bu olsun mu?
- **SSE / anlık bildirim:** önce sorgu döngüsü düzeltildi (2.4). SSE ayrı tasarım; acele yok.
- **DDoS / edge:** uygulama sınırları + gövde sınırları var; canlıda edge koruması (ör. Cloudflare) ve vekil güven zinciri Railway
  açılışında doğrulanır (bu turda doğrulanamaz).
- **`public/uploads`:** repoda yalnız `.gitkeep` (doğrulandı). Canlı diskte eski dosya varsa önce salt-okuma envanter, sonra onaylı taşıma
  — Railway açılışında.
- **IDOR / SQL / hash çakışması / kesici:** Codex de doğrudan istismar bulmadı; ek iş yok.

## 6. Hukuki başlıklar (avukat paketi — Claude metin değiştirmez)
- Gizlilik ↔ kalite denetçisi: kod tarafı metne uyduruldu (2.7). Denetimi açmak isterseniz metin güncellenmeli.
- Yenileme / e-posta, telif bildirimi akışı, KVKK aydınlatma ↔ gerçek veri akışı eşleşmesi: avukata gidecek listeye eklendi.
- Font: Codex de sorun bulmadı (fontlar kendi sunucumuzda).

## 7. Sorular (özet)
- **P-1** Ödeme sonrası abonelik bildirimi gecikirse Paddle'a sorma (uzlaştırma) — böyle yapalım mı?
- **P-2** İptali doğrulanamayan açık ödeme 24 saatte: A (kapanmaz, uyarı) mı B (bugünkü) mi?
- **P-3** Ödeme yapılandırılmışken sır eksikse 503 + hazırlık kontrolü + yeniden gönderme betiği — böyle yapalım mı?
- **R-1** Ortak "işlem kaydı" tablosu (elle rezervasyon + personel daveti + iş kabulü) — J tasarımına alalım mı?
- **S-1** Sızmış parola engeli + metin.
- **S-2** Parola özeti ölçüm + işçi havuzu / Argon2id tasarım turu.
- **J-10** (Opus F7, tasarım belgesi §6) Girişler'de temizlik görevine yazılan not: bilgi satırı mı (bugün), "bilinmiyor" mu?

## 8. Doğrulama özeti
- Kırmızı-önce: her düzeltmenin testi eski kodda koşturuldu (yukarıdaki sayılar).
- Mutasyon (`scripts/mutation-run.mjs`, commit edilmiş SHA, M0 yeşil): 24/24 (hız sınırı, Wi-Fi, istek kimliği), 10/11 → yaşayan G8 yeni
  testle öldürüldü (QR döngüsü), son parti 14/14 (duyuru, QR sınırı, kalite denetimi, G8) — §9.
- Haiku incelemesi: 11 madde; 1. madde (gönderim hata fırlatırsa talep 24 sa kalıyordu) düzeltildi, "gövde talebini de bırak" önerisi
  REDDEDİLDİ (belirsizde hemen yeniden gönderim olmaz); 2. madde (yazımdan önce çöken kuyruk yolu) kuyruk talebini 2 dk'ya indirerek
  çözüldü; 4. madde 2.6 ile kapandı; 3/5/6 tasarım gereği güvenli taraf.

## 8.1 Tam kapının yakaladığı (dürüst kayıt)
İlk tam kapı (gate-1105l) veritabanısız kolda BİR kırmızı verdi: `rate-limit-ip-bucket` mekanik pini (`rateLimit(` içinde `${ip}` deseni
yasak — kova anahtarı ham IP'den kurulmasın). QR okuma sınırında (2.5) değişkenin adı `ip` idi; değer zaten `rateLimitClientKey`ten
geliyordu (IPv6 /64 gruplu), yani davranış doğruydu ama pin metin olarak yakaladı. Ad `clientKey` yapıldı (`2c15f582`). Ders: hız
sınırına dokunan değişiklikte `tests/unit/rate-limit*` pinleri de koşulur. Kapı durdurulup bütün değişikliklerle yeniden koşuldu.

## 9. Son mutasyon partisi
14/14 öldürüldü (M0 yeşil): duyuru D1–D6 (rota alanı, iki yolun gerçek durumu, istemcinin üç dalı), QR sınırı Q1–Q3 (daire kovası,
240 tavanı, kovada istekte bulunanın IP'si), kalite denetimi A1–A4 (kart, doğrudan çağrı, rota, yalnız "1"), G8 (tek tur kalkanı — önceki
partide yaşayan, yeni zamanlama testiyle öldü). Toplam bu tur: 24 + 11 + 14 = 49 mutant, 49'u öldürüldü (biri ilk koşuda yaşadı, pinlendi).

## 10. Opus dilim sonu incelemesi (787cc652..9242634b — 12 bulgu)

Dilim bitince Opus 5.5 "en derin ve sert" inceleme yaptı (salt-okuma; bulgularını dosyaya yazarak). Her bulgu bugünkü kodda yeniden
doğrulandı; düzeltilenlerin testi eski kodda kırmızı, yenide yeşil. Misafire giden metin DEĞİŞMEDİ.

| # | Bulgu | Ne yapıldı | Commit |
|---|---|---|---|
| F1 · P2 | Doğrudan yolda istek talebi 24 saatle DOĞUYORDU: gönderim sürerken sunucu çökerse (yayın, bellek) aynı metin 24 saat "az önce gönderildi" diye reddedilirdi — mesaj hiç gitmemiş olabilirdi | Talep 2 dk doğar, YALNIZ kesin başarıda 24 saate uzar → her arıza bugünkü 2 dk "kontrol edip yeniden gönder" penceresine iner | `26688416` |
| F2 · P3 | Gönderimden ÖNCE başlamış yavaş QR sorgusu, gönderim sürerken dönünce misafirin kendi mesajını ekrandan siliyordu | Gönderim uçuştaki sorguyu iptal eder, eski sonuç düşer | `91ce9134` |
| F3 · P3 | Ekran kurulumu iki kez koşunca ilk yükleme bir tam tur (5 sn) gecikiyor, iptal "hata" sayılıyordu | Temizlikte uçuştaki sorgu bırakılır; iptal hata sayılmaz (gereksizleşen bayrak çıktı) | `91ce9134` · `28d76acd` |
| F4 · P3 | Veritabanı arızasında taşma yuvası farklı pencereli anahtarları karıştırıyordu (60 sn'lik sınır 1 saate çıkabilirdi); yuva karması tahmin edilebilirdi | Süreç başına rastgele tohum; taşınan sayaç anahtarın KENDİ penceresiyle; bekleme süresi o pencereyle sınırlı | `76d1f709` |
| F5 · P3 | QR okumasında her geçersiz anahtar yeni bir sayaç satırı açıyordu (IP başına dakikada 240 satır) | Daire kovası anahtar çözüldükten SONRA; geçersiz anahtarlar ayrı ıska kovasında (IP başına 60/dk, çözümden önce bakılır) | `8738fcc3` |
| F6 · P3 | Tekilleşen tekrarın satırı "gönderilemedi" iken yazılan metin teslim edilmiş gibi siliniyordu | Metin korunur, sebep ("Gönderilemedi") görünür | `91ce9134` |
| F7 · P3 | Girişler'de engel / not / çakışma satırlarının DAYANAĞI yoktu (hangi görev, kim, ne zaman) — kurucu şartı ("her durumun dayanağı") eksikti; not ile bakımın ağırlığı farklı | Dayanak eklendi (aşağıda örnek); ağırlık kurucu sorusu **J-10** (tasarım belgesi §6) | `b2bc1acf` |
| F8 · P3 | Girişler gösterim incelikleri: son "bitti" kuralı çekirdekten farklı · görev VARKEN "görev yok" · batı saat diliminde gün bölümü bölünmesi · dünkü "başladı" bugünün saati gibi | Dördü de düzeltildi, her biri pinli | `588ae515` · `523ec129` |
| F9 · P2 | Kutu boşaltılıp aynı kısa metin ("Tamam") saatler sonra yeniden yazılınca ESKİ istek kimliği gidiyordu → 24 saat ret (kuyruk açıkken sessiz yutma) | Kimlik yalnız yazma kutusu AYNI metni tutarken yeniden kullanılır; metin değişince / kutu boşalınca yeni kimlik | `91ce9134` |
| F10 · P3 (gizli) | Çeviriyle gönderilen cevabın tekrarında kimlik ÇEVRİLMİŞ metinle karşılaştırılıyor (çeviri her seferinde biraz farklı) → "farklı içerik" döngüsü + ikinci ücretli çeviri | Bugün arayüzde çeviriyle gönderim YOK (yalnız API) → kod değişmedi. **Çeviri düğmesi eklenirken ön koşul:** kimlik kontrolü çeviriden ÖNCE ve ham metnin özetiyle | — |
| F11 · P3 | Fazla iddia eden testler | Yazma servisi artık GERÇEK içe alma yolundan sınanıyor (istek öneki eklenince kırmızı) · kiracılar arası test başka işletmede aynı kurulumla · iyimser balon testi (F2) · taşma temizliği adımı tam sınırla | `36706801` · `588ae515` · `91ce9134` |
| F12 · P2 (eski) | Eski Safari'de (iOS 15.3 ve öncesi) `crypto.randomUUID` yok → misafirin mesajı gönderilmiş gibi duruyor ama hiç gitmiyordu, düğme kilitli kalıyordu | Kimlik üretimi yedekli (`newRequestId`); gönderim kurulumu hata yakalayıcının içinde | `91ce9134` |

**Girişler dayanağı — önce / sonra (ev sahibi ekranı; misafire bir şey gitmez):**
- Önce: `HAZIR DEĞİL — Mülkte açık bakım görevi var` (hangi görev? kimde?).
  Sonra: `HAZIR DEĞİL — Bakım açık: Klima arızası · atanan: Mehmet · vade 6 Kas 10:00 (gecikti) — eksik: görevin kapanması`
  (listenin kendi kalıbı: "Söz açık: …", "Temizlik açık · …"; tür adı Görevler sayfasındakiyle aynı; vadesi geçmişse "(gecikti)").
- Önce: `Temizlikçi bugün bu temizliğe not yazdı — görevde bakın`.
  Sonra: `Temizlik görevine not yazıldı · Ayşe · 11:30 — görevde okuyun` (notun İÇERİĞİ gösterilmez; yazan her zaman temizlikçi değildir).
- Önce: `Aynı gece başka bir konaklama var`. Sonra: `Çakışan konaklama: Ali Veli · 5 Kas – 8 Kas` (aynı gün iki ayrılış da yazılır).
- Gösterilenden fazla açık bakım görevi varsa `Bu mülkte başka açık bakım görevleri de var` (sessiz kesme yok). "Görevler" bağlantısı o
  dairenin görevlerine süzülü açılır. Dayanak kayıtları çekirdeğin AYNI kümesinden gelir (misafire giden kararın okuduğu küme); hüküm
  değişmedi (sayım aynı koşulla okunuyor).

**Mutasyon (commit edilmiş SHA, M0 yeşil):** Opus partisi O1–O16 **16/16** (`523ec129`: talep süresi / uzatma, eski Safari yedeği, iyimser
balon, temizlik, F9 / F6 dalları, tohum, pencere, bekleme sınırı, ıska kovası, daire kovası, gün sırası, görev-var dalı, tarih etiketi) ·
dayanak partisi B1–B19 **19/19** (`0dec1719`: çekirdeğin dört kimlik kümesi, "+1" okuma, aynı gün iki ayrılış, üç org süzgeci, kimlikli not
şartı, satırın kendi notu, tekilleştirme, vade / ad / yazan etiketleri, Görevler bağlantısı, yazma servisinin önek ayrımı, genel cümle dalı).
Haiku incelemesi sonrası (etiket kalıbı, "(gecikti)", eksik dayanak) C1–C3 **3/3** (`f651fa41`). Bu turun toplamı: 49 + 16 + 19 + 3 =
**87 mutant, 87'si öldürüldü**.
