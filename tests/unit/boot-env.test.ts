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
const REAL_PEPPER = "a-third-distinct-qr-pin-pepper-value-40ch";
const REAL_RESEND = "re_test_key_1234567890"; // any non-empty value satisfies the provider check

/** Run the standalone gate with a controlled env; returns the child result. */
function gate(env: Record<string, string>, prod = true) {
  return spawnSync(process.execPath, ["scripts/verify-env.mjs"], {
    // Replace the sensitive vars explicitly (vitest.config injects a test AUTH_SECRET);
    // clear the QR PIN + email vars so the feature-gated / provider checks are
    // deterministic regardless of the local .env.
    env: {
      ...process.env,
      NODE_ENV: prod ? "production" : "development",
      AUTH_SECRET: "", ENCRYPTION_KEY: "", QR_PIN_ENABLED: "", QR_PIN_PEPPER: "",
      GUEST_ERASURE_ENABLED: "", ERASURE_HMAC_SECRET: "",
      RESEND_API_KEY: "", EMAIL_HOST: "", EMAIL_USER: "", EMAIL_PASS: "",
      // Clear the secret-bearing URL overrides so the https-pin check is
      // deterministic regardless of the local .env (each defaults to https in code).
      HOSPITABLE_API_BASE_URL: "", SUPPLY_AI_BASE_URL: "", SHADOW_AI_BASE_URL: "",
      HOSPITABLE_OAUTH_AUTHORIZE_URL: "", HOSPITABLE_OAUTH_TOKEN_URL: "",
      HOSPITABLE_OAUTH_REDIRECT_URI: "", APP_URL: "",
      ...env,
    },
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

  it("passes with two distinct real secrets + an email provider (no errors)", () => {
    const { errors } = checkProductionEnv({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND });
    expect(errors).toHaveLength(0);
  });

  it("email provider (fail-open fix): required in production; partial SMTP is an error", () => {
    const secrets = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC };
    // No provider at all → error.
    expect(checkProductionEnv({ ...secrets }).errors.join()).toMatch(/No email provider configured/);
    // Resend alone → OK.
    expect(checkProductionEnv({ ...secrets, RESEND_API_KEY: REAL_RESEND }).errors).toHaveLength(0);
    // Complete SMTP → OK.
    expect(
      checkProductionEnv({ ...secrets, EMAIL_HOST: "smtp.x.com", EMAIL_USER: "u", EMAIL_PASS: "p" }).errors,
    ).toHaveLength(0);
    // PARTIAL SMTP (host only / missing pass) → error, not a silent pass.
    expect(checkProductionEnv({ ...secrets, EMAIL_HOST: "smtp.x.com" }).errors.join()).toMatch(/PARTIALLY configured/);
    expect(
      checkProductionEnv({ ...secrets, EMAIL_HOST: "smtp.x.com", EMAIL_USER: "u" }).errors.join(),
    ).toMatch(/PARTIALLY configured/);
  });

  it("HTTPS-pin (P2): a SET secret-bearing external URL must be https; unset is fine", () => {
    const base = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND };
    // Unset overrides → the code's https defaults are used → no error.
    expect(checkProductionEnv({ ...base }).errors).toHaveLength(0);
    // https overrides → OK.
    expect(
      checkProductionEnv({
        ...base,
        HOSPITABLE_API_BASE_URL: "https://public.api.hospitable.com/v2",
        SUPPLY_AI_BASE_URL: "https://api.akashml.com/v1",
        SHADOW_AI_BASE_URL: "https://api.akashml.com/v1",
        HOSPITABLE_OAUTH_AUTHORIZE_URL: "https://auth.hospitable.com/oauth/authorize",
        HOSPITABLE_OAUTH_TOKEN_URL: "https://auth.hospitable.com/oauth/token",
      }).errors,
    ).toHaveLength(0);
    // http override → error, per variable (a secret would ride plaintext).
    expect(checkProductionEnv({ ...base, SUPPLY_AI_BASE_URL: "http://api.akashml.com/v1" }).errors.join()).toMatch(
      /SUPPLY_AI_BASE_URL must be an https/,
    );
    expect(
      checkProductionEnv({ ...base, HOSPITABLE_API_BASE_URL: "http://public.api.hospitable.com/v2" }).errors.join(),
    ).toMatch(/HOSPITABLE_API_BASE_URL must be an https/);
    expect(
      checkProductionEnv({ ...base, HOSPITABLE_OAUTH_TOKEN_URL: "http://auth.hospitable.com/oauth/token" }).errors.join(),
    ).toMatch(/HOSPITABLE_OAUTH_TOKEN_URL must be an https/);
  });

  it("OAuth redirect (P2): production accepts ONLY the exact canonical callback", () => {
    const base = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND };
    const CANONICAL = "https://www.lixusai.com/api/hospitable/oauth/callback";
    // Unset → default canonical → no error.
    expect(checkProductionEnv({ ...base }).errors).toHaveLength(0);
    // Exact canonical → OK.
    expect(checkProductionEnv({ ...base, HOSPITABLE_OAUTH_REDIRECT_URI: CANONICAL }).errors).toHaveLength(0);
    // Any other value (foreign host, staging, http) → error — the code returns here.
    expect(
      checkProductionEnv({ ...base, HOSPITABLE_OAUTH_REDIRECT_URI: "https://evil.example/cb" }).errors.join(),
    ).toMatch(/HOSPITABLE_OAUTH_REDIRECT_URI must be exactly/);
    expect(
      checkProductionEnv({
        ...base,
        HOSPITABLE_OAUTH_REDIRECT_URI: "https://staging.lixusai.com/api/hospitable/oauth/callback",
      }).errors.join(),
    ).toMatch(/HOSPITABLE_OAUTH_REDIRECT_URI must be exactly/);
  });

  it("QR_PIN_PEPPER (Codex 4): required only when QR_PIN_ENABLED=1, separate + ≥32 + ≠AUTH_SECRET", () => {
    const base = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND };
    // Feature OFF → no pepper needed (deploy never blocked).
    expect(checkProductionEnv({ ...base }).errors).toHaveLength(0);
    expect(checkProductionEnv({ ...base, QR_PIN_ENABLED: "1", QR_PIN_PEPPER: REAL_PEPPER }).errors).toHaveLength(0);
    // Feature ON → the pepper is enforced.
    expect(checkProductionEnv({ ...base, QR_PIN_ENABLED: "1" }).errors.join()).toMatch(/QR_PIN_PEPPER is missing/);
    expect(
      checkProductionEnv({ ...base, QR_PIN_ENABLED: "1", QR_PIN_PEPPER: REAL_AUTH }).errors.join(),
    ).toMatch(/independent of AUTH_SECRET/);
    expect(
      checkProductionEnv({ ...base, QR_PIN_ENABLED: "1", QR_PIN_PEPPER: "too-short" }).errors.join(),
    ).toMatch(/at least 32/);
    expect(
      checkProductionEnv({ ...base, QR_PIN_ENABLED: "1", QR_PIN_PEPPER: DEV_PLACEHOLDER_SECRET }).errors.join(),
    ).toMatch(/placeholder/);
  });

  it("ERASURE_HMAC_SECRET (m40, Codex-2): required only when GUEST_ERASURE_ENABLED=1, dedicated + ≥32 + ≠AUTH_SECRET/ENCRYPTION_KEY", () => {
    const base = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND };
    const REAL_ERASURE = "a-fourth-distinct-erasure-hmac-secret-40x";
    // Feature OFF → no secret needed (deploy never blocked; guards inert on empty table).
    expect(checkProductionEnv({ ...base }).errors).toHaveLength(0);
    expect(
      checkProductionEnv({ ...base, GUEST_ERASURE_ENABLED: "1", ERASURE_HMAC_SECRET: REAL_ERASURE }).errors,
    ).toHaveLength(0);
    // Feature ON → the dedicated secret is enforced, never a doubled-up secret.
    expect(checkProductionEnv({ ...base, GUEST_ERASURE_ENABLED: "1" }).errors.join()).toMatch(
      /ERASURE_HMAC_SECRET is missing/,
    );
    expect(
      checkProductionEnv({ ...base, GUEST_ERASURE_ENABLED: "1", ERASURE_HMAC_SECRET: REAL_AUTH }).errors.join(),
    ).toMatch(/independent of AUTH_SECRET/);
    expect(
      checkProductionEnv({ ...base, GUEST_ERASURE_ENABLED: "1", ERASURE_HMAC_SECRET: REAL_ENC }).errors.join(),
    ).toMatch(/independent of ENCRYPTION_KEY/);
    expect(
      checkProductionEnv({ ...base, GUEST_ERASURE_ENABLED: "1", ERASURE_HMAC_SECRET: "too-short" }).errors.join(),
    ).toMatch(/at least 32/);
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

  it("PROD + two distinct real secrets + email provider → exit 0 (chain continues)", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/environment OK/);
  });

  it("PROD + no email provider → non-zero exit (transactional mail fail-open closed)", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No email provider configured/);
  });

  it("PROD + PARTIAL SMTP (host, no user/pass) → non-zero exit", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, EMAIL_HOST: "smtp.x.com" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PARTIALLY configured/);
  });

  it("DEV + no email provider → exit 0 (dev/test never blocked)", () => {
    expect(gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC }, false).status).toBe(0);
  });

  it("PROD + http secret-bearing URL → non-zero exit (HTTPS-pin, before traffic)", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      SUPPLY_AI_BASE_URL: "http://api.akashml.com/v1",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SUPPLY_AI_BASE_URL must be an https/);
    expect(r.stdout + r.stderr).not.toContain("api.akashml.com"); // never prints the URL value
  });

  it("PROD + https secret-bearing URL → exit 0 (override accepted)", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      HOSPITABLE_API_BASE_URL: "https://public.api.hospitable.com/v2",
    });
    expect(r.status).toBe(0);
  });

  it("DEV + http secret-bearing URL → exit 0 (dev/test never blocked)", () => {
    expect(
      gate(
        { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, SUPPLY_AI_BASE_URL: "http://localhost:9000/v1" },
        false,
      ).status,
    ).toBe(0);
  });

  it("APP_URL canonical pin (Codex 07-23 #2): prod'da yalnız exact canonical; unset serbest", () => {
    const secrets = { AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND };
    // Unset → kodun canonical default'u → hata yok.
    expect(checkProductionEnv({ ...secrets }).errors).toHaveLength(0);
    // Exact canonical (trailing slash toleranslı) → hata yok.
    expect(checkProductionEnv({ ...secrets, APP_URL: "https://www.lixusai.com" }).errors).toHaveLength(0);
    expect(checkProductionEnv({ ...secrets, APP_URL: "https://www.lixusai.com/" }).errors).toHaveLength(0);
    // http'li canonical / yabancı origin / .eu → hata (doğrulama token linkleri buradan).
    for (const bad of ["http://www.lixusai.com", "https://evil.example", "https://www.lixusai.eu"]) {
      expect(checkProductionEnv({ ...secrets, APP_URL: bad }).errors.join()).toMatch(/APP_URL must be exactly/);
    }
  });

  it("PROD + kötü APP_URL → non-zero exit; SAĞLANAN değer asla basılmaz", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      APP_URL: "http://evil-app.example",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/APP_URL must be exactly/);
    expect(r.stdout + r.stderr).not.toContain("evil-app.example"); // hostile değer asla echo edilmez
  });

  it("PROD + exact canonical APP_URL → exit 0", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      APP_URL: "https://www.lixusai.com",
    });
    expect(r.status).toBe(0);
  });

  it("PROD + non-canonical OAuth redirect URI → non-zero exit (provided value not printed)", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      HOSPITABLE_OAUTH_REDIRECT_URI: "https://evil.example/api/hospitable/oauth/callback",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/HOSPITABLE_OAUTH_REDIRECT_URI must be exactly/);
    expect(r.stdout + r.stderr).not.toContain("evil.example"); // the hostile value is never echoed
  });

  it("PROD + exact canonical OAuth redirect URI → exit 0", () => {
    const r = gate({
      AUTH_SECRET: REAL_AUTH,
      ENCRYPTION_KEY: REAL_ENC,
      RESEND_API_KEY: REAL_RESEND,
      HOSPITABLE_OAUTH_REDIRECT_URI: "https://www.lixusai.com/api/hospitable/oauth/callback",
    });
    expect(r.status).toBe(0);
  });

  it("DEV with empty secrets → exit 0 (development/test not blocked)", () => {
    expect(gate({}, false).status).toBe(0);
  });

  it("PROD + QR_PIN_ENABLED=1 + missing QR_PIN_PEPPER → non-zero exit", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, QR_PIN_ENABLED: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/QR_PIN_PEPPER is missing/);
  });

  it("PROD + QR_PIN_ENABLED=1 + valid distinct QR_PIN_PEPPER → exit 0", () => {
    const r = gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND, QR_PIN_ENABLED: "1", QR_PIN_PEPPER: REAL_PEPPER });
    expect(r.status).toBe(0);
  });

  it("PROD + QR_PIN_ENABLED off + no pepper → exit 0 (env-off deploy never blocked)", () => {
    expect(gate({ AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND }).status).toBe(0);
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
      env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: REAL_AUTH, ENCRYPTION_KEY: REAL_ENC, RESEND_API_KEY: REAL_RESEND },
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
