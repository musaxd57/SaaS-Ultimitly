import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Deploy-safety pins for railway.json (Codex #4). Railway only switches traffic
// to a new deployment after healthcheckPath returns 200 — a container whose
// migrate/prestart/boot failed, or whose DB is unreachable, never goes live and
// the previous deployment keeps serving. These assertions keep that contract
// from silently drifting.
describe("railway.json deploy contract", () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), "railway.json"), "utf8"));

  it("healthchecks the NORMAL /api/health (readiness), never the strict variant", () => {
    // Strict mode 503s on a missing/stale scheduler heartbeat — correct for an
    // ops monitor, WRONG for deploy readiness (a fresh DB has no heartbeat row
    // yet and would fail every first deploy). Readiness must stay lenient.
    expect(config.deploy.healthcheckPath).toBe("/api/health");
    expect(config.deploy.healthcheckPath).not.toContain("strict");
  });

  it("gives boot (migrate deploy + prestart gate + next start) time to finish", () => {
    expect(config.deploy.healthcheckTimeout).toBeGreaterThanOrEqual(120);
  });

  it("never defines startCommand — the Dockerfile CMD owns the boot chain", () => {
    // A startCommand here would OVERRIDE the Dockerfile CMD and silently skip
    // `prisma migrate deploy` and the prestart env gate.
    expect(config.deploy.startCommand).toBeUndefined();
    expect(config.build.builder).toBe("DOCKERFILE");
  });
});
