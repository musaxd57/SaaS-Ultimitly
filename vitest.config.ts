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
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one database and wipe it between cases, so the
    // test files must not run in parallel (otherwise one file's resetDb wipes
    // another file's data mid-run).
    fileParallelism: false,
    // The integration suite provisions a throwaway PostgreSQL instance once, up
    // front (see tests/global-setup.ts) — this URL must match it.
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "postgresql://postgres@localhost:5433/guestops_test?schema=public",
      AUTH_SECRET: "test-secret-min-16-characters-long",
      // Force the deterministic AI path; never call OpenAI from tests.
      OPENAI_API_KEY: "",
    },
  },
});
