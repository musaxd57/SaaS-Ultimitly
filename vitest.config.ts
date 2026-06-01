import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Test DB lives next to the dev DB but is fully disposable (gitignored *.db).
const testDbPath = path.join(process.cwd(), "prisma", "test.db");

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
    // Integration tests share one SQLite file and wipe it between cases, so the
    // test files must not run in parallel (otherwise one file's resetDb wipes
    // another file's data mid-run).
    fileParallelism: false,
    // The integration suite provisions a real SQLite schema once, up front.
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: `file:${testDbPath}`,
      AUTH_SECRET: "test-secret-min-16-characters-long",
      // Force the deterministic AI path; never call OpenAI from tests.
      OPENAI_API_KEY: "",
    },
  },
});
