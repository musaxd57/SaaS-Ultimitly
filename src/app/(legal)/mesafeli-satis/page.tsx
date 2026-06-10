import type { Metadata } from "next";
import { SELLER } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Mesafeli Satış Sözleşmesi",
  description: "Lixus AI ücretli aboneliklerine ilişkin mesafeli satış sözleşmesi.",
};

interface Section {
  title: string;
  body: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Taraflar",
    body: [
      `SATICI — Ünvan: ${SELLER.unvan}; Adres: ${SELLER.adres}; MERSİS/Vergi: ${SELLER.mersisVergi}; Telefon: ${SELLER.telefon}; E-posta: ${SELLER.eposta}.`,
      "ALICI — Hizmeti ücretli bir plan satın alarak kullanan, hesap kaydında belirttiği ad, adres ve iletişim bilgileri esas alınan gerçek veya tüzel kişi.",
    ],
  },
  {
    title: "2. Sözleşmenin Konusu",
    body: [
      "İşbu sözleşmenin konusu, ALICI’nın elektronik ortamda sipariş verdiği, aşağıda nitelikleri ve bedeli belirtilen Lixus AI yazılım hizmeti aboneliğinin satışı ve ifasına ilişkin tarafların hak ve yükümlülüklerinin, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca belirlenmesidir.",
    ],
  },
  {
    title: "3. Hizmetin Nitelikleri ve Bedeli",
    body: [
      "Lixus AI, kısa dönem kiralama işletmeleri için misafir mesajlarını yapay zekâ ile yanıtlayan ve operasyon takibi sağlayan bir SaaS hizmetidir. Başlangıç dâhil tüm planlar, satın alma anında fiyatlandırma sayfasında gösterilen aylık bedel üzerinden ücretlendirilir. Yeni hesaplara, ödeme öncesi 14 gün ücretsiz Pro denemesi sunulur.",
      "İlan edilen fiyatlara KDV dahildir. Vergi ve benzeri yasal yükümlülükler bedele dahil olarak gösterilir.",
    ],
  },
  {
    title: "4. Ödeme Şekli",
    body: [
      "Abonelik bedeli, anlaşmalı ödeme/ödeme hizmeti kuruluşu altyapısı üzerinden kredi/banka kartı ile tahsil edilir. Kart bilgileri SATICI tarafından saklanmaz. Abonelik, seçilen dönem için geçerlidir ve ALICI iptal etmediği sürece dönem sonunda aynı koşullarla yenilenir.",
    ],
  },
  {
    title: "5. İfa Şekli ve Süresi",
    body: [
      "Hizmet dijitaldir ve elektronik ortamda ifa edilir. Ödemenin onaylanmasının ardından ilgili plan özelliklerine erişim derhal açılır. Fiziksel bir teslimat söz konusu değildir.",
    ],
  },
  {
    title: "6. Cayma Hakkı",
    body: [
      "ALICI, kural olarak sözleşmenin kurulduğu tarihten itibaren 14 gün içinde gerekçe göstermeksizin cayma hakkına sahiptir. Cayma bildirimi, yukarıdaki e-posta adresine yapılabilir.",
    ],
  },
  {
    title: "7. Cayma Hakkının İstisnaları",
    body: [
      "Mesafeli Sözleşmeler Yönetmeliği’nin 15. maddesi uyarınca; ALICI’nın onayı ile ifasına başlanan, elektronik ortamda anında ifa edilen hizmetlere ilişkin sözleşmelerde cayma hakkı kullanılamaz. ALICI, ücretli planı satın alıp hizmeti kullanmaya başlamakla bu hizmetin anında ifasına onay vermiş sayılır ve bu hâlde cayma hakkının sona erebileceğini kabul eder. Bu nedenle ücretsiz deneme süresi sunulmaktadır.",
    ],
  },
  {
    title: "8. Genel Hükümler",
    body: [
      "ALICI, hesap bilgilerinin doğruluğundan ve güvenliğinden sorumludur. Yapay zekâ çıktıları hatalı olabilir; nihai sorumluluk ALICI’ya aittir (ayrıntı için Kullanım Koşulları). SATICI, hizmeti kesintisiz sunmayı hedefler ancak mücbir sebep ve üçüncü taraf sağlayıcı kaynaklı kesintilerden sorumlu tutulamaz.",
    ],
  },
  {
    title: "9. Uyuşmazlıkların Çözümü",
    body: [
      "İşbu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca ilan edilen parasal sınırlar dâhilinde ALICI’nın yerleşim yerindeki Tüketici Hakem Heyetleri ile Tüketici Mahkemeleri yetkilidir.",
    ],
  },
  {
    title: "10. Yürürlük",
    body: [
      "ALICI’nın elektronik ortamda ödemeyi onaylaması ile işbu sözleşme kurulmuş ve yürürlüğe girmiş sayılır. Sözleşmenin bir örneği ALICI’ya elektronik ortamda sunulur.",
    ],
  },
];

export default function DistanceSalesPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Mesafeli Satış Sözleşmesi</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: Haziran 2026</p>
      </header>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-amber-700">
        ⚠️ <strong>Taslak:</strong> Bu sözleşme bir başlangıç şablonudur. Köşeli parantezli
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
