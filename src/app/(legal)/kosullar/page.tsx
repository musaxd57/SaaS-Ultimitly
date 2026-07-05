import type { Metadata } from "next";
import { SELLER, LEGAL_LAST_UPDATED } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Kullanım Koşulları",
  description: "Lixus AI yazılım hizmetinin kullanımına ilişkin kullanım koşulları ve kullanıcı sözleşmesi.",
};

const CONTACT = "iletisimlixusai@gmail.com";

interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Taraflar ve Hizmet Sağlayıcı",
    body: [
      `Bu Kullanım Koşulları (“Koşullar”), Lixus AI hizmetini sunan ${SELLER.unvan} (“Lixus AI”, “biz”) ile hizmeti kullanan gerçek veya tüzel kişi (“Müşteri”, “siz”) arasındaki ilişkiyi düzenler. Hizmete kaydolarak veya hizmeti kullanarak bu Koşulları okuduğunuzu ve kabul ettiğinizi beyan edersiniz.`,
    ],
  },
  {
    title: "2. Tanımlar",
    list: [
      "Hizmet: Lixus AI web sitesi ve yazılım uygulaması ile sunulan tüm özellikler.",
      "Hesap: Müşteri’nin Hizmet’e erişmek için oluşturduğu kullanıcı/organizasyon kaydı.",
      "Misafir: Müşteri’nin işletmesinde konaklayan veya iletişim kuran üçüncü kişi.",
      "Abonelik: Müşteri’nin seçtiği ücretli plan kapsamındaki kullanım hakkı.",
    ],
  },
  {
    title: "3. Hizmetin Tanımı",
    body: [
      "Lixus AI, kısa dönem kiralama (Airbnb, Booking.com vb.) işletmeleri için misafir iletişimini yapay zekâ ile yöneten; görev, giriş/çıkış ve operasyon takibi sağlayan bir yazılım (SaaS) hizmetidir. Özellikler zaman zaman geliştirilebilir, değiştirilebilir veya kaldırılabilir.",
    ],
  },
  {
    title: "4. Uygunluk, Hesap ve Sorumluluk",
    body: [
      "Hizmeti kullanabilmek için 18 yaşını doldurmuş olmanız ve bir işletme adına işlem yapma yetkinizin bulunması gerekir. Kayıt sırasında verdiğiniz bilgilerin doğru ve güncel olduğunu taahhüt edersiniz.",
      "Hesabınızın ve giriş bilgilerinizin güvenliğinden siz sorumlusunuz. Güçlü bir şifre kullanmanızı ve iki adımlı doğrulamayı (2FA) etkinleştirmenizi öneririz. Hesabınız üzerinden gerçekleştirilen işlemlerden siz sorumlu olursunuz; yetkisiz bir kullanım fark ederseniz bizi bilgilendirmelisiniz.",
    ],
  },
  {
    title: "5. Ücretsiz Deneme",
    body: [
      "Kayıt sırasında, kredi kartı bilgisi alınmaksızın belirli bir süre (varsayılan 14 gün) ücretsiz deneme sunulabilir. Deneme süresi sonunda ücretli bir plana geçmemeniz hâlinde hesabınız tamamen kapatılmaz; ancak otomatik mesajlaşma gibi ücretli özellikler devre dışı kalabilir ve panellerinizi yalnızca okuma/manuel kullanım amacıyla görüntülemeye devam edebilirsiniz. Deneme koşulları zaman zaman güncellenebilir.",
    ],
  },
  {
    title: "6. Abonelik, Ücretlendirme ve Ödeme",
    body: [
      "Hizmet, seçtiğiniz abonelik planına göre ücretlendirilir. Güncel planlar ve fiyatlar web sitesinde yayımlanır. Ödemeler, kayıtlı ödeme hizmet sağlayıcısı (Paddle) aracılığıyla alınır; Paddle, satış işleminde Merchant of Record (kayıtlı satıcı) olarak yer alabilir ve uygulanabilir vergileri tahsil edebilir.",
      "Abonelik, iptal edilmediği sürece dönem sonunda otomatik olarak yenilenir. Fiyatlarda yapılacak değişiklikler, yürürlüğe girmeden önce makul biçimde bildirilir ve bir sonraki yenileme döneminde uygulanır.",
    ],
  },
  {
    title: "7. İptal ve Cayma Hakkı",
    body: [
      "Aboneliğinizi dilediğiniz zaman sonlandırabilirsiniz; iptal, içinde bulunulan ödeme döneminin sonunda yürürlüğe girer ve takip eden dönem için ücret alınmaz. Tüketici sıfatıyla sahip olabileceğiniz cayma hakkı ve istisnaları, Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi’nde ayrıntılı olarak düzenlenmiştir; bu metinler işbu Koşulların ayrılmaz parçasıdır.",
    ],
  },
  {
    title: "8. Yapay Zekâ Yanıtları Hakkında",
    body: [
      "Hizmet, misafir mesajlarına yapay zekâ ile yanıt önerileri üretir ve ayarlarınıza göre güvenli bulunan bazı yanıtları otomatik gönderebilir. Yapay zekâ çıktıları hatalı, eksik veya bağlama uygunsuz olabilir; gönderilen mesajların içeriğine ilişkin nihai sorumluluk Müşteri’ye aittir.",
      "Şikayet, iade, iptal ve benzeri hassas/yüksek riskli konular güvenlik gereği otomatik gönderilmez; insan onayına bırakılır. Otomatik gönderimi dilediğiniz zaman kapatabilir, önizleme-onay modunu kullanabilir ve çalışma saatlerini belirleyebilirsiniz.",
    ],
  },
  {
    title: "9. Kabul Edilebilir Kullanım",
    body: ["Hizmeti kullanırken aşağıdakileri yapmamayı kabul edersiniz:"],
    list: [
      "Yasalara, üçüncü kişi haklarına veya genel ahlaka aykırı, yanıltıcı veya spam niteliğinde kullanım.",
      "Bağlı platformların (Airbnb, Booking.com vb.) kural ve koşullarını ihlal eden kullanım; bu platformların kurallarına uyum Müşteri’nin sorumluluğundadır.",
      "Hizmetin güvenliğini veya bütünlüğünü tehlikeye atacak, tersine mühendislik, izinsiz erişim, aşırı/otomatik yük bindirme gibi davranışlar.",
      "Hizmeti, izniniz olmayan kişilere ait verileri hukuka aykırı şekilde işlemek için kullanma.",
    ],
  },
  {
    title: "10. Üçüncü Taraf Entegrasyonları",
    body: [
      "Hizmet, misafir mesajlarına ve rezervasyon verilerine erişmek için üçüncü taraf kanal entegrasyon sağlayıcılarıyla (ör. Hospitable) ve OTA platformlarıyla (Airbnb, Booking.com) entegre olabilir. Bu sağlayıcıların kullanımı kendi koşullarına ve ücretlerine tabidir; söz konusu üçüncü taraf hizmetlerinin sürekliliği, doğruluğu veya maliyetlerinden Lixus AI sorumlu değildir.",
    ],
  },
  {
    title: "11. Müşteri İçeriği ve Veri İşleme (KVKK)",
    body: [
      "Misafirlerinize ait kişisel verilerin (ad, mesaj içeriği, rezervasyon bilgileri vb.) VERİ SORUMLUSU sizsiniz; Lixus AI bu verileri yalnızca size Hizmet sunmak amacıyla, talimatlarınız doğrultusunda VERİ İŞLEYEN sıfatıyla işler. Bu verilere ilişkin aydınlatma yükümlülüğü ve hukuki dayanak (gerektiğinde açık rıza) Müşteri’nin sorumluluğundadır.",
      "Hizmeti sağlamak için sınırlı sayıda alt-işleyen kullanırız (yapay zekâ için OpenAI; kanal erişimi için Hospitable; barındırma, e-posta ve ödeme altyapısı sağlayıcıları). Ayrıntılar Gizlilik Politikası ve KVKK Aydınlatma Metni’nde yer alır.",
      "Verileri yalnızca Hizmetin gerektirdiği süre boyunca saklarız. Belirli bir misafirin verisini panelinizden silebilir; hesabınızın kapatılmasını veya verilerinizin silinmesini talep edebilirsiniz. Bu durumda, yasal saklama yükümlülükleri saklı kalmak üzere ilgili verileri makul süre içinde siler veya anonimleştiririz.",
    ],
  },
  {
    title: "12. Fikri Mülkiyet",
    body: [
      "Lixus AI yazılımı, markası, tasarımı ve içeriğine ilişkin tüm fikri ve sınai haklar saklıdır. Hizmeti kullanmanız, size bu haklar üzerinde herhangi bir sahiplik vermez; yalnızca bu Koşullara uygun, kişiye özel, devredilemez ve sınırlı bir kullanım hakkı tanır. İşletmenize ait içerik ve veriler üzerindeki haklar ise size aittir.",
    ],
  },
  {
    title: "13. Hizmet Sürekliliği ve Bakım",
    body: [
      "Hizmeti kesintisiz, güvenli ve hatasız sunmayı hedefleriz; ancak Hizmet “olduğu gibi” ve “mevcut hâliyle” sunulur ve belirli bir kesintisizlik (uptime) garantisi verilmez. Planlı bakım, güncelleme veya zorunlu hâllerde Hizmet geçici olarak kesintiye uğrayabilir. Bağlı OTA platformlarının ve üçüncü taraf hizmetlerin erişilebilirliğini garanti edemeyiz.",
    ],
  },
  {
    title: "14. Sorumluluğun Sınırlandırılması",
    body: [
      "Yürürlükteki mevzuatın izin verdiği azami ölçüde; Hizmetin kullanımından veya kullanılamamasından doğan dolaylı, arızi, özel veya netice kabilinden zararlardan (kâr kaybı, veri kaybı, itibar kaybı dâhil) sorumlu değiliz. Her hâlükârda toplam sorumluluğumuz, talebin doğduğu olaydan önceki on iki (12) ayda tarafımıza ödediğiniz abonelik bedeli ile sınırlıdır. Bu sınırlamalar, tüketici mevzuatının emredici hükümlerini ortadan kaldırmaz.",
    ],
  },
  {
    title: "15. Tazminat",
    body: [
      "Hizmeti bu Koşullara, yürürlükteki mevzuata veya üçüncü kişi haklarına aykırı şekilde kullanmanızdan doğan ve tarafımıza yöneltilen talep, dava ve zararlara karşı Lixus AI’yi tazmin etmeyi ve savunmasız bırakmamayı kabul edersiniz.",
    ],
  },
  {
    title: "16. Mücbir Sebep",
    body: [
      "Doğal afet, salgın, savaş, siber saldırı, altyapı/iletişim kesintileri, kamu otoritesi kararları gibi makul kontrolümüz dışındaki olaylar nedeniyle yükümlülüklerimizi yerine getirememekten sorumlu tutulamayız.",
    ],
  },
  {
    title: "17. Askıya Alma ve Fesih",
    body: [
      "Bu Koşulları ihlal etmeniz, ödeme yükümlülüklerinizi yerine getirmemeniz veya Hizmetin güvenliğini tehlikeye atmanız hâlinde hesabınızı askıya alabilir veya sözleşmeyi feshedebiliriz. Siz de aboneliğinizi dilediğiniz zaman sonlandırabilirsiniz. Fesih hâlinde, niteliği gereği devam etmesi gereken hükümler (fikri mülkiyet, sorumluluk sınırlaması, tazminat vb.) yürürlükte kalır.",
    ],
  },
  {
    title: "18. Devir, Bölünebilirlik ve Bütünlük",
    body: [
      "Bu Koşullardan doğan hak ve yükümlülüklerinizi önceden yazılı onayımız olmaksızın devredemezsiniz. Koşulların herhangi bir hükmünün geçersiz sayılması, diğer hükümlerin geçerliliğini etkilemez. Bu Koşullar; Gizlilik Politikası, Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi ile birlikte taraflar arasındaki sözleşmenin bütününü oluşturur.",
    ],
  },
  {
    title: "19. Uygulanacak Hukuk ve Uyuşmazlık Çözümü",
    body: [
      "Bu Koşullar Türk hukukuna tabidir. Tüketici sıfatını haiz Müşteriler için, ilgili parasal sınırlar dâhilinde Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir. Diğer hâllerde doğacak uyuşmazlıklarda yetkili mahkeme ve icra daireleri genel hükümlere göre belirlenir.",
    ],
  },
  {
    title: "20. Değişiklikler",
    body: [
      "Bu Koşulları zaman zaman güncelleyebiliriz; güncel sürüm bu sayfada yayımlanır ve önemli değişiklikleri makul biçimde bildiririz. Değişikliklerin yürürlüğe girmesinden sonra Hizmeti kullanmaya devam etmeniz, güncel Koşulları kabul ettiğiniz anlamına gelir.",
    ],
  },
  {
    title: "21. İletişim",
    body: [`Sorularınız ve talepleriniz için ${CONTACT} adresinden bize ulaşabilirsiniz.`],
  },
];

export default function TermsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Kullanım Koşulları</h1>
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
