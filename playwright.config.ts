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
    // The REAL start chain (Codex): `npm run start` = prestart env gate
    // (scripts/verify-env.mjs) → `next start`. The old `npx next start`
    // BYPASSED the prestart hook, so a green E2E never proved the production
    // boot path. NODE_ENV=production makes the gate live here: a missing/
    // placeholder AUTH_SECRET or a missing/AUTH_SECRET-equal ENCRYPTION_KEY
    // refuses to boot and the suite fails loudly.
    command: "npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3100", // `next start` binds $PORT (the npm script owns the command — no -p flag)
      AUTH_SECRET: process.env.AUTH_SECRET || "e2e-auth-secret-forty-characters-long-xx",
      // DISTINCT from AUTH_SECRET on purpose — the gate rejects equality.
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "e2e-encryption-key-different-40chars-xx",
      // Keep the boot quiet & deterministic: no internal cron ticking mid-test.
      INTERNAL_CRON_DISABLED: "1",
    },
  },
});
