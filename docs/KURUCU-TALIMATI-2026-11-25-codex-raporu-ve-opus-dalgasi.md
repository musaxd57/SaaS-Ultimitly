# Kurucu talimatı — 25 Kasım (AYNEN)

> Kurucunun mesajı aşağıda değiştirilmeden. İlk altı bölüm kurucunun aktardığı Codex raporu; son paragraf kurucunun kendi talimatı.
> Bu işte her dilimden ÖNCE bu dosya okunur. Uygulama durumu en altta.

G‑2, eski bir mesajı yeni gönderimin kanıtı sayabilir. Lixus’un belirsiz gönderimde önce kanal konuşmasına kendisinin bakması doğru. Ancak sağlayıcı mesaj kimliği yoksa kod, gönderim başlamadan iki dakika öncesine kadar görünen aynı metni de eşleştirebiliyor. Başka bir kayda bağlanmamış eski bir giriş mesajı eşleşirse, yeni kuyruk kaydı sent oluyor ve giriş mesajı gönderilmiş sayılıyor. Önerim: sağlayıcı kimliği kesin kanıt olsun; yalnız metin eşleşmesinde, mesajın denemeden önce zaten orada olmadığı gösterilemiyorsa durum belirsiz kalsın. Görünmüyor diye yeniden gönderilmesin  Diyelim ki Lixus saat 14:00’te «Anahtar kutusunun kodu 1234» mesajını kanala gönderdi. Kanalın yanıtı yolda koptu. İki ihtimal var: kanal mesajı aldı ama bize onayı ulaşmadı ya da kanal mesajı hiç almadı.
- Konuşmayı okuyunca aynı metni 13:59’da görürsek, bu 14:00’teki gönderimin kanıtı değil. Bugünkü kod, saat farkını tolere etmek için o eski mesajı da eşleşme adayı yapabiliyor. Benim itirazım buna.
- Konuşmayı okuyunca mesajı hiç görmezsek, bu da tek başına «kesin gitmedi» demek değil. Kanal mesajı kabul etmiş ama konuşma listesine henüz yansıtmamış olabilir. Bu anda yeniden gönderirsek misafire iki mesaj gidebilir.
Senin “Lixus konuşmaya kendi baksın” fikrin doğru. Benim önerim: Lixus önce kendi baksın, gerekirse yeniden okusun; yeni gönderime ait güvenilir kanıt bulursa «gönderildi» desin. Kanal açıkça «bu isteği kabul etmedim» diyorsa ve mesaj hâlâ güncelse yeniden göndermek ayrı bir karardır. İkisi de kanıtlanamıyorsa «teyit edilemedi» kalsın. Yani yeniden bakmak ile yeniden göndermek aynı şey değil. Bunun için her mesajdan önce kanal konuşmasını baştan okutmak da şart değil; varsa sağlayıcının mesaj kimliği veya güvenilir zaman/sıra bilgisi kullanılabilir.

2. Ödemede atomiklik neyi düzeltir?
Bugün Paddle ödemeyi doğruladıktan sonra Lixus iki ayrı yazım yapıyor: (1) Pro planını açıyor, (2) bekleyen ödeme kaydını kapatıyor. Birinci yazım başarılı olup ikinci sırada veritabanı bağlantısı koparsa, müşteri Pro’yu kullanabiliyorken içeride aynı ödeme hâlâ «plan bekliyor» görünebilir. Mevcut uzlaştırma bunu sonradan toparlayabiliyor. Bu senaryo müşteriden ikinci kez para çekildiği anlamına gelmez.

Benim önerim, Paddle’dan doğrulama geldikten sonra bu iki yerel yazımı tek işlemde yapmak: ikisi birlikte kaydedilsin veya ikisi de kaydedilmesin. Başarısız olursa müşteriden tekrar ödeme istemek yerine, aynı doğrulanmış ödeme yeniden işlensin. Bu öneri mantıklı ve kodda gördüğüm ayrışmayı gerçekten kapatır. Ama Paddle’ın para çekmesiyle Lixus’un plan açmasını tek bir atomik işlem yapmaz; dış sağlayıcıyla aradaki belirsizlik için kalıcı ödeme kaydı ve uzlaştırma yine gerekli.
G‑2 şüphesi doğrulandı. Eşleştirme kodunu doğrudan çalıştırdım: gönderimden bir dakika önce görünen, başka bir kayda bağlı olmayan aynı metni yeni gönderim için kanıt saydı. Kuyruk bu kanıtla yeni giriş mesajını gönderilmiş işaretleyebiliyor. Buna karşılık, kanalda mesaj görünmediğinde körlemesine tekrar gönderilmediğini sınayan entegrasyon testleri geçti. Yani sorun yeniden gönderme değil, eski mesajın yeni gönderimi doğrulaması.

Ödemedeki iki yazımın ayrışabildiği de testte görüldü. Abonelik yazıldıktan sonra bekleyen ödeme kaydını kapatma adımına hata verildiğinde, ilk yazım yerinde kalıyor. Sonraki abonelik olayı bekleyen kaydı kapatıyor. Toparlanma çalışıyor; iki yazımın tek işlem olmadığı da doğrulanıyor. Bu senaryoda ikinci tahsilat görülmedi.

Sorun, Lixus’un ilk ödemenin sonucunu öğrenmesine rağmen bazı durumlarda o sonucu kullanmaması.

Tam olarak ne oluyor? Müşteri dün açtığı ödeme ekranına bugün geri dönüyor. Lixus ilk kontrolde «henüz ödenmedi» görüyor ve eski işlemi kapatmaya çalışıyor. Tam o sırada müşteri eski ekrandan ödemeyi tamamlıyor. İptal reddediliyor ve Lixus’un ikinci sorgusu bu kez «ödendi» görüyor. Ama iptal yardımcısı ana akışa yalnızca «iptal edilemedi» bilgisini veriyor; «ödendi» bilgisini taşımıyor. 24 saat de dolmuşsa Lixus yeni ödeme ekranı açıyor. Bu, önceki «belki eski ekran hâlâ açıktır» ihtimalinden daha somut bir hata. İptal ve yeniden kontrol kodu

Bence doğru akış şu:
Paddle’ın doğruladığı durum	Lixus ne yapmalı?
Ödeme yok, eski işlem kapalı	Hemen yeni ödeme ekranı aç. 24 saat bekletme.
Ödeme yok, aynı paket için eski işlem hâlâ kullanılabilir	Aynı ödeme ekranına devam ettir. İkinci işlem oluşturma.
Ödeme alınmış	Yeni ödeme açma. Mevcut ödemeyi aboneliğe bağla.
Eski işlemin sonucu doğrulanamıyor	Kısa aralıklarla otomatik kontrol et. Sırf 24 saat doldu diye yeni tahsilat başlatma.

Yani 24 saat ödeme izni veren bir kural olmamalı. Müşteriyi bekletmemek için ilk tercih aynı işleme dönmek veya kapanış doğrulanınca hemen yeni işlem açmak. Yalnız Paddle işlem sonucunu söyleyemiyorsa, yanlış bir ikinci tahsilat riskine girmeden her durumda anında yeni ekran açmayı garanti edemeyiz. Paddle’ın dokümantasyonu da ödeme almaya hazır işlem ile iptal edilmiş işlemi ayrı durumlar olarak tanımlıyor. Paddle işlem durumları

Test sonucu: Gerçek Docker PostgreSQL üzerinde 128 test geçti, eklediğim iki sınır testi kaldı. Birinde eski işlem hâlâ ödeme almaya hazırken, diğerinde yeniden kontrolde ilk ödeme «ödendi» görünürken kod yeni işlem açtı. Paddle’ı taklit ettim; ikinci tahsilat yapıldığını değil, ikinci ödeme ekranının açıldığını doğruladım.

Operatörün hassas işlemlerinde taze 2FA yok. Müşterinin 2FA’sını sıfırlamak ve müşteri hesabına destek erişimi açmak operatör yetkisi gerektiriyor. Ama bu işlemler için operatörün az önce ikinci doğrulamayı yaptığı ayrıca kontrol edilmiyor. Hatırlanan cihazla açılmış oturum da MFA’lı kabul ediliyor. Bu bir 2FA atlatma bulgusu değil; mevcut bir operatör oturumu ele geçirilirse etkisini sınırlayan ek kapı eksik. Normal girişe sürtünme eklemeden, yalnız bu işlemler için kısa ömürlü ve işleme bağlı yeniden doğrulama isterdim. Müşterinin 2FA’sı kaldırılırken denetim kaydının zorunlu olması ise iyi; bunu sınayan test de geçti. 2FA sıfırlama · Destek erişimi

Şifre sıfırlamanın normal yanıtları eşit, ama kuyruk arızasında eşitlik bozulabilir. Kayıtlı ve kayıtsız adreslere normalde aynı yanıt döndüğü testten geçti. Ancak kayıtlı hesapta sıfırlama kaydı ve e-posta kuyruğu ayrı işlemlerde yazılıyor. Kuyruk yazımı tek başına düşerse kayıtlı adres hata alabilir, kayıtsız adres normal yanıt alabilir. Bu hem e-postası hiç kuyruğa alınmamış bir kayıt bırakabilir hem de o arıza sırasında hesap varlığına dair sinyal verebilir. Bu hata yolunu kodda gördüm; canlıda ölçmedim. İki yazımı tek transaction’a alır, genel yanıtı hesap varlığından bağımsız tutar ve arızayı operatöre bildirirdim. Sıfırlama kodu · OWASP rehberi

«Kod iste» ile «kodu doğrula» aynı IP kotasını paylaşıyor. Aynı ofis ya da ortak ağda çok sayıda istek olursa, elinde geçerli kodu olan müşteri bile geçici olarak şifresini sıfırlayamayabilir. Kod başına deneme sınırı zaten var. Kodu isteme ve doğrulama bütçelerini ayırır, genel yük sınırını korurdum. Girişteki günlük 2FA bütçesinde de benzer bir kod bulgusu var: kontrol ve hata sayımı ayrı, dolayısıyla eşzamanlılıkta günlük tavan kesin değil. Kısa vadeli ayrı sınır çalışıyor; bunu hesap ele geçirme olarak değerlendirmiyorum.

2. Ödeme Pilotundan Önce Belirsizliği Çöz
Önceki turdaki somut hata bu commit’te duruyor: 24 saat sınırında iptal sonrası sorgu «ödendi» görse bile bu bilgi kaybolabiliyor ve ikinci ödeme ekranı açılabiliyor. Normal işleyişi ağırlaştırmadan düzeltilebilir: işlem kapalıysa hemen yenisini aç; aynı işlem kullanılabiliyorsa ona devam ettir; para alındıysa mevcut ödemeyi bağla. Yalnız sonucun bilinmediği durumda yeni işlem açmadan tekrar doğrula. Bu, müşteriyi 24 saat bekletme kuralı değil; 24 saati ödeme kanıtı saymama kuralı. Gerçek ikinci tahsilat gözlemlemedim; bunu ödeme pilotundan önce gerçek Paddle sandbox’ta doğrularım.

3. AI’ya Anlama Esnekliği Ver, Yetkiyi Kodda Tut
En değerli ekleme bence daha uzun bir prompt değil, hassas işlemden hemen önce uygulanan ortak bir kontrol. Örneğin “giriş bilgisi gönder” kararı; doğru işletme, daire, geçerli konaklama, doğru alıcı ve bilgi sürümüyle bağlı olsun. Model düşünürken bunlardan biri değişirse eski cevap gitmesin. Güncel ve hâlâ yetkiliyse yeniden üretilebilsin. Kapı kodu gibi değerleri de mümkün olduğunda modelin metnine vermek yerine son kontrolden sonra sunucu yerleştirsin. Otopark veya havuz gibi normal sorulara yeni bir onay eklemeyelim
Burada kendi önerimi ayrıca sınadım: 60 sentetik kaynak verdiğimde mevcut denetim özeti 44’ünü sakladı. Bu kayıt teşhis için iyi, ama eksiksiz bir gönderim kanıtı değil. Gönderim kararı için ayrı, kısa ve eksiksiz bir kaynak-sürüm kaydı gerekir; ham misafir mesajını veya kapı kodunu yeniden saklamak gerekmez. İlk aşamada yalnız “ne giderdi, ne tutulurdu?” ölçülsün.

Acil durdurmanın kapsamı görünür olsun. Bugünkü kuyruk duraklatması doğrudan gönderimi durdurmuyor; QR’ın ayrı anahtarı var. Operatör hangi yolun durduğunu tek yerde görsün. Başlamış gönderimi «iptal edildi» diye göstermesin.

kodları opus 5.5'e yazdırt zorluları sen yaz her kodlarını kontrol et didik didik revize isteyebilirsin, sert ol o takılırsan kodları sen yazabilirsin codex yazdı bunları sende teğit edebiliyorsan et pcmde docker kurulu.

## Uygulama durumu

(dalga ilerledikçe doldurulur — her iddianın teyidi + ne yapıldı / ne soruya döndü: `docs/INCELEME-2026-11-25-codex-raporu.md`)
