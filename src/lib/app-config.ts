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

/**
 * The three plan-price env vars, in catalog order (Başlangıç, Pro, İşletme).
 * These decide what we DISPLAY. What is actually CHARGED comes from a separate
 * set (PADDLE_PRICE_BASLANGIC / _PRO / _ISLETME), and for a non-TRY deployment
 * the boot gate requires BOTH sets — see scripts/env-check.mjs. That gate keeps
 * its own copy of these names because it is plain ESM that runs before the TS
 * runtime and cannot import this module; keep the two lists in step.
 */
export const PLAN_PRICE_ENV_KEYS = [
  "PLAN_PRICE_BASLANGIC_MINOR",
  "PLAN_PRICE_PRO_MINOR",
  "PLAN_PRICE_ISLETME_MINOR",
] as const;

export type ResolvedBilling = {
  /** The currency every displayed subscription price is denominated in. */
  currency: string;
  /**
   * Whether PLAN_PRICE_*_MINOR overrides may be used at all. False only in the
   * misconfigured case below, where the supplied numbers were meant for a
   * currency we are refusing to use.
   */
  useEnvPrices: boolean;
};

/**
 * Resolve the billing currency AND whether the env prices may be used, as ONE
 * decision. Everything that shows a subscription price reads this — never the
 * currency and the prices through two independent lookups.
 *
 * That single-resolver rule is load-bearing, not tidiness. The settings page
 * passes `currency={appBillingCurrency()}` and `plans={defaultPlans()}` as
 * SEPARATE props; if those two could disagree, the plan-change dialog would
 * render a lira amount with a euro sign — the precise thing this file forbids.
 *
 * Three cases:
 *
 *  1. No currency set, invalid, or the shipped one → shipped currency, and
 *     per-plan price overrides ARE honoured. They are denominated in the same
 *     currency as the shipped defaults, so overriding one and inheriting the
 *     others is coherent. This is today's .com and it is untouched.
 *
 *  2. A different currency AND all three prices supplied → both are used.
 *
 *  3. A different currency with any price missing or malformed → the currency is
 *     REFUSED along with the partial prices. Prices and currency move together
 *     or not at all: honouring the currency alone would relabel lira as euro,
 *     and honouring the partial prices alone would show €39 as ₺39. Falling all
 *     the way back to the shipped pair is the only outcome that states something
 *     true. Production never reaches this case — scripts/env-check.mjs refuses to
 *     boot on it — but the invariant must not depend on that gate having run.
 */
export function resolveBilling(env: NodeJS.ProcessEnv = process.env): ResolvedBilling {
  const requested = (env.APP_BILLING_CURRENCY ?? "").trim().toUpperCase();
  if (!requested || !isValidCurrencyCode(requested) || requested === DEFAULT_BILLING_CURRENCY) {
    return { currency: DEFAULT_BILLING_CURRENCY, useEnvPrices: true };
  }
  const complete = PLAN_PRICE_ENV_KEYS.every((k) => explicitPlanPriceMinor(k, env) !== null);
  return complete
    ? { currency: requested, useEnvPrices: true }
    : { currency: DEFAULT_BILLING_CURRENCY, useEnvPrices: false };
}

/** Resolve the subscription billing currency. Same fallback contract as above. */
export function appBillingCurrency(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBilling(env).currency;
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
  return explicitPlanPriceMinor(key, env) ?? fallbackMinor;
}

/**
 * Same read as planPriceMinor but WITHOUT a fallback: null means "this deployment
 * did not supply a usable price for this plan". Unset and malformed both return
 * null on purpose — a value the parser rejects is not a configured price, and
 * counting it as one is how a half-configured deployment slips through.
 */
export function explicitPlanPriceMinor(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = (env[key] ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null; // no signs, no decimals, no floats
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}
