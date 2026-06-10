import { DEFAULT_PLANS } from "@/lib/billing/plans";
import { SELLER } from "@/lib/legal-entity";

const SITE = "https://lixusai.com";
const DESCRIPTION =
  "Airbnb ve Booking.com misafir mesajlarını Türkçe önceliğiyle, KVKK'ya uygun şekilde yapay zekâ ile otomatik yanıtlayan SaaS. Şikayet/iade/iptal asla otomatik gönderilmez; kontrol her zaman sizde.";

/**
 * JSON-LD structured data for the marketing landing — Organization,
 * SoftwareApplication (Offers from the canonical plan list), and FAQPage
 * (mirrors the visible FAQ). Placeholder seller fields ([bracketed]) are omitted
 * until legal-entity.ts is filled, so nothing fake leaks into the markup.
 */
export function StructuredData({ faqs }: { faqs: { q: string; a: string }[] }) {
  const real = (v: string) => Boolean(v) && !v.trim().startsWith("[");

  const organization: Record<string, unknown> = {
    "@type": "Organization",
    name: "Lixus AI",
    url: SITE,
    logo: `${SITE}/icon.svg`,
    email: SELLER.eposta,
    description: DESCRIPTION,
    areaServed: "TR",
    inLanguage: "tr-TR",
  };
  if (real(SELLER.adres)) organization.address = SELLER.adres;
  if (real(SELLER.telefon)) organization.telephone = SELLER.telefon;

  const software = {
    "@type": "SoftwareApplication",
    name: "Lixus AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "tr-TR",
    description: DESCRIPTION,
    offers: DEFAULT_PLANS.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: (p.priceMinor / 100).toFixed(2),
      priceCurrency: p.currency,
      category: "subscription",
    })),
  };

  const faqPage = {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [organization, software, faqPage],
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
  );
}
