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

  return { errors, warnings };
}
