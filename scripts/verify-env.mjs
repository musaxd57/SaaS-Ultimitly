#!/usr/bin/env node
// Boot gate — runs as the `prestart` npm hook, i.e. BEFORE `next start`
// (package.json: prestart → this; Dockerfile CMD: `npx prisma migrate deploy &&
// npm run start`, and `npm run start` always runs `prestart` first). In production
// a misconfiguration exits NON-ZERO here, so the process never reaches `next start`
// — eliminating the "server reports Ready but every request 500s" failure mode that
// a runtime throw inside instrumentation.ts produced. Only enforces in production;
// dev/test start is never blocked. Never prints a secret value.

import { checkProductionEnv } from "./env-check.mjs";

const isProd = process.env.NODE_ENV === "production";
const { errors, warnings } = checkProductionEnv(process.env);

for (const w of warnings) console.warn(`[boot] warning: ${w}`);

if (errors.length > 0) {
  if (isProd) {
    console.error("[boot] Refusing to start — critical environment is misconfigured:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("[boot] Fix the above Railway variables and redeploy. (No secret values are printed.)");
    process.exit(1);
  }
  // Non-production: surface the same issues (so they aren't a surprise on deploy)
  // but never block a local/test start.
  console.warn("[boot] (non-production) issues that WOULD block a production start:");
  for (const e of errors) console.warn(`  - ${e}`);
}

console.log("[boot] environment OK");
process.exit(0);
