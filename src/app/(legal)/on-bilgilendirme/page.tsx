import type { Metadata } from "next";
import { SELLER } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Ön Bilgilendirme Formu",
  description: "Lixus AI ücretli aboneliklerine ilişkin ön bilgilendirme formu.",
};

interface Section {
  title: string;
  body: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Satıcı / Hizmet Sağlayıcı Bilgileri",
    body: [
      `Ünvan: ${SELLER.unvan}`,
      `Adres: ${SELLER.adres}`,
      `MERSİS / Vergi: ${SELLER.mersisVergi}`,
      `Telefon: ${SELLER.telefon}`,
      `E-posta: ${SELLER.eposta}`,
    ],
  },
  {
    title: "2. Hizmetin Temel Nitelikleri",
    body: [
      "Lixus AI, kısa dönem kiralama işletmeleri için misafir mesajlarını yapay zekâ ile yanıtlayan, görev ve operasyon takibi sağlayan bir yazılım (SaaS) hizmetidir. Hizmet, seçilen abonelik planına göre internet üzerinden sunulur.",
      "Planlar: Başlangıç (1–2 daire), Pro (3–7 daire) ve İşletme (8+ / sınırsız daire). Planların güncel fiyatları, içerikleri ve sınırları fiyatlandırma sayfasında belirtilir.",
    ],
  },
  {
    title: "3. Hizmet Bedeli ve Ödeme",
    body: [
      "Başlangıç dâhil tüm planlar, fiyatlandırma sayfasında belirtilen aylık bedel üzerinden ücretlendirilir; belirtilen fiyatlara KDV dâhildir. Yeni hesaplara, bir plan seçmeden önce 14 gün ücretsiz Pro denemesi sunulur.",
      "Ödemeler, anlaşmalı ödeme kuruluşu üzerinden kredi/banka kartı ile alınır. Abonelik, seçilen dönem (aylık) boyunca geçerlidir ve aksi belirtilmedikçe dönem sonunda yenilenir. Aboneliğinizi dilediğiniz zaman iptal edebilirsiniz; iptal, içinde bulunulan dönemin sonunda yürürlüğe girer.",
    ],
  },
  {
    title: "4. İfa ve Hizmete Erişim",
    body: [
      "Hizmet dijitaldir. Ödemenin onaylanmasının ardından ilgili plan özelliklerine erişim derhal sağlanır; ayrıca bir fiziksel teslimat yapılmaz.",
    ],
  },
  {
    title: "5. Cayma Hakkı",
    body: [
      "Mesafeli Sözleşmeler Yönetmeliği uyarınca tüketici, kural olarak 14 gün içinde gerekçe göstermeksizin cayma hakkına sahiptir. Ancak; tüketicinin onayı ile ifasına başlanan ve elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı bulunmamaktadır.",
      "Bu nedenle, ücretli bir plana geçip hizmeti kullanmaya başladığınızda (anında ifa) cayma hakkınız sona erebilir. Riski azaltmak için ücretli planları satın almadan önce ücretsiz deneme süresinden yararlanabilirsiniz.",
    ],
  },
  {
    title: "6. Şikayet ve Uyuşmazlık Çözümü",
    body: [
      "Talep ve şikayetlerinizi yukarıdaki e-posta adresine iletebilirsiniz. Uyuşmazlık hâlinde, ilgili parasal sınırlar dâhilinde Tüketici Hakem Heyetlerine veya Tüketici Mahkemelerine başvurabilirsiniz.",
    ],
  },
];

export default function PreliminaryInfoPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Ön Bilgilendirme Formu</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: Haziran 2026</p>
      </header>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-amber-700">
        ⚠️ <strong>Taslak:</strong> Bu form bir başlangıç şablonudur. Köşeli parantezli
        [alanları] kendi işletme bilgilerinizle doldurun ve ödemeleri açmadan önce bir
        hukuk danışmanına inceletin.
      </div>

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
