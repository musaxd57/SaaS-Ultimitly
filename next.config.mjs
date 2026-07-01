import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (minor info-leak hardening).
  poweredByHeader: false,
  // Safe, additive security headers on every response. The Content-Security-Policy
  // is REPORT-ONLY: it never blocks anything (so it cannot break the app), it only
  // surfaces violations in the browser console — groundwork for an enforced policy
  // later (which would need nonces for Next's inline bootstrap). All header-only.
  async headers() {
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
