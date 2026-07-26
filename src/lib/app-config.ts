// DEPLOYMENT-LEVEL locale / currency. Server-only by design.
//
// The .com and .eu instances are SEPARATE deployments of this codebase, each with
// its own env and database (see auth/email-verify.ts). That is what makes a
// deployment-level setting sufficient here: one database never mixes customers who
// should be billed in different currencies, so none of this needs an org column and
// none of it needs a migration.
//
// FOUR THINGS THAT ARE NOT THE SAME, and are kept apart on purpose:
//
//   locale            how numbers and dates are FORMATTED (APP_LOCALE)
//   billing currency  what WE charge for a subscription (APP_BILLING_CURRENCY)
//   record currency   what a specific stored row is denominated in — the guest's
//                     booking (Reservation.currency, from the channel) or the real
//                     charge (Invoice.currency, from the Paddle event). ALWAYS
//                     authoritative over the deployment setting; a stored amount is
//                     never re-labelled with a different symbol.
//   organization tz   Organization.timezone. Says NOTHING about money. A host in
//                     Europe/Berlin may still be billed in TRY.
//
// No conversion happens anywhere in this codebase. A number is only ever rendered
// with the currency it is actually denominated in — formatting is not conversion.

/** Shipped default — the .com deployment. Changing this changes .com. */
export const DEFAULT_LOCALE = "tr-TR";
/** Shipped default — the .com deployment bills in Turkish lira. */
export const DEFAULT_BILLING_CURRENCY = "TRY";

/** Does the runtime's Intl actually accept this as a locale? */
export function isValidLocale(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    // Throws RangeError on a structurally invalid tag. A well-formed but unknown
    // tag falls back to the default locale rather than throwing, which is fine:
    // formatting still works and never crashes a page.
    return Intl.NumberFormat.supportedLocalesOf([v]).length > 0 || new Intl.NumberFormat(v) !== null;
  } catch {
    return false;
  }
}

/** ISO 4217: exactly three letters, and one Intl will format with. */
export function isValidCurrencyCode(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: v }).format(1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the display locale. Invalid values fall back rather than throw — a bad
 * env must never blank out a page. The boot gate (scripts/env-check.mjs) refuses
 * to start production with an invalid value, so this fallback is a safety net for
 * dev, not a way to run production misconfigured.
 */
export function appLocale(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.APP_LOCALE ?? "").trim();
  return raw && isValidLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** Resolve the subscription billing currency. Same fallback contract as above. */
export function appBillingCurrency(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.APP_BILLING_CURRENCY ?? "").trim().toUpperCase();
  return raw && isValidCurrencyCode(raw) ? raw : DEFAULT_BILLING_CURRENCY;
}

/**
 * Read a plan price in MINOR UNITS (kuruş, cent) from env.
 *
 * Minor-unit integers, never floats: 449.90 cannot be represented exactly in
 * binary floating point, and a subscription price that drifts by a hundredth is a
 * billing defect. Paddle speaks minor units for the same reason.
 *
 * A malformed value falls back to the shipped default rather than charging a
 * wrong number; the boot gate rejects it in production.
 */
export function planPriceMinor(
  key: string,
  fallbackMinor: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (env[key] ?? "").trim();
  if (!raw) return fallbackMinor;
  if (!/^\d+$/.test(raw)) return fallbackMinor; // no signs, no decimals, no floats
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : fallbackMinor;
}
