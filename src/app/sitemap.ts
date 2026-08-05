import { appCanonicalOrigin } from "@/lib/app-config";
import type { MetadataRoute } from "next";
import { LEGAL_VERSION } from "@/lib/legal-entity";

// Bu deployment'ın kendi origin'i (app-config, kapalı allowlist). İki
// deployment aynı canonical'ı yayınlarsa .eu içeriği .com'un duplikatı
// olarak indekslenir; .com'da değer aynen eskisi.
const BASE = appCanonicalOrigin();

// FIXED lastModified dates (Codex #38): stamping `new Date()` on every request
// told crawlers the whole site changed every time it was asked — dishonest and
// it dilutes recrawl priority. Bump LANDING_UPDATED when the landing content
// actually changes; legal pages derive from the single-source LEGAL_VERSION.
// /login is intentionally NOT listed: an auth form is not search content.
const LANDING_UPDATED = new Date("2026-07-30"); // yeni SSS girdisi (deneme sonrası)
const LEGAL_UPDATED = new Date(`${LEGAL_VERSION}-01`);
const SECURITY_UPDATED = new Date("2026-08-05"); // VDP yayımlandı

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: LANDING_UPDATED, changeFrequency: "weekly", priority: 1 },
    // Public, indexable content page (own metadata + footer link, NOT
    // robots-disallowed) — it belongs in the sitemap like the landing page.
    { url: `${BASE}/entegrasyonlar`, lastModified: LANDING_UPDATED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/gizlilik`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/kosullar`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/on-bilgilendirme`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/mesafeli-satis`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    // VDP: keşfedilebilir OLMALI (bir güvenlik araştırmacısı onu bulamıyorsa
    // politika işlevsizdir). ⚠️ `LEGAL_UPDATED` KULLANILMIYOR: bu sayfa
    // onaylanan sözleşme metinlerinden bağımsız yaşıyor ve `LEGAL_VERSION`
    // bump'ına bağlanmamalı (legal-text-hash'e de bilerek dahil değil).
    { url: `${BASE}/guvenlik`, lastModified: SECURITY_UPDATED, changeFrequency: "yearly", priority: 0.3 },
  ];
}
