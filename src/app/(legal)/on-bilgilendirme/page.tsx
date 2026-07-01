import type { Metadata } from "next";
import { SELLER } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Ön Bilgilendirme Formu",
  description: "Lixus AI ücretli aboneliklerine ilişkin, Mesafeli Sözleşmeler Yönetmeliği kapsamında ön bilgilendirme formu.",
};

interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Satıcı / Hizmet Sağlayıcı Bilgileri",
    body: [
      `Ünvan: ${SELLER.unvan}`,
      `Adres: ${SELLER.adres}`,
      `MERSİS / Vergi No: ${SELLER.mersisVergi}`,
      `Telefon: ${SELLER.telefon}`,
      `E-posta: ${SELLER.eposta}`,
    ],
  },
  {
    title: "2. Hizmetin Temel Nitelikleri",
    body: [
      "Lixus AI, kısa dönem kiralama işletmeleri için misafir mesajlarını yapay zekâ ile yanıtlayan, görev ve operasyon takibi sağlayan bir yazılım (SaaS) hizmetidir. Hizmet, seçilen abonelik planına göre internet üzerinden sunulur; fiziksel bir ürün teslimi yapılmaz.",
      "Planlar: Başlangıç (1–2 daire), Pro (3–7 daire) ve İşletme (8+ daire). Planların güncel içerikleri, sınırları ve fiyatları satın alma anında fiyatlandırma sayfasında gösterilir.",
    ],
  },
  {
    title: "3. Hizmet Bedeli, Vergiler ve Toplam Tutar",
    body: [
      "Tüm planlar, fiyatlandırma sayfasında belirtilen aylık (veya seçilirse yıllık) bedel üzerinden ücretlendirilir. İlan edilen fiyatlara vergiler dâhildir; ödeme adımında tahsil edilecek toplam tutar, vergiler dâhil olarak açıkça gösterilir.",
      "Yeni hesaplara, ücretli bir plan seçmeden önce 14 gün ücretsiz Pro denemesi sunulur; deneme için kart bilgisi alınmaz.",
    ],
  },
  {
    title: "4. Ödeme Şekli ve Araçları",
    body: [
      "Ödemeler, anlaşmalı ödeme hizmeti sağlayıcısı (Paddle) altyapısı üzerinden kredi/banka kartı ile alınır; Paddle satış işleminde kayıtlı satıcı (Merchant of Record) olarak yer alabilir ve uygulanabilir vergileri tahsil edebilir. Kart bilgileriniz Satıcı tarafından saklanmaz.",
    ],
  },
  {
    title: "5. Sözleşme Süresi ve Yenilenme",
    body: [
      "Abonelik, seçilen dönem (aylık veya yıllık) boyunca geçerlidir ve iptal edilmediği sürece dönem sonunda aynı koşullarla otomatik olarak yenilenir. Aboneliğinizi dilediğiniz zaman iptal edebilirsiniz; iptal, içinde bulunulan ödeme döneminin sonunda yürürlüğe girer ve takip eden dönem için ücret alınmaz.",
    ],
  },
  {
    title: "6. İfa ve Hizmete Erişim",
    body: [
      "Hizmet dijitaldir ve elektronik ortamda ifa edilir. Ödemenin onaylanmasının ardından ilgili plan özelliklerine erişim derhal sağlanır.",
    ],
  },
  {
    title: "7. Cayma Hakkı ve Kullanımı",
    body: [
      "Mesafeli Sözleşmeler Yönetmeliği uyarınca tüketici, kural olarak sözleşmenin kurulduğu tarihten itibaren 14 gün içinde gerekçe göstermeksizin cayma hakkına sahiptir. Cayma bildiriminizi, yukarıda belirtilen e-posta adresine açık bir beyanla iletebilirsiniz.",
    ],
  },
  {
    title: "8. Cayma Hakkının İstisnası (Dikkat)",
    body: [
      "Yönetmeliğin 15. maddesi uyarınca, tüketicinin onayı ile ifasına başlanan ve elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı bulunmamaktadır. Ücretli bir plana geçip hizmeti kullanmaya başladığınızda (anında ifa) cayma hakkınız sona erebilir. Bu riski ortadan kaldırmak için, satın almadan önce 14 günlük ücretsiz deneme süresinden yararlanmanız önerilir.",
    ],
  },
  {
    title: "9. Tüketicinin Yükümlülükleri",
    list: [
      "Kayıt ve ödeme sırasında verdiği bilgilerin doğru ve güncel olmasını sağlamak.",
      "Hesap güvenliğini korumak ve giriş bilgilerini gizli tutmak.",
      "Hizmeti yasalara ve bağlı platformların (Airbnb, Booking.com vb.) kurallarına uygun kullanmak.",
    ],
  },
  {
    title: "10. Fiyat Değişiklikleri",
    body: [
      "Güncel fiyatlar fiyatlandırma sayfasında yayımlanır. Fiyatlarda yapılabilecek değişiklikler, yürürlüğe girmeden önce makul biçimde bildirilir ve yalnızca bir sonraki yenileme döneminde uygulanır; mevcut döneminizi etkilemez.",
    ],
  },
  {
    title: "11. Kişisel Verilerin Korunması",
    body: [
      "Kişisel verileriniz, Gizlilik Politikası ve KVKK Aydınlatma Metni’nde açıklandığı şekilde işlenir. Bu form, anılan metinlerle birlikte değerlendirilir.",
    ],
  },
  {
    title: "12. Şikayet ve Uyuşmazlık Çözümü",
    body: [
      "Talep ve şikayetlerinizi yukarıdaki e-posta adresine iletebilirsiniz. Uyuşmazlık hâlinde, Ticaret Bakanlığınca ilan edilen parasal sınırlar dâhilinde yerleşim yerinizdeki Tüketici Hakem Heyetlerine veya Tüketici Mahkemelerine başvurabilirsiniz.",
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
