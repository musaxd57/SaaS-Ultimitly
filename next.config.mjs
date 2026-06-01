import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for Railway / Docker deployments — produces a self-contained build.
  output: "standalone",
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
