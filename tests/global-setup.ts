import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

// Provisions a throwaway SQLite database for the integration suite by pushing
// the Prisma schema into it (and generating the client if needed). Runs once
// before any test file. The DB file itself is gitignored (*.db).
export default function setup() {
  const dbPath = path.join(process.cwd(), "prisma", "test.db");
  for (const file of [dbPath, `${dbPath}-journal`]) {
    if (existsSync(file)) rmSync(file, { force: true });
  }

  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
}
