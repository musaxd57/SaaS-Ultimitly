// SINGLE SOURCE OF TRUTH for the production boot env gate.
// Pure: no side effects, never prints a secret VALUE — only field names. Returns
// { errors, warnings }: a non-empty `errors` list means production must NOT start.
// Used by the prestart gate (scripts/verify-env.mjs). Plain ESM so it runs in a
// standalone node process BEFORE `next start`, without the Next/TS runtime.

// The dev default shipped in .env.example — running production with it means every
// session signature (AUTH_SECRET) / stored secret (ENCRYPTION_KEY) is forgeable or
// derivable by anyone who has read the repo.
export const DEV_PLACEHOLDER_SECRET = "dev-secret-change-me-please-32-bytes-min";

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkProductionEnv(env) {
  const errors = [];
  const warnings = [];

  const authSecret = (env.AUTH_SECRET ?? "").trim();
  if (!authSecret) {
    errors.push("AUTH_SECRET is missing.");
  } else if (authSecret === DEV_PLACEHOLDER_SECRET) {
    errors.push("AUTH_SECRET is still the dev placeholder from .env.example — set a real random secret.");
  } else if (authSecret.length < 32) {
    warnings.push("AUTH_SECRET is shorter than 32 characters — prefer a longer random secret.");
  }

  const encKey = (env.ENCRYPTION_KEY ?? "").trim();
  if (!encKey) {
    // REQUIRED in production, independent of AUTH_SECRET: crypto.ts falls back to
    // AUTH_SECRET when this is unset, so rotating AUTH_SECRET (as happened once)
    // would make every stored 2FA / Hospitable secret undecryptable.
    errors.push("ENCRYPTION_KEY is missing — REQUIRED in production (do not rely on the AUTH_SECRET fallback).");
  } else if (encKey === DEV_PLACEHOLDER_SECRET) {
    errors.push("ENCRYPTION_KEY is the dev placeholder — set a real random key.");
  } else if (encKey === authSecret) {
    errors.push("ENCRYPTION_KEY must be independent of AUTH_SECRET (they are currently equal).");
  } else if (encKey.length < 32) {
    warnings.push("ENCRYPTION_KEY is shorter than 32 characters — prefer a longer random key.");
  }

  // QR PIN pepper (Faz 5, #14). ONLY enforced when the feature is switched on
  // (QR_PIN_ENABLED=1) — with it off the whole PIN system is dormant and no
  // pepper is needed, so an env-off deployment is never blocked. When on, the
  // PIN HMAC must NOT fall back to AUTH_SECRET (guest-chat-pin.ts uses that
  // fallback for dev/test only): a dedicated, independent, ≥32-char pepper is
  // required so rotating AUTH_SECRET can't silently invalidate live PINs and the
  // session secret is never doubled as the PIN key.
  if ((env.QR_PIN_ENABLED ?? "").trim() === "1") {
    const pepper = (env.QR_PIN_PEPPER ?? "").trim();
    if (!pepper) {
      errors.push("QR_PIN_PEPPER is missing — REQUIRED when QR_PIN_ENABLED=1 (do not rely on the AUTH_SECRET fallback).");
    } else if (pepper === DEV_PLACEHOLDER_SECRET) {
      errors.push("QR_PIN_PEPPER is the dev placeholder — set a real random pepper.");
    } else if (pepper === authSecret) {
      errors.push("QR_PIN_PEPPER must be independent of AUTH_SECRET (they are currently equal).");
    } else if (pepper.length < 32) {
      errors.push("QR_PIN_PEPPER must be at least 32 characters.");
    }
  }

  // KVKK guest-erasure tombstone HMAC secret (m40). ONLY enforced when the
  // host-facing surface is switched on (GUEST_ERASURE_ENABLED=1) — with it off no
  // tombstone can be created, the ingress guards are inert on an empty table, and
  // an env-off deployment is never blocked. When on, a DEDICATED secret is
  // required (never the session/crypto secrets doubled up): tombstone matching
  // must survive an AUTH_SECRET/ENCRYPTION_KEY rotation, and a leak of one secret
  // must not let anyone recompute guest-identifier hashes. NEVER rotate it once
  // tombstones exist — matching would silently break (erasure guard goes blind).
  if ((env.GUEST_ERASURE_ENABLED ?? "").trim() === "1") {
    const erasureSecret = (env.ERASURE_HMAC_SECRET ?? "").trim();
    if (!erasureSecret) {
      errors.push("ERASURE_HMAC_SECRET is missing — REQUIRED when GUEST_ERASURE_ENABLED=1 (no fallback in production).");
    } else if (erasureSecret === DEV_PLACEHOLDER_SECRET) {
      errors.push("ERASURE_HMAC_SECRET is the dev placeholder — set a real random secret.");
    } else if (erasureSecret === authSecret) {
      errors.push("ERASURE_HMAC_SECRET must be independent of AUTH_SECRET (they are currently equal).");
    } else if (erasureSecret === encKey) {
      errors.push("ERASURE_HMAC_SECRET must be independent of ENCRYPTION_KEY (they are currently equal).");
    } else if (erasureSecret.length < 32) {
      errors.push("ERASURE_HMAC_SECRET must be at least 32 characters.");
    }
  }

  // Private object storage (S3/R2) — ONLY enforced when the feature is switched
  // on (STORAGE_ENABLED=1/true). With it off the storage system is dormant and
  // none of these are needed, so an env-off deployment is never blocked. When
  // on, every provider credential must be present and the endpoint must be
  // HTTPS (a plaintext endpoint would leak signed URLs and objects). Only field
  // NAMES are ever printed — never a value.
  const storageOn = ["1", "true"].includes((env.STORAGE_ENABLED ?? "").trim().toLowerCase());
  if (storageOn) {
    const endpoint = (env.STORAGE_ENDPOINT ?? "").trim();
    if (!endpoint) {
      errors.push("STORAGE_ENDPOINT is missing — REQUIRED when STORAGE_ENABLED is on.");
    } else if (!/^https:\/\//i.test(endpoint)) {
      errors.push("STORAGE_ENDPOINT must be an https:// URL.");
    }
    if (!(env.STORAGE_BUCKET ?? "").trim()) {
      errors.push("STORAGE_BUCKET is missing — REQUIRED when STORAGE_ENABLED is on.");
    }
    if (!(env.STORAGE_ACCESS_KEY_ID ?? "").trim()) {
      errors.push("STORAGE_ACCESS_KEY_ID is missing — REQUIRED when STORAGE_ENABLED is on.");
    }
    const storageSecret = (env.STORAGE_SECRET_ACCESS_KEY ?? "").trim();
    if (!storageSecret) {
      errors.push("STORAGE_SECRET_ACCESS_KEY is missing — REQUIRED when STORAGE_ENABLED is on.");
    } else if (storageSecret === DEV_PLACEHOLDER_SECRET) {
      errors.push("STORAGE_SECRET_ACCESS_KEY is the dev placeholder — set the real provider secret.");
    }
  }

  // Transactional email provider. The app sends account-critical mail — email
  // verification, password-reset codes, operator alerts — so production MUST have a
  // working provider; without one those flows fail OPEN (silently "succeed" while no
  // mail is sent, or the DEV console fallback would echo a verification link). Accept
  // Resend (HTTP API — works where Railway blocks SMTP ports) OR a COMPLETE SMTP set
  // (host + user + pass). A PARTIAL SMTP config is an error (it would fail every send
  // at runtime). Only field NAMES are printed. Enforced in production only (dev/test
  // never blocked — verify-env just warns).
  const hasResend = Boolean((env.RESEND_API_KEY ?? "").trim());
  const smtpHost = (env.EMAIL_HOST ?? "").trim();
  const smtpUser = (env.EMAIL_USER ?? "").trim();
  const smtpPass = (env.EMAIL_PASS ?? "").trim();
  if (!hasResend) {
    if (!smtpHost && !smtpUser && !smtpPass) {
      errors.push(
        "No email provider configured — set RESEND_API_KEY, or a complete SMTP set (EMAIL_HOST + EMAIL_USER + EMAIL_PASS). Verification/password-reset/alert mail fails open without one.",
      );
    } else if (!(smtpHost && smtpUser && smtpPass)) {
      errors.push(
        "SMTP is only PARTIALLY configured — EMAIL_HOST, EMAIL_USER and EMAIL_PASS are ALL required (or set RESEND_API_KEY instead).",
      );
    }
  }

  // Automation heartbeat. The 2-min sync + auto-reply + welcome/check-in/checkout
  // engine runs ONLY when CRON_SECRET is set: the internal cron returns early
  // without it and the external /api/cron/sync 401s. Missing it means automation
  // silently stops while /api/health stays 200 — a silent outage. WARN (not error)
  // so a deployment that drives sync by some other means is never blocked, but the
  // most common misconfiguration is surfaced at boot instead of discovered later.
  if (!(env.CRON_SECRET ?? "").trim()) {
    warnings.push(
      "CRON_SECRET is missing — the sync/auto-reply engine will not run (internal cron idle, external cron 401s).",
    );
  }

  return { errors, warnings };
}
