import type { MetadataRoute } from "next";

const BASE = "https://www.lixusai.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep private app + API routes out of search indexes (they require auth
      // anyway, but be explicit).
      // "/c" = public guest QR chat (bearer-token URLs) — never crawl/index them.
      disallow: ["/api/", "/c/", "/dashboard", "/inbox", "/settings", "/admin", "/tasks", "/properties", "/reports", "/sent", "/knowledge", "/templates"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
