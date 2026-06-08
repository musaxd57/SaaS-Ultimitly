import type { MetadataRoute } from "next";

const BASE = "https://lixusai.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep private app + API routes out of search indexes (they require auth
      // anyway, but be explicit).
      disallow: ["/api/", "/dashboard", "/inbox", "/settings", "/admin", "/tasks", "/properties", "/reports", "/sent", "/knowledge", "/templates"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
