import { DEFAULT_PLANS } from "@/lib/billing/plans";
import { SELLER } from "@/lib/legal-entity";

const SITE = "https://www.lixusai.com";
const DESCRIPTION =
  "Airbnb ve Booking misafir mesajlarını 7/24, güvenle yanıtlayan yapay zekâ. Misafiriniz hangi dilde yazarsa o dilde cevap alır; şikayet ve iade gibi riskli konuları otomatik yanıtlamaz, size bırakır.";

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
    alternateName: ["LixusAI", "lixusai", "Lixus AI Türkiye"],
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

  const website = {
    "@type": "WebSite",
    name: "Lixus AI",
    alternateName: ["LixusAI", "lixusai"],
    url: SITE,
    inLanguage: "tr-TR",
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [organization, website, software, faqPage],
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
  );
}
