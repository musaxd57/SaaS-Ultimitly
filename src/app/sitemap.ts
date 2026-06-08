import type { MetadataRoute } from "next";

const BASE = "https://lixusai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/gizlilik`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/kosullar`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
