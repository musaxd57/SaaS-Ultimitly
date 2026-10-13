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

// G2 (kurucu 10-13, DENETIM 08-09 #28): the runtime image carries ONLY the boot
// gate's scripts, never the operator folder (one of those reverses calendar-URL
// encryption). Both directions are pinned: nothing extra is copied, and nothing
// the gate needs at boot is missing (a missing import would crash-loop prestart).
describe("Dockerfile runner stage — scripts/ allowlist (G2)", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
  const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

  const copiedScripts = (): string[] =>
    runner
      .split("\n")
      .filter((l) => /^COPY\s/.test(l) && !l.includes("--from="))
      .flatMap((l) => l.trim().split(/\s+/).slice(1, -1))
      .filter((src) => src === "scripts" || src.startsWith("scripts/") || src === "." || src === "./");

  // Transitive relative imports of the prestart entry point, read from disk.
  const bootClosure = (): string[] => {
    const entry = /node\s+(scripts\/\S+\.mjs)/.exec(pkg.scripts.prestart)?.[1];
    expect(entry, "prestart must run a scripts/*.mjs gate").toBeTruthy();
    const seen = new Set<string>();
    const walk = (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const m of src.matchAll(/^\s*import\s[^"']*["'](\.\.?\/[^"']+)["']/gm)) {
        walk(join(rel, "..", m[1]).replace(/\\/g, "/"));
      }
    };
    walk(entry!);
    return [...seen].sort();
  };

  it("copies scripts by NAME — never the whole folder or the build context", () => {
    const copied = copiedScripts();
    expect(copied).not.toContain("scripts");
    expect(copied).not.toContain("scripts/");
    expect(copied).not.toContain(".");
    expect(copied).not.toContain("./");
    expect(copied.every((s) => /^scripts\/[\w.-]+\.mjs$/.test(s))).toBe(true);
  });

  it("the copied set is EXACTLY the prestart gate's import closure", () => {
    const closure = bootClosure();
    // Anti-vacuity: the gate really imports its checker today.
    expect(closure).toEqual(["scripts/env-check.mjs", "scripts/verify-env.mjs"]);
    expect([...copiedScripts()].sort()).toEqual(closure);
  });
});
