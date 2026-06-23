import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kullanım Koşulları",
  description: "Lixus AI hizmetinin kullanımına ilişkin koşullar.",
};

interface Section {
  title: string;
  body: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Hizmetin Tanımı",
    body: [
      "Lixus AI, kısa dönem kiralama (Airbnb, Booking vb.) işletmeleri için misafir iletişimini yapay zekâ ile yöneten, görev ve operasyon takibi sağlayan bir yazılım hizmetidir. Bu koşullar, hizmeti kullanımınızı düzenler; hizmeti kullanarak bu koşulları kabul etmiş sayılırsınız.",
    ],
  },
  {
    title: "2. Hesap ve Sorumluluk",
    body: [
      "Hesabınızın güvenliğinden ve giriş bilgilerinizin gizliliğinden siz sorumlusunuz. Güçlü bir şifre kullanmanızı ve iki adımlı doğrulamayı (2FA) etkinleştirmenizi öneririz. Hesabınız üzerinden gerçekleştirilen işlemlerden siz sorumlu olursunuz.",
    ],
  },
  {
    title: "3. Yapay Zekâ Yanıtları Hakkında",
    body: [
      "Hizmet, misafir mesajlarına yapay zekâ ile yanıt önerileri üretir ve ayarlarınıza göre bazı yanıtları otomatik gönderebilir. Yapay zekâ çıktıları hatalı olabilir; nihai sorumluluk ev sahibine/işletmeye aittir. Şikayet, iade ve iptal gibi hassas konular güvenlik gereği otomatik gönderilmez, insan onayına bırakılır. Otomatik gönderimi dilediğiniz zaman kapatabilirsiniz.",
    ],
  },
  {
    title: "4. Kabul Edilebilir Kullanım",
    body: [
      "Hizmeti yasalara aykırı, yanıltıcı, spam veya üçüncü kişilerin haklarını ihlal eden şekilde kullanamazsınız. İlgili platformların (Airbnb, Booking vb.) kurallarına uymak sizin sorumluluğunuzdadır.",
    ],
  },
  {
    title: "5. Üçüncü Taraf Entegrasyonları",
    body: [
      "Hizmet, misafir mesajlarına erişmek için Airbnb/Booking kanal entegrasyon sağlayıcılarıyla entegre olur. Bu sağlayıcıların kullanımı kendi koşullarına ve ücretlerine tabidir; bu maliyetlerden Lixus AI sorumlu değildir.",
    ],
  },
  {
    title: "6. Ücretlendirme",
    body: [
      "Hizmet, seçtiğiniz abonelik planına göre ücretlendirilir. Güncel fiyatlar fiyatlandırma sayfasında yayımlanır. Aboneliğinizi dilediğiniz zaman sonlandırabilirsiniz; iptal, içinde bulunulan dönemin sonunda yürürlüğe girer.",
    ],
  },
  {
    title: "7. Fikri Mülkiyet",
    body: [
      "Lixus AI yazılımı, markası ve içeriğine ilişkin tüm haklar saklıdır. Hizmeti kullanmanız, size bu haklar üzerinde bir sahiplik vermez; yalnızca koşullara uygun bir kullanım hakkı tanır.",
    ],
  },
  {
    title: "8. Sorumluluğun Sınırlandırılması",
    body: [
      "Hizmet “olduğu gibi” sunulur. Yürürlükteki mevzuatın izin verdiği ölçüde, hizmetin kullanımından doğan dolaylı zararlardan sorumlu değiliz. Hizmeti kesintisiz ve hatasız sunmayı hedefleriz ancak bunu garanti etmeyiz.",
    ],
  },
  {
    title: "9. Veri İşleme ve KVKK (Veri İşleyen Sözleşmesi)",
    body: [
      "KVKK kapsamında, misafirlerinize ait kişisel verilerin (ad, mesaj içeriği, rezervasyon bilgileri vb.) VERİ SORUMLUSU sizsiniz; Lixus AI bu verileri yalnızca size hizmeti sunmak amacıyla, talimatlarınız doğrultusunda işleyen VERİ İŞLEYEN sıfatıyla hareket eder.",
      "Hizmeti sağlamak için sınırlı sayıda alt-işleyen kullanırız: yapay zekâ yanıtları için OpenAI, Airbnb/Booking kanal erişimi için entegrasyon sağlayıcısı (Hospitable), barındırma ve e-posta altyapısı sağlayıcıları. Bu kapsamda misafir mesaj içeriği, yanıt üretmek amacıyla yurt dışında (ör. ABD) bulunan yapay zekâ sağlayıcısına aktarılabilir; hizmeti kullanarak bu aktarımın hizmetin sunulması için gerekli olduğunu kabul edersiniz. API ile gönderilen veriler sağlayıcı tarafından model eğitiminde kullanılmaz.",
      "Verileri yalnızca hizmetin gerektirdiği süre boyunca saklarız; saklama süresi dolan misafir kişisel verileri anonimleştirilir ya da silinir. Hesabınızı sildiğinizde organizasyonunuza ait tüm veriler kalıcı olarak silinir. Belirli bir misafirin verisinin silinmesini de talep edebilirsiniz.",
      "Verileri korumak için makul teknik ve idari tedbirleri (şifreleme, erişim kontrolü, çok-kiracılı izolasyon) uygularız. Hizmete eklediğiniz misafir verileri için gerekli aydınlatma yükümlülüğü ve hukuki dayanak (gerektiğinde açık rıza) sizin sorumluluğunuzdadır.",
    ],
  },
  {
    title: "10. Değişiklikler ve Fesih",
    body: [
      "Bu koşulları zaman zaman güncelleyebiliriz; önemli değişiklikleri makul biçimde bildiririz. Koşulları ihlal etmeniz hâlinde hesabınızı askıya alabilir veya sonlandırabiliriz.",
    ],
  },
  {
    title: "11. İletişim",
    body: [
      "Sorularınız için iletisimlixusai@gmail.com adresinden bize ulaşabilirsiniz.",
    ],
  },
];

export default function TermsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Kullanım Koşulları</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: Haziran 2026</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
