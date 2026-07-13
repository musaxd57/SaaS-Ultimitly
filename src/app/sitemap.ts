import type { MetadataRoute } from "next";
import { LEGAL_VERSION } from "@/lib/legal-entity";

const BASE = "https://www.lixusai.com";

// FIXED lastModified dates (Codex #38): stamping `new Date()` on every request
// told crawlers the whole site changed every time it was asked — dishonest and
// it dilutes recrawl priority. Bump LANDING_UPDATED when the landing content
// actually changes; legal pages derive from the single-source LEGAL_VERSION.
// /login is intentionally NOT listed: an auth form is not search content.
const LANDING_UPDATED = new Date("2026-07-13");
const LEGAL_UPDATED = new Date(`${LEGAL_VERSION}-01`);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: LANDING_UPDATED, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/gizlilik`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/kosullar`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/on-bilgilendirme`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/mesafeli-satis`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
  ];
}
