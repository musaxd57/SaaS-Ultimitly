import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
