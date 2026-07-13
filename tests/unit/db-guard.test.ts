import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { symlinkSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isLocalDatabaseUrl } from "../../scripts/db-url.mjs";

// Codex #9: `db:reset` runs `prisma db push --force-reset` (full wipe) BEFORE
// prisma/seed.ts, so the seed's own local-DB guard fired only after the damage.
// scripts/guard-local-db.mjs now runs FIRST in the npm chain and refuses any
// non-local DATABASE_URL unless ALLOW_PROD_SEED=1 (same override as seed.ts).

const LOCAL = "postgresql://postgres@localhost:5433/x?schema=public";
const PROD = "postgresql://user:pass@containers-us-west-1.railway.app:7777/railway";

function gate(env: Record<string, string>) {
  return spawnSync(process.execPath, ["scripts/guard-local-db.mjs"], {
    env: { ...process.env, DATABASE_URL: "", ALLOW_PROD_SEED: "", ...env },
    encoding: "utf8",
  });
}

describe("isLocalDatabaseUrl (pure)", () => {
  it("accepts loopback hosts only", () => {
    expect(isLocalDatabaseUrl(LOCAL)).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabaseUrl(PROD)).toBe(false);
  });

  it("refuses empty / unparseable URLs (fail-closed)", () => {
    expect(isLocalDatabaseUrl("")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
    expect(isLocalDatabaseUrl("not-a-url")).toBe(false);
  });
});

describe("scripts/guard-local-db.mjs — the destructive-command gate", () => {
  it("remote DATABASE_URL → non-zero exit, and never prints the URL (credentials)", () => {
    const r = gate({ DATABASE_URL: PROD });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing/);
    expect(r.stdout + r.stderr).not.toContain("railway.app");
    expect(r.stdout + r.stderr).not.toContain("pass");
  });

  it("missing DATABASE_URL → non-zero exit (fail-closed)", () => {
    expect(gate({}).status).toBe(1);
  });

  it("local DATABASE_URL → exit 0 (dev flow not blocked)", () => {
    expect(gate({ DATABASE_URL: LOCAL }).status).toBe(0);
  });

  it("ALLOW_PROD_SEED=1 → deliberate override passes", () => {
    expect(gate({ DATABASE_URL: PROD, ALLOW_PROD_SEED: "1" }).status).toBe(0);
  });

  it("gates UNCONDITIONALLY — even when invoked via a symlink (Windows argv-mismatch class)", () => {
    // The old main-module detection compared import.meta.url to
    // file://${process.argv[1]}: on Windows (backslashes, drive letter) and
    // under symlinks (Node resolves import.meta.url to the REAL path while
    // argv[1] keeps the link path) the strings never match and the gate
    // silently skipped. A symlinked run reproduces that mismatch on Linux.
    const dir = mkdtempSync(join(tmpdir(), "dbguard-"));
    const link = join(dir, "linked-guard.mjs");
    symlinkSync(join(process.cwd(), "scripts", "guard-local-db.mjs"), link);
    try {
      const r = spawnSync(process.execPath, [link], {
        env: { ...process.env, DATABASE_URL: PROD, ALLOW_PROD_SEED: "" },
        encoding: "utf8",
      });
      expect(r.status).toBe(1); // old code: 0 (gate skipped) → wipe would proceed
      expect(r.stderr).toMatch(/Refusing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CHAIN PROOF: '&&' stops the destructive step when the gate refuses", () => {
    const r = spawnSync("sh", ["-c", "node scripts/guard-local-db.mjs && echo WIPED"], {
      env: { ...process.env, DATABASE_URL: PROD, ALLOW_PROD_SEED: "" },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("WIPED");
  });
});

describe("package.json wiring", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

  it("db:reset and db:push run the guard BEFORE the prisma command", () => {
    for (const name of ["db:reset", "db:push"]) {
      const script: string = pkg.scripts[name];
      const guardAt = script.indexOf("guard-local-db.mjs");
      const prismaAt = script.indexOf("prisma db push");
      expect(guardAt, `${name} must include the guard`).toBeGreaterThanOrEqual(0);
      expect(guardAt, `${name} must guard FIRST`).toBeLessThan(prismaAt);
      expect(script).toContain("&&"); // non-zero guard exit must stop the chain
    }
  });
});
