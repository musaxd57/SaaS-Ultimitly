import { appCanonicalOrigin } from "@/lib/app-config";
import type { MetadataRoute } from "next";

// Bu deployment'ın kendi origin'i (app-config, kapalı allowlist). İki
// deployment aynı canonical'ı yayınlarsa .eu içeriği .com'un duplikatı
// olarak indekslenir; .com'da değer aynen eskisi.
const BASE = appCanonicalOrigin();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep private app + API routes out of search indexes (they require auth
      // anyway, and the (app) layout also sends noindex — be explicit here too).
      // "/c" = public guest QR chat (bearer-token URLs) — never crawl/index them.
      // Covers EVERY (app) route group directory; update when adding a new one.
      disallow: [
        "/api/",
        "/c/",
        "/admin",
        "/billing",
        "/calendar",
        "/cancellations",
        "/dashboard",
        "/guest-chats",
        "/hazirlik",
        "/inbox",
        "/knowledge",
        "/login",
        "/properties",
        "/reports",
        "/sent",
        "/settings",
        "/tasks",
        "/templates",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
