import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { checkProductionEnv, DEV_PLACEHOLDER_SECRET } from "../../scripts/env-check.mjs";
import { register } from "@/instrumentation";

// Boot fail-fast (#3). The critical-env gate is a SINGLE source: scripts/verify-env.mjs
// (the `prestart` npm hook), run as a standalone process BEFORE `next start`. In
// production a missing/placeholder AUTH_SECRET or a missing/derived ENCRYPTION_KEY
// exits NON-ZERO there, so the process never reaches `next start` — no "Ready but
// every request 500s". Dev/test start is never blocked.

const REAL_AUTH = "a-real-production-secret-value-42-chars-xx";
const REAL_ENC = "a-different-real-encryption-key-40chars-x";

/** Run the standalone gate with a controlled env; returns the child result. */
function gate(env: Record<string, string>, prod = true) {
  return spawnSync(process.execPath, ["scripts/verify-env.mjs"], {
    // Replace the sensitive vars explicitly (vitest.config injects a test AUTH_SECRET).
    env: { ...process.env, NODE_ENV: prod ? "production" : "development", AUTH_SECRET: "", ENCRYPTION_KEY: "", ...env },
    encoding: "utf8",
  });
}

describe("checkProductionEnv (pure gate logic — single source)", () => {
  it("flags a missing / placeholder AUTH_SECRET", () => {
    expect(checkProductionEnv({ AUTH_SECRET: "", ENCRYPTION_KEY: REAL_ENC }).errors[0]).toMatch(/AUTH_SECRET is missing/);
    expect(
      checkProductionEnv({ AUTH_SECRET: DEV_PLACEHOLDER_SECRET, ENCRYPTION_KEY: REAL_ENC }).errors[0],
    ).toMatch(/placeholder/);
  });

  it("requires ENCRYPTION_KEY, independent of AUTH_SECRET", () => {
    expect(checkProductionEnv({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: "" }).errors[0]).toMatch(/ENCRYPTION_KEY is missing/);
    expect(
      checkProductionEnv({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_AUTH }).errors[0],
    ).toMatch(/independent of AUTH_SECRET/);
  });

  it("passes with two distinct real secrets (no errors)", () => {
    const { errors } = checkProductionEnv({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC });
    expect(errors).toHaveLength(0);
  });
});

describe("scripts/verify-env.mjs — the prestart boot gate", () => {
  it("PROD + missing AUTH_SECRET → non-zero exit", () => {
    const r = gate({ ENCRYPTION_KEY: REAL_ENC });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/AUTH_SECRET is missing/);
  });

  it("PROD + placeholder AUTH_SECRET → non-zero exit", () => {
    expect(gate({ AUTH_SECRET: DEV_PLACEHOLDER_SECRET, ENCRYPTION_KEY: REAL_ENC }).status).toBe(1);
  });

  it("PROD + missing ENCRYPTION_KEY → non-zero exit (no AUTH_SECRET fallback allowed)", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ENCRYPTION_KEY is missing/);
  });

  it("PROD + ENCRYPTION_KEY === AUTH_SECRET → non-zero exit", () => {
    expect(gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_AUTH }).status).toBe(1);
  });

  it("PROD + two distinct real secrets → exit 0 (chain continues)", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/environment OK/);
  });

  it("DEV with empty secrets → exit 0 (development/test not blocked)", () => {
    expect(gate({}, false).status).toBe(0);
  });

  it("never prints a secret VALUE", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_AUTH });
    expect(r.stdout + r.stderr).not.toContain(REAL_AUTH);
  });

  it("SMOKE: 'Ready' comes ONLY after the gate passes (chain gating proof)", () => {
    // Proxy for the container start chain: `verify-env && <next start>`. On a bad
    // env the gate exits non-zero, so the '&&'-chained start step never runs.
    const bad = spawnSync("sh", ["-c", "node scripts/verify-env.mjs && echo READY"], {
      env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: "", ENCRYPTION_KEY: "" },
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stdout).not.toContain("READY");

    const good = spawnSync("sh", ["-c", "node scripts/verify-env.mjs && echo READY"], {
      env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC },
      encoding: "utf8",
    });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("READY");
  });
});

describe("instrumentation.register — no SECOND, conflicting env source", () => {
  it("does NOT throw on a missing secret in production (the gate moved to prestart)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERNAL_CRON_DISABLED", "1"); // no timers started
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("ENCRYPTION_KEY", "");
    await expect(register()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});
