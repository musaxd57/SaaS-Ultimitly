import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (minor info-leak hardening).
  poweredByHeader: false,
  // Safe, additive security headers on every response. CSP is TWO-TIER (Codex P2):
  //  * ENFORCED: only the directives that cannot break a Next.js app because the
  //    app never uses the features they gate — object-src (plugins), base-uri
  //    (<base> hijack), frame-ancestors (clickjacking; mirrors X-Frame-Options).
  //  * REPORT-ONLY: the FULL policy incl. script-src. Enforcing script-src needs
  //    per-request nonces for Next's inline bootstrap (ayrı altyapı turu) —
  //    'unsafe-inline'ı enforce etmek koruma katmaz, nonce'suz sıkılaştırmak
  //    paneli komple kırar. Gözlem katmanı o tur için veri toplar.
  async headers() {
    const cspEnforced = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"].join("; ");
    const cspReportOnly = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' https:",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Content-Security-Policy", value: cspEnforced },
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
      {
        // The public guest QR concierge URL carries a bearer token IN THE PATH.
        // Never leak it via the Referer header (not even to our own pages the
        // chat footer links to) — a leaked token = access to that apartment's chat.
        source: "/c/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // Brand assets are MEANT to be embedded by OTHER sites (Hospitable's OAuth
      // consent screen hotlinks the app logo; partner directories do the same).
      // The global CORP: same-site above makes browsers BLOCK exactly that
      // cross-origin <img> load — the consent screen showed a broken "Lixus AI
      // logo" box. These two public files opt back into cross-origin embedding
      // (last matching header wins in Next). Everything else stays same-site.
      ...["/lixus-logo.png", "/lixus-logo-icon.png"].map((source) => ({
        source,
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      })),
    ];
  },
  // Pin the workspace root to this project so Next doesn't pick a stray
  // package-lock.json in a parent directory (silences the "inferred workspace
  // root" multi-lockfile warning on dev start).
  outputFileTracingRoot: projectRoot,
  // ESLint is intentionally not configured for the MVP; type-checking via tsc still runs.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    // Client Router Cache lifetime. Next 15 defaults DYNAMIC pages to 0s, which
    // turns every back/forward navigation ("← Mesajlar") into a full server
    // re-render — session check + Prisma queries + RSC stream on each click,
    // felt as sluggish paging. 30s serves recently visited pages instantly from
    // the client cache. Freshness stays correct: every mutating component in
    // the app calls router.refresh() (which purges this cache) and the inbox
    // runs a 30s AutoRefresh anyway — the window matches that cadence.
    staleTimes: { dynamic: 30 },
  },
  webpack: (config, { dev }) => {
    // Disable webpack's persistent filesystem cache for production builds. On CI
    // hosts that persist .next/cache across deploys (e.g. Railway's cache mount),
    // a stale cache left by an older/incompatible build can emit corrupt chunks
    // and break prerendering of the auto-generated /500 and /_error pages
    // ("<Html> should not be imported outside of pages/_document"). Compiling
    // fresh every production build avoids that whole class of failure; dev keeps
    // its fast-refresh cache.
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
