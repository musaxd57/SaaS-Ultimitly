import type { Metadata } from "next";
import { SELLER, LEGAL_LAST_UPDATED } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Gizlilik Politikası ve KVKK Aydınlatma Metni",
  description:
    "Lixus AI gizlilik politikası ve 6698 sayılı KVKK kapsamında kişisel verilerin işlenmesine ilişkin aydınlatma metni.",
};

const CONTACT = "iletisimlixusai@gmail.com";

interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Giriş ve Kapsam",
    body: [
      "Bu Gizlilik Politikası ve Aydınlatma Metni, Lixus AI (“Lixus AI”, “biz”) tarafından sunulan web sitesi ve yazılım hizmetini (“Hizmet”) kullanmanız sırasında kişisel verilerinizin 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) ve ilgili mevzuat uyarınca nasıl işlendiğini açıklar.",
      "Hizmeti kullanan ev sahipleri/işletmeler (“Müşteri”) ile bu işletmelerin misafirlerine ait verileri birbirinden ayırt ederek işleriz. Müşterinin kendi misafirlerine ait verileri bakımından Lixus AI kural olarak “veri işleyen”, Müşteri ise “veri sorumlusu” konumundadır (bkz. Madde 4).",
    ],
  },
  {
    title: "2. Veri Sorumlusu ve İletişim",
    body: [
      `Hizmeti sunan ve bu metinde açıklanan işleme faaliyetlerinin veri sorumlusu: Lixus AI — Ünvan: ${SELLER.unvan}; Adres: ${SELLER.adres}; MERSİS/Vergi No: ${SELLER.mersisVergi}; Telefon: ${SELLER.telefon}.`,
      `Gizlilikle ilgili her türlü talep ve sorunuz için: ${CONTACT}`,
    ],
  },
  {
    title: "3. Tanımlar",
    list: [
      "Kişisel veri: Kimliği belirli veya belirlenebilir gerçek kişiye ilişkin her türlü bilgi.",
      "Özel nitelikli kişisel veri: Sağlık, din, etnik köken gibi KVKK m.6’da sayılan veriler. Hizmet bu tür verileri toplamayı amaçlamaz.",
      "İşleme: Verilerin elde edilmesi, kaydedilmesi, saklanması, aktarılması, silinmesi gibi her türlü işlem.",
      "Veri sorumlusu / veri işleyen: Verinin işlenme amaç ve vasıtalarını belirleyen kişi / veri sorumlusunun talimatıyla veri işleyen kişi.",
      "İlgili kişi: Kişisel verisi işlenen gerçek kişi.",
      "Açık rıza: Belirli bir konuya ilişkin, bilgilendirilmeye dayanan ve özgür iradeyle açıklanan onay.",
    ],
  },
  {
    title: "4. Rollerin Belirlenmesi (Veri Sorumlusu / Veri İşleyen)",
    body: [
      "Hesap sahibi Müşteri’ye ait veriler (ad-soyad, e-posta, abonelik vb.) bakımından Lixus AI veri sorumlusudur.",
      "Müşteri’nin Hizmet aracılığıyla işlediği misafir verileri (misafir adı, mesaj içeriği, rezervasyon bilgileri vb.) bakımından veri sorumlusu Müşteri’dir; Lixus AI bu verileri yalnızca Müşteri’ye Hizmet sunmak amacıyla, Müşteri’nin talimatı doğrultusunda veri işleyen sıfatıyla işler. Misafirlere yönelik aydınlatma yükümlülüğü ve hukuki dayanağın (gerektiğinde açık rıza) sağlanması Müşteri’nin sorumluluğundadır.",
    ],
  },
  {
    title: "5. İşlediğimiz Kişisel Veri Kategorileri",
    body: ["Hizmetin niteliğine göre aşağıdaki veri kategorilerini işleyebiliriz:"],
    list: [
      "Kimlik ve iletişim verileri: ad-soyad, e-posta adresi, telefon (demo/iletişim formunda) ve işletme adı.",
      "Hesap ve güvenlik verileri: şifre (yalnızca tek yönlü özet/hash olarak), iki adımlı doğrulama (2FA) anahtarı (şifreli), e-posta doğrulama ve şifre-sıfırlama kodları (özet olarak), oturum bilgisi.",
      "Müşteri işlem verileri: işletmeye ait mülk, rezervasyon ve misafir mesajı içerikleri (Müşteri adına işlenir).",
      "Rezervasyon ve konaklama verileri: giriş-çıkış tarihleri, konaklama durumu, rezervasyon kaynağı, mülk adı, oda/daire bilgisi ve operasyon notları.",
      "Misafir iletişim verileri: misafir mesajları, host/AI yanıtları, konuşma geçmişi, yanıt durumu ve insan incelemesine bırakılma bilgileri.",
      "Bilgi tabanı ve operasyon verileri: Wi-Fi, giriş talimatları, otopark, çöp, ev kuralları, checkout talimatları ve Müşteri’nin panele eklediği mülk bilgileri.",
      "AI işlem verileri: AI taslak yanıtları, otomatik gönderim durumu, risk seviyesi, insan incelemesi sebebi, kullanılan bağlam ve eksik bilgi uyarıları.",
      "Entegrasyon verileri: Hospitable bağlantı durumu, senkronizasyon kayıtları, takvim/iCal bağlantıları, QR misafir sohbet bağlantıları ve teknik hata kayıtları.",
      "İşlem güvenliği verileri: IP adresi, oturum çerezi, temel kullanım/denetim kayıtları (audit log), hata kayıtları.",
      "Pazarlama/iletişim verileri: web sitesi üzerinden ilettiğiniz demo veya iletişim talebi ve mesaj içeriği.",
      "Ödeme verileri: abonelik ve fatura durumu. Kart/ödeme bilgileriniz tarafımızca tutulmaz; ödeme, kayıtlı ödeme hizmet sağlayıcısı (Paddle) tarafından işlenir.",
    ],
  },
  {
    title: "6. Kişisel Verilerin İşlenme Amaçları",
    list: [
      "Hizmeti sunmak; hesabınızı oluşturmak, doğrulamak ve yönetmek.",
      "Misafir mesajlarına yapay zekâ destekli yanıt hazırlamak ve operasyonu (görev, giriş/çıkış, raporlama) yürütmek.",
      "Misafir mesajlarını düşük, orta ve yüksek risk seviyelerine göre değerlendirmek; düşük riskli mesajlarda hızlı yanıt oluşturmak, orta riskli mesajlarda sakinleştirici ön-yanıt ve bilgi toplama desteği sağlamak, yüksek riskli mesajlarda yanıtı Müşteri’nin insan incelemesine bırakmak.",
      "Aboneliği ve faturalandırmayı yönetmek.",
      "Demo/iletişim taleplerine dönüş yapmak ve destek sağlamak.",
      "Bilgi ve hizmet güvenliğini sağlamak, kötüye kullanımı ve dolandırıcılığı önlemek.",
      "Yürürlükteki mevzuattan doğan yükümlülükleri yerine getirmek ve hukuki taleplere yanıt vermek.",
    ],
  },
  {
    title: "7. İşlemenin Hukuki Sebepleri",
    body: [
      "Kişisel verileriniz KVKK m.5 uyarınca; (i) bir sözleşmenin kurulması veya ifası için gerekli olması, (ii) hukuki yükümlülüğümüzün yerine getirilmesi, (iii) bir hakkın tesisi/kullanılması/korunması, (iv) temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaatlerimiz ve (v) gereken hâllerde açık rızanız hukuki sebeplerine dayanılarak işlenir. Açık rızaya dayalı işlemelerde rızanızı dilediğiniz zaman geri alabilirsiniz.",
    ],
  },
  {
    title: "8. Alt İşleyenler ve Üçüncü Taraflar",
    body: [
      "Hizmeti sunabilmek için aşağıdaki altyapı sağlayıcılarıyla (alt işleyenler) sınırlı ölçüde çalışırız. Alt işleyenlere yalnızca hizmetin sunulması için gerekli olan sınırlı veri aktarılır; kişisel veriler reklam, yeniden satış veya ilgisiz pazarlama amacıyla üçüncü kişilere satılmaz:",
    ],
    list: [
      "OpenAI (ABD) — misafir mesajlarına yapay zekâ ile yanıt hazırlanması. API üzerinden iletilen veriler, sağlayıcının taahhüdü gereği model eğitiminde kullanılmaz.",
      "Hospitable (yurt dışı) — Airbnb/Booking.com mesajlarına ve rezervasyon bilgilerine erişim için resmi kanal entegrasyon aracısı.",
      "Paddle (Merchant of Record, yurt dışı) — abonelik ve ödeme işlemlerinin yürütülmesi; kart verileri Paddle nezdinde işlenir.",
      "E-posta gönderim sağlayıcısı (Resend/SMTP) — doğrulama, şifre ve uyarı e-postalarının iletimi.",
      "Railway (barındırma, yurt dışı) — uygulama ve veritabanı sunucusu.",
      "Sentry (opsiyonel hata izleme) — uygulama hatalarının teşhisi.",
    ],
  },
  {
    title: "9. Yurt Dışına Aktarım",
    body: [
      "Yukarıdaki sağlayıcıların bir kısmı yurt dışında bulunduğundan, kişisel verileriniz hizmetin sunulması amacıyla yurt dışına aktarılabilir. Bu aktarımlar KVKK m.9 kapsamında, mevzuatın öngördüğü güvenceler (uygun hâllerde taahhütname/standart sözleşme ve gerektiğinde açık rıza) sağlanarak gerçekleştirilir. Kişisel verilerinizi pazarlama amacıyla üçüncü kişilere satmayız.",
    ],
  },
  {
    title: "10. Yapay Zekâ ile Otomatik İşleme",
    body: [
      "Hizmet, misafir mesajlarına yapay zekâ ile yanıt önerileri üretir ve ayarlarınıza göre güvenli bulunan bazı yanıtları otomatik gönderebilir. Şikayet, iade, iptal ve benzeri hassas/yüksek riskli mesajlar güvenlik gereği otomatik yanıtlanmaz; insan onayına bırakılır. Otomatik gönderim Müşteri tarafından açılır/kapatılır ve önizleme-onay modu kullanılabilir. Bu nedenle, hukuki sonuç doğuran nitelikte tamamen otomatik bir karar süreci yürütülmez; nihai sorumluluk ve denetim Müşteri’dedir.",
      "Sistem mesajları genel olarak üç risk seviyesinde ele alır: (i) Düşük risk — Wi-Fi, giriş talimatı, otopark, çöp, checkout ve temel ev kuralları gibi bilgi tabanı veya rezervasyon verisiyle desteklenen konular; uygun ayarlarda otomatik yanıtlanabilir. (ii) Orta risk — hafif şikayet, teknik aksaklık, eksik eşya, klima/ısıtma problemi gibi konular; sistem sakin bir ön-yanıt hazırlayabilir ve gerekirse tek bir ek bilgi veya fotoğraf isteyebilir. (iii) Yüksek risk — iade, iptal, kötü yorum tehdidi, platform dışı ödeme, güvenlik/acil durum, ayrımcılık, kural ihlali, hasar, depozito, ceza, hukuki iddia veya benzeri konular; bu mesajlar otomatik olarak sonuçlandırılmaz, Müşteri’nin incelemesine bırakılır ve Müşteri’ye görünür şekilde bildirilir.",
      "AI sistemi ödeme, iade, iptal, ceza, depozito, hukuki değerlendirme veya ayrımcılık içerebilecek kararları tek başına vermez.",
    ],
  },
  {
    title: "11. Kullanılan Bağlam ve Risk Etiketleri",
    body: [
      "Hizmet, AI yanıtlarının daha güvenli hazırlanması için ilgili konuşma, rezervasyon, bilgi tabanı ve mülk ayarlarını bağlam olarak kullanabilir. Panelde bazı yanıtlar için “kullandığı bağlam”, “eksik bilgi” veya “insan incelemesi gerekli” gibi açıklayıcı etiketler gösterilebilir.",
      "Bu etiketler, yanıtın neden otomatik gönderilmediğini veya hangi bilgilere dayanarak hazırlandığını açıklamak içindir; tek başına hukuki, finansal veya bağlayıcı karar anlamına gelmez.",
    ],
  },
  {
    title: "12. Saklama ve İmha",
    body: [
      "Kişisel verilerinizi yalnızca işleme amacının ve ilgili mevzuatın gerektirdiği süre boyunca saklarız. Süre sona erdiğinde verileriniz silinir, yok edilir veya anonim hâle getirilir.",
      "Belirli bir misafire ait verileri (rezervasyon/konuşma) panelinizden dilediğiniz zaman silebilirsiniz. Hesabınızı kapatma veya verilerinizin silinmesi talebinizi bize iletmeniz hâlinde, yasal saklama yükümlülükleri saklı kalmak üzere ilgili verileri makul süre içinde sileriz/anonimleştiririz.",
      "Misafir mesajları, rezervasyon bilgileri ve operasyon kayıtları; Müşteri’nin geçmiş konuşmaları görebilmesi, uyuşmazlıkları inceleyebilmesi ve operasyonel raporlama yapılabilmesi için sınırlı süreyle saklanabilir.",
      "Saklama süresi sona eren veya silme/anonimleştirme kapsamına giren kayıtlarda misafir adı, iletişim bilgileri ve tanımlayıcı veriler silinir veya anonim hâle getirilir. Daha önce anonimleştirilmiş kayıtların entegrasyon senkronizasyonu yoluyla yeniden kişisel veriyle doldurulmaması için teknik kontroller uygulanır.",
    ],
  },
  {
    title: "13. Ödeme Webhook’ları ve Finansal Kayıtlar",
    body: [
      "Ödeme ve abonelik işlemlerinde Paddle üzerinden gelen teknik webhook kayıtları; ödeme durumunun doğrulanması, abonelik geçmişinin tutulması, dolandırıcılık ve uyuşmazlıkların önlenmesi amacıyla saklanabilir. Hesap silme veya anonimleştirme işlemlerinde bu kayıtlar tamamen silinmeyebilir; ancak e-posta, ad-soyad, adres, telefon ve benzeri gereksiz kişisel veriler redakte edilerek yalnızca işlem kimliği, tarih, durum, tutar ve abonelik/fatura iskeleti korunur.",
    ],
  },
  {
    title: "14. Hata Raporlama ve Redaksiyon",
    body: [
      "Teknik hata kayıtları hizmet güvenliği ve sürekliliği için kullanılabilir. Hata raporlama sistemlerine gönderilen kayıtlarda yetkilendirme anahtarları, çerezler, erişim token’ları, e-posta, telefon, adres, kapı kodu, ödeme bilgisi ve benzeri hassas alanların maskelenmesi veya redakte edilmesi için teknik önlemler uygulanır.",
    ],
  },
  {
    title: "15. QR Misafir Sohbeti",
    body: [
      "Müşteri tarafından etkinleştirilmesi hâlinde, konaklayan misafirler QR bağlantısı üzerinden mülke ilişkin destek mesajı gönderebilir. Bu özellik yalnızca ilgili konaklama bağlamında hizmet vermek amacıyla kullanılır. QR sohbetinde verilen yanıtlar, Müşteri’nin bilgi tabanı ve konaklama bağlamına göre hazırlanır; hassas erişim bilgileri yalnızca sistem tarafından uygun bağlam doğrulandığında paylaşılır. Müşteri bu özelliği panelden açıp kapatabilir.",
    ],
  },
  {
    title: "16. Takvim ve iCal Paylaşımı",
    body: [
      "Müşteri’nin talebiyle rezervasyon/takvim bilgileri üçüncü taraf takvim uygulamalarına aktarılabilir. Takvim bağlantılarında hangi bilgilerin gösterileceği Müşteri ayarlarına ve ürün yapılandırmasına bağlıdır. Gerektiğinde misafir adı gibi kişisel veriler yerine “Rezerve” veya benzeri genel ifadeler kullanılabilir. Takvim bağlantılarının üçüncü kişilerle paylaşılması Müşteri’nin sorumluluğundadır.",
    ],
  },
  {
    title: "17. Müşteri’nin Yükümlülükleri",
    body: [
      "Müşteri; kendi misafirlerine karşı gerekli aydınlatma yükümlülüklerini yerine getirmekten, hizmete aktardığı verilerin hukuka uygunluğundan, bilgi tabanına eklediği içeriklerden, otomatik yanıt ayarlarını doğru kullanmaktan ve bağlı olduğu platformların kurallarına uygun hareket etmekten sorumludur.",
      "Müşteri, bilgi tabanına özel nitelikli kişisel veri, gereksiz kimlik/ödeme bilgisi, üçüncü kişilere ait gizli bilgi veya hukuka aykırı içerik eklememelidir. Kapı kodu, Wi-Fi, alarm, anahtar kutusu gibi hassas operasyon bilgileri yalnızca hizmetin gerektirdiği ölçüde kullanılmalıdır.",
    ],
  },
  {
    title: "18. Veri Güvenliği",
    list: [
      "Şifreler tek yönlü (hash) olarak saklanır; düz metin olarak tutulmaz.",
      "Kanal entegrasyon token’ları gibi hassas anahtarlar şifrelenerek saklanır.",
      "Çok kiracılı (multi-tenant) mimaride her işletmenin verisi mantıksal olarak izole edilir.",
      "Oturumlar güvenli çerezlerle yönetilir; isteğe bağlı iki adımlı doğrulama (2FA) sunulur.",
      "Erişim kontrolü, denetim kayıtları ve aktarımda şifreleme (TLS) uygulanır.",
    ],
  },
  {
    title: "19. Çerezler",
    body: [
      "Hizmetin çalışması için zorunlu birinci-taraf çerezlerini kullanırız: oturum çerezi (giriş sonrası oturumunuzun açık kalması), iki adımlı doğrulamada “bu cihazı hatırla” çerezi (en fazla 30 gün) ve Hospitable bağlantısı sırasında kullanılan güvenlik (state) çerezi. Pazarlama veya üçüncü taraf izleme çerezleri kullanmayız.",
    ],
  },
  {
    title: "20. KVKK Kapsamındaki Haklarınız",
    body: ["KVKK m.11 uyarınca ilgili kişi olarak şu haklara sahipsiniz:"],
    list: [
      "Kişisel verilerinizin işlenip işlenmediğini öğrenme; işlenmişse buna ilişkin bilgi talep etme.",
      "İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme.",
      "Yurt içinde veya yurt dışında verilerinizin aktarıldığı üçüncü kişileri bilme.",
      "Eksik veya yanlış işlenmişse düzeltilmesini isteme.",
      "Şartların oluşması hâlinde verilerinizin silinmesini veya yok edilmesini isteme.",
      "Düzeltme/silme işlemlerinin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme.",
      "İşlenen verilerin münhasıran otomatik sistemlerle analizi sonucu aleyhinize bir sonucun ortaya çıkmasına itiraz etme.",
      "Hukuka aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme.",
    ],
  },
  {
    title: "21. Başvuru Yöntemi ve Şikâyet",
    body: [
      `Haklarınızı kullanmak için taleplerinizi ${CONTACT} adresinden bize iletebilirsiniz. Başvurularınızı, niteliğine göre en kısa sürede ve her hâlde mevzuatta öngörülen süre (kural olarak otuz gün) içinde sonuçlandırırız.`,
      "Başvurunuzun reddedilmesi veya yanıtı yetersiz bulmanız hâlinde Kişisel Verileri Koruma Kurulu’na şikâyette bulunma hakkına sahipsiniz.",
    ],
  },
  {
    title: "22. Reşit Olmayanlar",
    body: [
      "Hizmet, işletmelere ve yetişkin kullanıcılara yöneliktir; çocuklara yönelik olarak tasarlanmamıştır ve bilerek çocuklardan kişisel veri toplamayız.",
    ],
  },
  {
    title: "23. Değişiklikler",
    body: [
      "Bu metni zaman zaman güncelleyebiliriz. Güncel sürüm bu sayfada yayımlanır; önemli değişiklikleri makul yöntemlerle bildirmeye özen gösteririz. Sayfanın altındaki güncelleme tarihini takip edebilirsiniz.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LEGAL_LAST_UPDATED}</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body?.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
          {s.list ? (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {s.list.map((li, i) => (
                <li key={i}>{li}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
