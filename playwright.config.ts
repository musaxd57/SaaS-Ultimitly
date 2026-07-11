import { defineConfig } from "@playwright/test";

// E2E smoke (Codex CI-gate item). Deliberately tiny: boots the REAL production
// build against a seeded Postgres and walks the critical path (landing → login →
// dashboard). Catches the "app doesn't boot / auth broken / shell crashed" class
// the unit suite can't see. Vitest ignores tests/e2e (it only picks *.test.ts);
// Playwright only looks here.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
    // CI installs the matching browser (`playwright install chromium`). In the
    // dev sandbox a system Chromium is preinstalled at a fixed path whose build
    // may not match this @playwright/test version — point at it explicitly via
    // PW_CHROMIUM_PATH instead of re-downloading.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    // Production server against the E2E database. `next start` requires a prior
    // `npm run build` (the e2e npm script chains it).
    command: "npx next start -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: "3100",
      // Keep the boot quiet & deterministic: no internal cron ticking mid-test.
      INTERNAL_CRON_DISABLED: "1",
    },
  },
});
