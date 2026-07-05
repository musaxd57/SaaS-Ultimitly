import type { Metadata } from "next";
import { SELLER, LEGAL_LAST_UPDATED } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Mesafeli Satış Sözleşmesi",
  description: "Lixus AI ücretli aboneliklerine ilişkin, 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında mesafeli satış sözleşmesi.",
};

interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Taraflar",
    body: [
      `SATICI — Ünvan: ${SELLER.unvan}; Adres: ${SELLER.adres}; MERSİS/Vergi: ${SELLER.mersisVergi}; Telefon: ${SELLER.telefon}; E-posta: ${SELLER.eposta}.`,
      "ALICI — Hizmeti ücretli bir plan satın alarak kullanan; hesap kaydında belirttiği ad, adres ve iletişim bilgileri esas alınan gerçek veya tüzel kişi.",
    ],
  },
  {
    title: "2. Tanımlar",
    list: [
      "Hizmet: Lixus AI yazılım (SaaS) aboneliği ve sunduğu özellikler.",
      "Mesafeli Sözleşme: Tarafların fiziksel olarak bir araya gelmeksizin, elektronik ortamda kurduğu işbu sözleşme.",
      "Yönetmelik: Mesafeli Sözleşmeler Yönetmeliği.",
      "Kanun: 6502 sayılı Tüketicinin Korunması Hakkında Kanun.",
    ],
  },
  {
    title: "3. Sözleşmenin Konusu",
    body: [
      "İşbu sözleşmenin konusu, ALICI’nın elektronik ortamda sipariş verdiği, aşağıda nitelikleri ve bedeli belirtilen Lixus AI yazılım hizmeti aboneliğinin satışı ve ifasına ilişkin tarafların hak ve yükümlülüklerinin, Kanun ve Yönetmelik uyarınca belirlenmesidir.",
    ],
  },
  {
    title: "4. Hizmetin Nitelikleri ve Bedeli",
    body: [
      "Lixus AI, kısa dönem kiralama işletmeleri için misafir mesajlarını yapay zekâ ile yanıtlayan ve operasyon takibi sağlayan bir SaaS hizmetidir. Tüm planlar, satın alma anında fiyatlandırma sayfasında gösterilen aylık (veya yıllık) bedel üzerinden ücretlendirilir.",
      "İlan edilen fiyatlara vergiler dâhildir; ödeme adımında tahsil edilecek toplam tutar vergiler dâhil olarak gösterilir. Yeni hesaplara, ödeme öncesi 14 gün ücretsiz Pro denemesi sunulur.",
    ],
  },
  {
    title: "5. Sözleşme Süresi ve Yenilenme",
    body: [
      "Abonelik, seçilen dönem için geçerlidir ve ALICI iptal etmediği sürece dönem sonunda aynı koşullarla otomatik olarak yenilenir. ALICI, aboneliğini dilediği zaman iptal edebilir; iptal, içinde bulunulan dönemin sonunda yürürlüğe girer.",
    ],
  },
  {
    title: "6. Ödeme Şekli",
    body: [
      "Abonelik bedeli, anlaşmalı ödeme hizmeti sağlayıcısı (Paddle) altyapısı üzerinden kredi/banka kartı ile tahsil edilir; Paddle satış işleminde kayıtlı satıcı (Merchant of Record) olarak yer alabilir. Kart bilgileri SATICI tarafından saklanmaz.",
    ],
  },
  {
    title: "7. İfa Şekli ve Süresi",
    body: [
      "Hizmet dijitaldir ve elektronik ortamda ifa edilir. Ödemenin onaylanmasının ardından ilgili plan özelliklerine erişim derhal açılır; fiziksel bir teslimat söz konusu değildir.",
    ],
  },
  {
    title: "8. ALICI’nın Beyan ve Yükümlülükleri",
    list: [
      "Kayıt ve ödeme sırasında verdiği bilgilerin doğru olduğunu beyan eder.",
      "Hesap güvenliğinden ve giriş bilgilerinin gizliliğinden sorumludur.",
      "Hizmeti yasalara ve bağlı platformların kurallarına uygun kullanır.",
      "AI tarafından oluşturulan yanıtların taslak/destek niteliğinde olduğunu; misafir ilişkileri, iade, iptal, hasar, güvenlik, yasal yükümlülükler ve platform kuralları bakımından nihai sorumluluğun kendisine ait olduğunu kabul eder.",
      "Otomatik yanıt özelliğini kullanmadan önce bilgi tabanındaki bilgilerin doğru, güncel ve yeterli olduğunu kontrol etmekle yükümlüdür; eksik veya hatalı bilgi tabanı nedeniyle oluşabilecek yanlış yönlendirmelerden sorumludur.",
      "Airbnb, Booking.com ve benzeri bağlı platformların kullanım şartlarına, mesajlaşma kurallarına, spam politikalarına, ödeme/rezervasyon kurallarına ve ayrımcılık karşıtı politikalarına uygun davranmakla yükümlüdür.",
      "İşbu sözleşmeyi, Ön Bilgilendirme Formu’nu, Kullanım Koşulları’nı ve Gizlilik Politikası’nı okuyup kabul ettiğini beyan eder.",
    ],
  },
  {
    title: "9. SATICI’nın Hak ve Yükümlülükleri",
    body: [
      "SATICI, Hizmeti işbu sözleşme ve eklerine uygun şekilde sunmayı taahhüt eder. SATICI, Hizmeti kesintisiz sunmayı hedefler; ancak planlı bakım, güncelleme, mücbir sebep ve üçüncü taraf sağlayıcı kaynaklı kesintilerden sorumlu tutulamaz. Yapay zekâ çıktıları hatalı olabilir; gönderilen mesajlara ilişkin nihai sorumluluk ALICI’ya aittir (ayrıntı için Kullanım Koşulları).",
      "SATICI (Lixus AI); platform dışı ödeme, hukuka aykırı ayrımcılık, güvenlik riski, kötüye kullanım, spam benzeri kullanım, aşırı/uygunsuz otomasyon veya bağlı platformların kurallarını ihlal eden kullanımlar için Hizmeti sınırlandırabilir, askıya alabilir veya ilgili otomasyonları kapatabilir.",
      "Airbnb, Booking.com, Hospitable, Paddle, OpenAI, Resend veya diğer üçüncü taraf sağlayıcılardan kaynaklanan kesinti, erişim kısıtı, API değişikliği, hesap/ilan sınırlaması, spam etiketi, mesaj teslim problemi veya platform politikası değişikliklerinden SATICI sorumlu değildir. SATICI yalnızca kendi yazılım hizmetinin makul şekilde çalışması için gerekli teknik önlemleri alır.",
      "ALICI, platformlar tarafından verilen spam, kalite, görünürlük, hesap, ilan veya politika kararlarının SATICI tarafından verilmediğini; bu kararların ilgili platformların kendi sistemleri ve ALICI’nın kullanım biçimiyle ilişkili olabileceğini kabul eder.",
      "Platformların spam, kalite, güvenlik veya politika etiketlemeleri; ALICI’nın mesaj içerikleri, gönderim sıklığı, platform kurallarına uyumu ve ilgili platformların kendi algoritma/kararlarına bağlıdır. SATICI yalnızca teknik destek ve otomasyon aracı sağlar; SATICI’dan kaynaklanan açık teknik hata hariç olmak üzere, platformların hesap, ilan, mesaj veya spam sınıflandırmalarına ilişkin nihai sorumluluk ALICI’ya aittir.",
    ],
  },
  {
    title: "10. Cayma Hakkı",
    body: [
      "ALICI, kural olarak sözleşmenin kurulduğu tarihten itibaren 14 gün içinde gerekçe göstermeksizin cayma hakkına sahiptir. Cayma bildirimi, yukarıdaki e-posta adresine açık bir beyanla yapılabilir.",
    ],
  },
  {
    title: "11. Cayma Hakkının İstisnaları",
    body: [
      "Yönetmeliğin 15. maddesi uyarınca; ALICI’nın onayı ile ifasına başlanan, elektronik ortamda anında ifa edilen hizmetlere ilişkin sözleşmelerde cayma hakkı kullanılamaz. ALICI, ücretli planı satın alıp Hizmeti kullanmaya başlamakla bu hizmetin anında ifasına onay vermiş sayılır ve bu hâlde cayma hakkının sona erebileceğini kabul eder. Bu nedenle ücretsiz deneme süresi sunulmaktadır.",
    ],
  },
  {
    title: "12. Kişisel Verilerin Korunması",
    body: [
      "Tarafların kişisel verilere ilişkin hak ve yükümlülükleri, Gizlilik Politikası ve KVKK Aydınlatma Metni’nde düzenlenmiştir ve işbu sözleşmenin ayrılmaz parçasıdır.",
    ],
  },
  {
    title: "13. Mücbir Sebep",
    body: [
      "Doğal afet, salgın, savaş, siber saldırı, altyapı/iletişim kesintileri ve kamu otoritesi kararları gibi tarafların makul kontrolü dışındaki hâller mücbir sebep sayılır. Mücbir sebep süresince yükümlülükler askıya alınır ve bu sebeplerden doğan gecikme veya ifa edememeden taraflar sorumlu tutulamaz.",
    ],
  },
  {
    title: "14. Temerrüt Hâli",
    body: [
      "ALICI’nın ödeme yükümlülüğünü yerine getirmemesi hâlinde, SATICI ilgili plan özelliklerine erişimi askıya alabilir veya sözleşmeyi feshedebilir. Tüketici mevzuatının emredici hükümleri saklıdır.",
    ],
  },
  {
    title: "15. Bildirimler ve Delil Sözleşmesi",
    body: [
      "Taraflar arası bildirimler, hesap kaydındaki e-posta adresi üzerinden yapılır. ALICI, işbu sözleşmeden doğabilecek uyuşmazlıklarda SATICI’nın elektronik kayıtlarının (sistem ve işlem kayıtları, e-posta yazışmaları) geçerli, bağlayıcı ve kesin delil teşkil edeceğini kabul eder; bu madde HMK m.193 anlamında delil sözleşmesidir.",
    ],
  },
  {
    title: "16. Uyuşmazlıkların Çözümü",
    body: [
      "İşbu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca ilan edilen parasal sınırlar dâhilinde ALICI’nın yerleşim yerindeki Tüketici Hakem Heyetleri ile Tüketici Mahkemeleri yetkilidir.",
    ],
  },
  {
    title: "17. Yürürlük",
    body: [
      "ALICI’nın elektronik ortamda ödemeyi onaylaması ile işbu sözleşme (16 maddeden oluşan asıl metin ve ekleri ile birlikte) kurulmuş ve yürürlüğe girmiş sayılır. Sözleşmenin bir örneği ALICI’ya elektronik ortamda sunulur.",
    ],
  },
];

export default function DistanceSalesPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Mesafeli Satış Sözleşmesi</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LEGAL_LAST_UPDATED}</p>
      </header>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-amber-700">
        ⚠️ <strong>Taslak:</strong> Bu sözleşme bir başlangıç şablonudur. Köşeli parantezli
        [alanları] kendi işletme bilgilerinizle doldurun ve ödemeleri açmadan önce bir
        hukuk danışmanına inceletin.
      </div>

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
