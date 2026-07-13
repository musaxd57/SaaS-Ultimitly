#!/usr/bin/env node
// Destructive-command gate (Codex #9). `npm run db:reset` runs `prisma db push
// --force-reset` — a full data wipe — BEFORE prisma/seed.ts (whose own local-DB
// guard therefore fires only AFTER the damage). This script runs FIRST in the
// npm chain and exits non-zero unless DATABASE_URL points at a local database,
// so a shell that still carries the production URL cannot wipe or schema-push
// the live DB. Same policy + override as seed.ts: ALLOW_PROD_SEED=1 is the one
// deliberate escape hatch. Never prints the URL (it embeds credentials).
//
// UNCONDITIONAL: no "am I the main module?" detection. The previous
// `import.meta.url === file://${process.argv[1]}` check silently never matched
// on Windows (backslashes, drive letter, no URL-encoding) and under symlinked
// invocations — the gate became a no-op exactly where it mattered. This file
// is an executable, not a library: importing it runs the gate. The pure
// isLocalDatabaseUrl helper lives in scripts/db-url.mjs for tests/reuse.

import { isLocalDatabaseUrl } from "./db-url.mjs";

if (!isLocalDatabaseUrl(process.env.DATABASE_URL) && process.env.ALLOW_PROD_SEED !== "1") {
  console.error(
    "[db-guard] Refusing: DATABASE_URL is not a local database — this command would wipe or mutate it.",
  );
  console.error("[db-guard] Point DATABASE_URL at localhost, or set ALLOW_PROD_SEED=1 to override deliberately.");
  process.exit(1);
}
console.log("[db-guard] local database confirmed");
process.exit(0);
