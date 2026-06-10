import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası ve KVKK Aydınlatma Metni",
  description: "Lixus AI gizlilik politikası ve KVKK kapsamında kişisel verilerin işlenmesine ilişkin aydınlatma metni.",
};

interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Veri Sorumlusu",
    body: [
      "Bu metin, Lixus AI (“biz”) tarafından, 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) kapsamında veri sorumlusu sıfatıyla hazırlanmıştır. İletişim: iletisimlixusai@gmail.com.",
    ],
  },
  {
    title: "2. İşlediğimiz Kişisel Veriler",
    body: ["Hizmetimizi sunarken aşağıdaki kişisel verileri işleyebiliriz:"],
    list: [
      "Hesap bilgileri: ad-soyad, e-posta adresi, şifre (şifrelenmiş olarak), rol.",
      "İletişim/demo talebi bilgileri: ad, e-posta, telefon ve ilettiğiniz mesaj.",
      "Hizmet kullanım verileri: işletmenize ait mülk, rezervasyon ve misafir mesajı verileri (bu verileri ev sahibi/işletme adına işleriz).",
      "Teknik veriler: oturum çerezi, IP adresi ve temel kullanım kayıtları (güvenlik ve hizmetin çalışması için).",
    ],
  },
  {
    title: "3. Kişisel Verilerin İşlenme Amaçları",
    list: [
      "Hizmeti sunmak, hesabınızı oluşturmak ve yönetmek.",
      "Misafir mesajlarına yapay zekâ destekli yanıt hazırlamak ve operasyonu yürütmek.",
      "Demo/iletişim taleplerinize dönüş yapmak.",
      "Güvenliği sağlamak, kötüye kullanımı önlemek ve yasal yükümlülükleri yerine getirmek.",
    ],
  },
  {
    title: "4. İşlemenin Hukuki Sebepleri",
    body: [
      "Kişisel verileriniz KVKK m.5 uyarınca; bir sözleşmenin kurulması veya ifası için gerekli olması, hukuki yükümlülüğümüzü yerine getirmemiz, meşru menfaatimiz ve gerektiğinde açık rızanız hukuki sebeplerine dayanılarak işlenir.",
    ],
  },
  {
    title: "5. Verilerin Aktarımı",
    body: [
      "Verileriniz, hizmetin sunulması için kullandığımız altyapı sağlayıcılarıyla sınırlı ölçüde paylaşılabilir: barındırma, e-posta gönderimi, yapay zekâ ile mesaj yanıtlama (OpenAI) ve Airbnb/Booking mesajlarına erişim için kullandığımız kanal entegrasyon aracıları. Bu sağlayıcıların bir kısmı yurt dışında bulunabileceğinden, veri aktarımı KVKK’nın ilgili hükümlerine uygun şekilde gerçekleştirilir. Verilerinizi pazarlama amacıyla üçüncü kişilere satmayız.",
    ],
  },
  {
    title: "6. Saklama Süresi",
    body: [
      "Kişisel verilerinizi, işleme amacının gerektirdiği süre boyunca ve ilgili mevzuatta öngörülen yasal saklama süreleri kadar saklarız. Süre sona erdiğinde verileriniz silinir, yok edilir veya anonim hâle getirilir.",
    ],
  },
  {
    title: "7. Veri Güvenliği",
    body: [
      "Verilerinizi korumak için makul teknik ve idari tedbirleri uygularız: şifreler tek yönlü olarak saklanır, hassas anahtarlar (ör. kanal entegrasyon token’ları) şifrelenerek saklanır, oturumlar güvenli çerezlerle yönetilir ve isteğe bağlı iki adımlı doğrulama (2FA) sunulur.",
    ],
  },
  {
    title: "8. Çerezler",
    body: [
      "Yalnızca hizmetin çalışması için gerekli olan oturum çerezini kullanırız. Bu çerez, giriş yaptıktan sonra oturumunuzun açık kalmasını sağlar. Pazarlama/izleme amaçlı üçüncü taraf çerezi kullanmayız.",
    ],
  },
  {
    title: "9. KVKK Kapsamındaki Haklarınız",
    body: ["KVKK m.11 uyarınca veri sahibi olarak şu haklara sahipsiniz:"],
    list: [
      "Kişisel verilerinizin işlenip işlenmediğini öğrenme ve buna ilişkin bilgi talep etme.",
      "İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme.",
      "Eksik veya yanlış işlenmişse düzeltilmesini, şartlar oluşmuşsa silinmesini/yok edilmesini isteme.",
      "İşlemenin hukuka aykırı olması hâlinde zararın giderilmesini talep etme.",
    ],
  },
  {
    title: "10. İletişim",
    body: [
      "Haklarınızı kullanmak veya gizlilikle ilgili sorularınız için iletisimlixusai@gmail.com adresinden bize ulaşabilirsiniz. Talebinize en kısa sürede ve mevzuatta öngörülen süreler içinde yanıt veririz.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: Haziran 2026</p>
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
