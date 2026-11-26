# Kurucu talimatı — 25 Kasım akşam: Codex'in ikinci raporu (AYNEN)

> Bu işte her dilimden ÖNCE bu dosya okunur. Kurucunun mesajı değiştirilmeden aşağıda; en altta ana oturumun madde numaraları (yalnız
> atıf kolaylığı — metne dahil değil) ve uygulama durumu.

## Kurucunun mesajı

1. Kuyruk monitörü geciken işleri kaçırabiliyor. Gerçek sağlık rotasını sahte DB sonuçlarıyla çalıştırdım. Gönderilebilir bir mesaj 65 dakika beklerken başka bir işletmede yakın zamanda bir iş alındığında rota `200 queue=ok` döndü. Kuyruk sorgusu hata verdiğinde `200 queue=unknown` döndü. Kuyruğun tamamen durmasını, işletme başına gecikmeden ayrı ölçmek gerekiyor. [Kuyruk kontrolü](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/outbox/health.ts#L149) · [Sağlık rotası](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/app/api/health/route.ts#L138)
2. Sohbet ekranı eşit zaman damgalarında farklı taslak seçebiliyor. Ekran yalnız `createdAt` ile sıralıyor. AI tarafı `createdAt,id` kullanıyor. Gerçek `preparedDraftOf` işlevi iki geçerli eşit zaman sıralamasında farklı mesajları seçti. Aynı ekran her 30 saniyede tüm mesajları ve gönderim kayıtlarını tekrar alıyor. Sıralamayı ortaklaştırıp son 40–60 mesajla başlamak ve önceki sayfaları imleçle yüklemek iki sorunu birlikte çözer. [Sohbet ekranı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/app/(app)/inbox/%5Bid%5D/page.tsx#L115)
3. Senkron döngüsü işletmeleri sırayla işliyor. Bir işletmedeki yavaşlık diğerlerinin senkron ve uyarı süresine ekleniyor. 12 dakikalık koşu ve 4 dakikalık işletme bütçesi başlamış işi kesmiyor. Kilit yalnız işletmeler arasında yenileniyor. Bir işletme 15 dakikayı aşarsa ikinci kopya kilidi alabilir. Acil uyarı ve veri alımını model ve teslim işleriyle ayrı önceliklerde çalıştırmak gerekir. Mevcut PostgreSQL outbox `SKIP LOCKED` ile işçi paralelliğine temel sağlıyor. [Senkron döngüsü](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/scheduled-sync.ts#L483) · [Outbox işçisi](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/outbox/worker.ts#L311)
4. İkinci replika öncesi operasyon hazırlığı gerekli. Zamanlayıcı ve e-posta yoklayıcısı web sürecinde, migration her açılışta çalışıyor. Üretim planında önce tek migration görevi, çalışanların ayrı başlatılması, kopya başına DB bağlantı tavanı, dış izleme ve geri yükleme provası olmalı. Açılış belgeleri Railway’in duraklatıldığını ve bekleyen migration’lar olduğunu kaydediyor. [Zamanlayıcı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/instrumentation.ts#L120) · [SLO ve kurtarma](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/docs/OPS-OLAY-YONETIMI-VE-SLO.md)

Yerel ESLint salt okunur koşuda 0 hata, 85 uyarı verdi. Bellekteki 14 test grubu geçti. Bunlar arasında 1.441 gönderim öncesi zaman damgası, 500 eşzamanlı sağlık sorgusunun tek işlemde birleşmesi, 200 sağlayıcı HTTP durumunun sınıflandırılması, tek süreçte 500 eşzamanlı toparlanma talebinden yalnız birine izin verilmesi ve altı hatalı CI raporunun reddi var. Ayrıca sağlık rotasındaki üç davranış ve taslak seçimi ayrı doğrulandı. Dosya yazımı, gerçek veritabanı değişikliği veya kanal gönderimi yapılmadı.
Ürün tarafında önce Hospitable gerektirmeyen takvim ve QR kurulumunu tamamlar, kurulumda gerçek misafir mesajı göndermeyen bağlantı provası eklerdim. İkinci odak, ev sahibine hazırlanma, kuyruk, kanal teyidi ve inceleme durumlarını takip numarasıyla gösteren teslim geçmişi olurdu.

İkinci turda ödeme defterini, e-posta kuyruğunun kurtarma akışını ve misafir verisi silmenin işlem sınırlarını inceledim. Gerçek kaynak kodunu bellekte çalıştıran 8 senaryo beklenen sonucu verdi.
Öncelik	Bulgu	Öneri
Yüksek	Hesap silme, henüz aboneliğe bağlanmamış ödemeyi korumuyor. Silme kapısı yerel aboneliğe bakıyor. Bekleyen ödeme ve onay kayıtları ise hesabın silinmesiyle birlikte kalkıyor. Bu bir kaynak kodu bulgusu.	Ödeme kesinleşmeden silmeyi beklet veya uzlaştırma için gereken asgari kayıtları koru. [Silme kapısı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/app/api/account/delete/route.ts#L121)
Yüksek	Ödeme kurtarma işi aynı 1.000 kayıtta kalabiliyor. 1.001 bekleyen ödeme içeren iki ardışık koşuda son ödeme hiç okunmadı. Tam 1.000 kayıtta bile sınır aşımı alarmı çıktı.	Kalıcı devam imleci veya kayıt başına sonraki deneme zamanıyla sırala. Alarmı gerçek fazla kayıtla doğrula. [Ödeme uzlaştırması](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/billing/checkout-paid.ts#L322)
Orta	Tek e-posta kaydının arızası sonraki kurtarmaları kesiyor. İlk satıra geçici işlem hatası verdiğimde sağlıklı ikinci satır işlenmedi. Harici cron akışında aynı hata normal gönderimi de o tur için atlatıyor.	Satır hatalarını ayrı yakala, kurtarmayı süre ve kimlikle sırala, normal gönderimi bağımsız çalıştır. [İşçi](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/email-outbox.ts#L799) · [Zamanlayıcı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/scheduled-sync.ts#L882)
Orta	Silme tamamlandıktan sonra istemci 500 alabiliyor. Son doğrulama arızasında maskeleme ve denetim kaydı commit oldu. Aynı isteği tekrar etmek ikinci denetim kaydını yazdı. İşlem içindeki zorunlu denetim yazımı arızalandığında ise commit gerçekleşmedi.	Silme isteğine kalıcı işlem kimliği ver. Commit durumunu sakla ve doğrulamayı yeniden denenebilir ayrı adım olarak işle. [Silme işlevi](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/erasure.ts#L713)


Ayrıca ödeme uzlaştırması, başka bir işlem kaydı önce değiştirdiğinde sıfır satırı güncellemiş olsa da fulfilled sonucu döndürebiliyor. Başarı sayacı ve karar mevcut son duruma dayanmalı. [Koşullu kapanış](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/billing/checkout-paid.ts#L278)

Öncelikli güvenlik bulgusu: QR sohbetinde PIN politikası ve cihaz yetkisi birbirinden kopuk. PIN değişimi mevcut cihaz bağını iptal etmiyor. PIN politikası sonradan sıkılaştırıldığında daha önce eşleşmiş bir cihaz yeniden PIN doğrulamasına girmeden kabul ediliyor. Wi-Fi bilgisinin modele verilmesi ise cihazın güncel PIN’i geçtiğinin kanıtına değil, konaklamada şu anda PIN gerekip gerekmediğine bağlı. Cihaz yetkisini PIN sürümüne ve doğrulama durumuna bağlamayı, politika değiştiğinde dağıtılmış erişimi iptal etmeyi ve Wi-Fi bilgisini yalnızca doğrulanmış cihaz için yüklemeyi öneriyorum. Mevcut ayrı cihaz sıfırlama işlemi kısa vadede bir kontrol sağlar. Kapı kodlarının ifşası gözlenmedi. [PIN güncellemesi](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/guest-chat-pin.ts#L83-L93) · [QR cihaz kontrolü](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/app/api/chat/%5Btoken%5D/route.ts#L769-L790) · [Wi-Fi koşulu](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/guest-chat.ts#L1732-L1745)

İki doğrulanmış hata: Üç bozuk görüntü örneği yalnızca dosya başlıklarıyla JPEG, PNG ve WebP olarak kabul edildi. Yükleme akışı orijinal baytları saklıyor. Boyut ve piksel sınırlarıyla tam decode ve yeniden kodlama, bozuk içeriği reddeder ve gereksiz EXIF/GPS verisini kaldırır. Ayrıca Windows’ta kiracılar arası test kapsamını denetleyen dosyanın beş kontrolünden üçü POSIX yol varsayımı yüzünden kırılıyor. Bellek içi yol normalizasyonuyla beşi de geçti. [Görsel doğrulayıcı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/image-validation.ts#L8-L24) · [Test dosyası](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/tests/unit/cross-tenant-coverage.test.ts#L130-L153)

Kontroller: Bellek içi test aracında kaynak kod üzerinde çalıştırdığım 23 bağımsız kontrolün 20’si geçti. Başarılı senaryolar Paddle ve WhatsApp imzaları, AES-GCM bağlam koruması, özel fotoğraf anahtarının kiracı ve görev kapsamı, yerel hız sınırı ve üretim gizli anahtar doğrulamasını içeriyordu. Depodaki 45 yapısal test gövdesinden 42’si geçti. Windows yolu kaynaklı üç hata bu grubun tamamını açıklıyor. Tam Vitest, üretim ayarları ve çok replikalı yük sonucu bu sayıların kapsamı dışında.

Geliştirme sırası: PIN yetkisi ve görsel doğrulamasından sonra, PostgreSQL’e yazılan hız sınırında ayrı kapasite ve arıza senaryoları, uygulama rollerinden bağımsız veritabanı izolasyonu, hassas operatör işlemlerinde yakın tarihli ikinci faktör doğrulaması ve rapor modundaki betik CSP’sini kademeli uygulama. Next.js 15.5.29 için 31 Ocak 2027’de biten güvenlik bakımı öncesinde Next.js 16 geçişi planlanmalı. Next.js destek politikası · Next.js CSP kılavuzu · [PostgreSQL satır güvenliği](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

19:00

3m 5s çalıştı

Güncel Lixus kaynağında OAuth, takvim, WhatsApp ve herkese açık uçları salt okunur inceledim. 17 çevrimdışı kontrolden 14’ü geçti. Üç kontrol aşağıdaki bulguları doğruladı.
Öncelik	Bulgu	Öneri
Yüksek	Hospitable OAuth istemcisi yalnızca ilk hedefin HTTPS olduğunu doğruluyor. Token isteği açık bir yönlendirme politikası tanımlamıyor. Sağlayıcı yönlendirme döndürürse POST gövdesindeki istemci sırrı ve OAuth kodu veya yenileme değeri beklenen hedefin dışına taşınabilir. Gerçek sızıntı gözlenmedi. [Kaynak](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/hospitable-oauth.ts#L233-L252) · [Fetch standardı](https://fetch.spec.whatwg.org/#http-redirect-fetch)	Yönlendirmeleri reddet, sağlayıcı hedeflerini kesin listeyle doğrula ve izinli hedefin dışına istek çıkmadığını test et.
Orta	İmzalı bir WhatsApp teslimatı hem ev sahibi hem ekip olayı taşıyorsa ekip doğrulaması ve teslimat durumları ev sahibi işleyicisinden önce bekleniyor. Yavaş ekip işlemi bildirimden çıkma talebini geciktirebilir. [Kaynak](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/app/api/webhooks/host-channel/whatsapp/route.ts#L108-L178)	Bildirimden çıkma işlemlerini önce tamamla veya işlem sınıflarını ayrı kuyruklara al.
Orta	Takvim senkronizasyonu, 15 saniyelik ağ süresini başlatmadan önce ek DNS çözümlemesi yapıyor. İşletme genelindeki manuel senkron da kaynakları tek HTTP isteğinde sırayla bekliyor. [DNS adımı](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/import/sync.ts#L273-L290) · [Manuel senkron](https://github.com/musaxd57/SaaS-Ultimitly/blob/6428f14190d98e402406eeda5e741440ba484d9f/src/lib/import/sync.ts#L1058-L1081)	Ağ süresini tek noktadan uygula. Elle tetiklemeyi aynı işletmeye ait tekrarları birleştiren kaynak bazlı kuyruğa al.


17 rota dosyasında standart oturum denetimi yerine OAuth dışındaki bağlantı belirteçleri, webhook imzaları, zamanlayıcı anahtarı veya herkese açık kullanım için tasarlanmış başka kontroller var. Toplam 130 rota dosyası ve 168 dışa aktarılan HTTP yöntemi saydım. OAuth durum imzası ve süresi, takvim akışının bayt sınırı, CSV ayrıştırma, iCal iptal durumu ve WhatsApp numara ayrımı çevrimdışı kontrolleri geçti.

Operatör paneli en son 50 demo talebini gösteriyor. Bildirim bütçesi aşıldığında eski açık talepleri bulmak için sayfalama ve durum filtresi gerekir. Misafir adı paylaşımı kapalı olsa bile iCal başlığı işletmenin dahili mülk adını yayımlıyor. Yoğun kullanılan takvimler için veri seçimini daraltmak ve genel bir başlık kullanmak bu yüzeyi iyileştirir.

Öncelikli bulgular

* Ödemeler. `BILLING_ENFORCED=true` iken Paddle webhook anahtarı eksik olsa bile başlangıç doğrulaması geçiyor. Webhook bu durumda 200 dönüyor, uyarı üretiyor ve olayı işlemiyor. Ödenen aboneliğin yetkisi işlenmeyebilir. Üretim ödeme profilinde anahtarları, fiyat haritasını ve uçtan uca yetki oluşumunu zorunlu doğrula. `scripts/env-check.mjs:577`, `src/app/api/webhooks/paddle/route.ts:859`
* Hesap kurtarma ve operasyon. Gerçek başlangıç betiğini yedi sentetik ortamla çalıştırdım. Zayıf oturum/şifreleme sırları, kapalı parola sıfırlama kuyruğu, cron sırrı bulunmayan otomasyon ve anahtarları eksik Turnstile yapılandırması uyarı ile açılıyor. Eksik oturum sırrı, tekrar kullanılan anahtar ve eksik depolama yapılandırması doğru biçimde engelleniyor. Betik örnek sırları loglamadı. `scripts/env-check.mjs:62`, `scripts/env-check.mjs:403`, `scripts/env-check.mjs:568`
* Yayın güvenliği. Container, ortam doğrulamasından önce veritabanı migration’ını uyguluyor. Doğrulamayı önceye al. Migration’ı tek bir yayın işine, çalışan uygulamayı kısıtlı bir DB rolüne taşı. CI, temiz veritabanında migration zincirini ve şema uyumunu test ediyor. Veri dolu eski sürümden yükseltme ve geri yükleme provası eklenmeli. `Dockerfile:145`, `.github/workflows/ci.yml:266`
* Ölçek. Senkron bütün kiracıları tarayıp aktifleri tek global kilit altında seri işliyor. Mevcut süre sınırı, devam imleci ve lease yenilemesi yardımcı oluyor. Kiracı başına işler, bağımsız işçiler, kiracı bazlı zaman aşımı ve kuyruk yaşı ölçümleri ile ayır. Kuyruk zaten PostgreSQL `SKIP LOCKED` kullanıyor. `src/lib/scheduled-sync.ts:425`, `src/lib/scheduled-sync.ts:538`, `src/lib/outbox/worker.ts:311`
* Savunma derinliği. HSTS, `nosniff` ve gizli bağlantılardaki `no-referrer` yapılandırması doğrulandı. Script CSP yalnızca rapor modunda. Panel ve giriş sayfalarında nonce tabanlı uygulama, Paddle ve Turnstile tarayıcı testleriyle devreye alınabilir. AES-GCM v2 bağlam verisi yanlış olduğunda şifre çözmeyi reddetti. Yeni tekil deploy anahtarı eski v1/v2 şifreli verisini okuyamadı. Sürümlü anahtar ve aşamalı yeniden şifreleme tasarlanmalı. `next.config.mjs:40`, `next.config.mjs:116`, `src/lib/crypto-core.ts:14`

Sağlık kontrolünün ortak çalışma mekanizması aynı anda 1.000 başarılı ve 1.000 hatalı çağrı altında her grupta tek arka uç çağrısı yaptı, ardından toparlandı. Strict kontrol kuyruk ve üyelik verisini okuyamadığında kasıtlı olarak 200 dönebildiğinden, operasyon izlemesi HTTP durumuna ek olarak gövde alanlarını ve kuyruk yaşı hedeflerini takip etmeli. `src/app/api/health/route.ts:135`, `src/lib/outbox/health.ts:97`
Sentetik testleri yerel Node 24 üzerinde çevrimdışı çalıştırdım. Üretim Node 22 ve canlı yapılandırma bu çalışmanın kapsamında doğrulanmadı. Dosya değiştirilmedi veya silinmedi, canlı uygulamaya ya da GitHub’a işlem yapılmadı.
19:00
3m 30s çalıştı
Bu turda en güçlü yeni bulgu, misafir silme işlemiyle eşzamanlı üretilen verinin tekrar kaydedilebilmesi. Silme işlemi iç notları ve anlamsal değerlendirme kayıtlarını temizliyor. Konaklama ve konuşma satırları maskelenerek korunduğu için iç not yazıcısı veya gecikmiş model sonucu, silme tamamlandıktan sonra aynı kayda yeniden yazabiliyor. Yazım sırasında silme durumunu ortak işlem kilidi altında doğrulamak ve geç gelen sonuçları reddetmek gerekiyor. Mevcut yaşam döngüsü testi silme öncesi kayıtları kapsıyor. `src/lib/erasure.ts:603`, `src/lib/internal-notes/service.ts:184`, `src/lib/semantic-reading/shadow-pass.ts:99`, `tests/integration/internal-note-semantic-reading-lifecycle.test.ts:140`

* Çok işletmeli üyelik. Web oturumu üyelik kimliği, durum ve kuşağını doğruluyor. WhatsApp yetkisi ve hesap silmenin son kontrolü hâlâ `User` satırındaki ana işletme ve rolü kullanıyor. Ana işletme silinince kullanıcı kimliği de cascade ile siliniyor. Çoklu üyelik koruması kaldırılmadan bu yolların üyelik politikasına taşınması ve eski sürüme dönüş sınırının test edilmesi gerekiyor. `src/lib/host-channel/answer.ts:213`, `src/app/api/account/delete/route.ts:125`, `prisma/schema.prisma:287`
* Ödeme kayıtlarının anonimleştirilmesi. Hesap silmenin ilk webhook geçişi, `custom_data.organizationId` eşleşmesini işlem sahipliği için yeterli görüyor ve olayı işlenmiş işaretliyor. Destrüktif eşlemede sunucunun doğruladığı ödeme veya onay ilişkisi kullanılmalı. `src/lib/data-retention.ts:923`
* Veritabanı bütünlüğü. Migration 99’un ayrı yabancı anahtarları varlıkların mevcut olduğunu doğruluyor. Birlikte aynı işletmeye ait olduklarını doğrulayan bileşik kısıt yok. Not yazıcısı olağan girişte işletmeyi kontrol ediyor. Veritabanı kısıtları arka plan işleri ve ilerideki yazıcılar için ikinci katman sağlar. `prisma/migrations/99_internal_note_semantic_reading/migration.sql:68`
* Dışa aktarma ve geri yükleme. Tam işletme dökümü paralel ve sayfalanmamış okumalarla hazırlanıp bellekte tek JSON’a çevriliyor. Büyük işletmeler için sınırlandırılmış arka plan işi, tutarlı anlık görüntü ve kısa ömürlü indirme uygun. Yedekten geri dönüş provası, silme kayıtlarının önce yeniden uygulanmasını ve yetkili kontrolden sonra trafiğin açılmasını kapsamalı. `src/lib/data-export.ts:74`, `src/app/api/account/export/route.ts:62`, `docs/DATA-RETENTION-ERASURE-DRAFT.md:63`

Gerçek üyelik yardımcıları üzerinde sentetik verilerle 11 çevrimdışı doğrulama geçti. Kapsam kimlik ve kuşak eşleşmesi, iptal, eski oturum uyumu ve işletme seçimiydi. Diğer bulgular kaynak incelemesine dayanıyor. codex yazdı tamamını

kodları opus 5.5 agentlarına yazdır ama bak bu turda çok hata yaptın beni hoşlandırmadı bu durum her opus 5.5 ajanın kodlarını sen incele arkada onlar çalışırken haiku ajanı koy hem öneri hemde kodda riskleri ona söylesin en sonda sen didik didik kontroller sağla revize isteyebilirsin önce doğrulasınlar.

---

## Madde numaraları (ana oturum; atıf için — kurucunun metni DEĞİL)

| # | Konu | Paket |
|---|---|---|
| K1 | Kuyruk sağlığı: işletme başına gecikme başka işletmenin taze işiyle örtülüyor; sorgu hatasında `200 queue=unknown` (+ strict 200) | B |
| K2 | Sohbet ekranı taslak seçimi: eşit zaman damgasında sıra (`createdAt` ↔ `createdAt,id`); 30 sn'de tam yeniden okuma, sayfalama | E |
| K3 | Senkron döngüsü: kilit yalnız işletmeler arasında yenileniyor (15 dk'yı aşan işletme → ikinci kopya); seri işleme / öncelik ayrımı | B |
| K4 | İkinci kopya öncesi operasyon hazırlığı (tek migration işi, ayrı çalışanlar, bağlantı tavanı, dış izleme, geri yükleme provası) | tasarım |
| K5 | Hesap silme, aboneliğe bağlanmamış ödemeyi (bekleyen ödeme + onay kaydı) korumuyor | A |
| K6 | Ödeme kurtarma aynı 1.000 kayıtta kalıyor; tam 1.000'de sahte sınır alarmı | A |
| K7 | E-posta kuyruğu: tek satırın arızası sonraki kurtarmaları (ve harici cron'da normal gönderimi) kesiyor | B |
| K8 | Misafir silme commit olduktan sonra 500; yeniden deneme ikinci denetim kaydı | D |
| K9 | Ödeme uzlaştırması 0 satır güncellese de "fulfilled" dönebiliyor | A |
| K10 | QR: PIN değişimi cihaz bağını iptal etmiyor; sıkılaşan politika eski cihazı kabul ediyor; Wi-Fi koşulu cihaz doğrulamasına bağlı değil | C1 |
| K11 | Görsel doğrulama yalnız dosya başlığı (bozuk görüntü kabul; EXIF/GPS duruyor) | C1 |
| K12 | `cross-tenant-coverage.test.ts` Windows yolunda 3 / 5 kırmızı | E |
| K13 | Hospitable OAuth token isteğinde yönlendirme politikası yok (sır yönlendirmeyle taşınabilir) | C2 |
| K14 | WhatsApp webhook: ekip olayları ev sahibinin "bildirimden çık" işleminden önce bekleniyor | C2 |
| K15 | Takvim senkronu: DNS çözümlemesi 15 sn ağ süresinin dışında; elle senkron tek istekte sırayla | C2 |
| K16 | Operatör paneli son 50 demo talebi (sayfalama / durum filtresi yok); iCal başlığı dahili mülk adını yayımlıyor | C2 |
| K17 | `BILLING_ENFORCED=true` + Paddle webhook anahtarı eksik → açılış geçiyor, webhook 200 dönüp işlemiyor | E |
| K18 | Açılış betiği: zayıf sır / kapalı parola kuyruğu / cron sırrı yok / Turnstile anahtarı eksik yalnız uyarı | E |
| K19 | Dockerfile: migration ortam doğrulamasından önce | E |
| K20 | Ölçek (K3 ile aynı kök): kiracı başına iş, bağımsız işçi, kuyruk yaşı | tasarım |
| K21 | CSP betik kuralı yalnız rapor modunda; sürümlü şifreleme anahtarı | tasarım |
| K22 | Misafir silme ile eşzamanlı yazım: iç not / gecikmiş model sonucu silmeden SONRA yeniden yazılabiliyor | D |
| K23 | Çok işletmeli üyelik: WhatsApp yetkisi ve hesap silmenin son kontrolü `User` satırındaki ana işletme / rolü kullanıyor | D |
| K24 | Hesap silmede ödeme olayı anonimleştirmesi `custom_data.organizationId` eşleşmesini yeterli sayıyor | A |
| K25 | Migration 99: aynı işletme bileşik kısıtı yok | tasarım (migration) |
| K26 | Tam dışa aktarma sayfalanmamış / bellekte tek JSON; geri yükleme provası | tasarım |

## Uygulama durumu

26 maddenin hepsi ÇALIŞTIRILARAK doğrulandı (altı Opus 5.5 ajanı yazdı; her birinin yanında Haiku risk taraması; ana oturum her diff'i
okudu ve testleri kendi veritabanında yeniden koştu; iki Haiku dar incelemesi). Paket notları: `docs/INCELEME-2026-11-25-k27-{A,B,C1,C2,D,E}.md`.

| # | Hüküm | Sonuç |
|---|---|---|
| K1 | Kısmen | Strict gövdede yeni `delayed` (200); normal yoklama ve `stalled` aynı; `unknown` → 503 SORU |
| K2 | Doğru | Sohbet ekranı `(createdAt, id)`; "son 50 mesaj + daha eski" SORU |
| K3 | Doğru | Kilit işletme içi aşama sınırlarında da yenilenir; kayıpta kalan aşamalar koşmaz; tek aşamanın 15 dk'yı aşması SORU |
| K4, K20, K21 | — | Tasarım notu (B ve E belgelerinde) |
| K5 | Doğru | Sonuçlanmamış ödemede hesap silme 409 ile bekletilir; metin kurucu onaylı |
| K6 | Doğru | Ödeme süpürgesi kalıcı imleçle sürer, başa sarar; sınır alarmı yalnız gerçekten fazla kayıtta |
| K7 | Doğru | E-posta kurtarmasında satır hatası satırda kalır; kurtarma ve gönderim bağımsız |
| K8 | Doğru | Silme tekrarında ikinci denetim kaydı yok; doğrulama arızasında 503 + `erased: true`; ekran metni SORU |
| K9 | Kısmen | Ana yol (11-25 sabah) zaten doğruydu; uzlaştırma teşhisi kaydın son durumundan |
| K10 | Doğru | Kod değişince / "kod iste" açılınca eski cihaz bağı silinir; Wi-Fi yalnız güncel kodla bağlanmış cihaza (kurucu kararı) |
| K11 | Doğru | Görsel yapısı denetlenir (bağımlılıksız) + piksel tavanı; EXIF / GPS SORU |
| K12 | Doğru | Dört yapısal testte yol ayracı normalleştirildi |
| K13 | Doğru | OAuth token isteğinde `redirect: "error"`; kesin ana makine listesi SORU |
| K14 | Doğru | WhatsApp webhook'unda ev sahibi işleyicisi önce |
| K15 | Doğru | DNS ön kontrolü tek toplam süre içinde; elle senkron SORU |
| K16 | Doğru | Demo talepleri süzgeç + sayfa; iCal başlığı SORU (UID'ye dokunulmaz) |
| K17 | Doğru | `BILLING_ENFORCED` + webhook anahtarı eksik → açılış HATA (kurucu kararı) |
| K18 | Doğru, bilinçli | Uyarılar kaldı; CRON_SECRET başka sırla aynıysa yeni uyarı |
| K19 | Doğru | Dockerfile: ortam kontrolü → migration → başlat |
| K22 | Doğru (daha geniş) | İç not + anlam okuması yazıcıları silinmiş konaklamaya yazmaz; gölge aday sorguları seçmez; öteki yazıcılar listede (ikinci adım) |
| K23 | Kısmen | Bugün istismar edilemiyor; WhatsApp yetkisi + hesap silme artık üyelik satırından |
| K24 | Savunma | Sunucu bağı başka işletmeyi gösteren ödeme olayı silmede budanmaz |
| K25, K26 | Doğru | Tasarım notu + SORU (migration yazılmadı) |

Migration YOK, yeni ortam anahtarı YOK, yeni bağımlılık YOK. Sorular: `docs/claude/acik-isler.md` "11-25 (3)".

## Kurucu cevapları — 25 Kasım gece (AYNEN)

Kurucu: "CI izni için bana istek gönderme onun kontrolu için iznin hep var remote control için mi ne salak gibi bana sorma izin isteme
bunun için ve bana soruların varsa sor gece moduna gireceksin bu sorulardan sonra"

- **Silme ekranı metni (K5):** Silmeye özgü metin (Önerilen) — "Bekleyen bir ödemeniz var. Ödeme sonuçlanınca hesabınızı silebilirsiniz;
  acil ise bize yazın." (üç durumda da).
- **QR PIN (K10):** Yeniden PIN sorulsun (Önerilen) — PIN değişince de, PIN sonradan zorunlu yapılınca da eski telefon yeni PIN'i girmek
  zorunda; girene kadar Wi-Fi gibi bilgiler verilmez.
- **Açılış kontrolü (K17):** Açılış dursun (Önerilen) — `BILLING_ENFORCED` açık + Paddle webhook anahtarı eksik birleşiminde uygulama
  açılmaz; öteki zayıf ayarlar uyarı olarak kalır (liste sabah raporunda).
- **Migration:** Evet, yaz (Önerilen) — yalnız eklemeli ve güvenli olanlar (boş bırakılabilir alan / yeni tablo / dizin); dolu tabloya
  zorunlu alan ya da tekil kısıt yok; hepsi sabah raporunda listelenir.
- **İzinler:** CI kontrolü, hatırlatıcı ve izleme araçları için kurucuya soru gitmez (`.claude/settings.json` listesi genişletildi).
- Gece modu: bu cevaplardan sonra soru sormadan ilerlenir; sorular sabah raporuna.
