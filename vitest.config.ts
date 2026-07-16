import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" path alias for the test runner.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" is a build-time guard with no runtime API; stub it so
      // server modules (db, automation, reports, ai) import cleanly in Node.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  // Automatic JSX runtime so component tests need no explicit React import.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // Integration tests share one database and wipe it between cases, so the
    // test files must not run in parallel (otherwise one file's resetDb wipes
    // another file's data mid-run).
    fileParallelism: false,
    // The integration suite provisions a throwaway PostgreSQL instance once, up
    // front (see tests/global-setup.ts) — this URL must match it.
    globalSetup: ["tests/global-setup.ts"],
    env: {
      // TEST_DATABASE_URL = cross-platform override (Windows/macOS): point it at
      // an empty local PostgreSQL DB and global-setup skips Linux provisioning.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL?.trim() ||
        "postgresql://postgres@localhost:5433/guestops_test?schema=public",
      AUTH_SECRET: "test-secret-min-16-characters-long",
      // Force the deterministic AI path; never call OpenAI from tests.
      OPENAI_API_KEY: "",
    },
  },
});
