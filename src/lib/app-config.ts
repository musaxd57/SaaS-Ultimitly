// DEPLOYMENT-LEVEL locale / currency / default timezone. Server-only by design.
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
//                     Europe/Berlin may still be billed in TRY. This file only
//                     supplies the DEFAULT for a brand-new org
//                     (APP_DEFAULT_TIMEZONE); the per-org value lives in the DB
//                     and the host can change it in Settings.
//
// No conversion happens anywhere in this codebase. A number is only ever rendered
// with the currency it is actually denominated in — formatting is not conversion.
// And a timezone is never INFERRED from a locale or a currency: those three are
// independent inputs, and guessing one from another is wrong for every host who
// doesn't sit at the intersection.

// DEFAULT_TIMEZONE / isValidTimeZone come from lib/timezone.ts, which stays
// deliberately env-free (it is imported all over the app, including from code
// that runs in the browser). Reading env is this module's job; the direction of
// that import must not reverse.
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/timezone";

/** Shipped default — the .com deployment. Changing this changes .com. */
export const DEFAULT_LOCALE = "tr-TR";
/** Shipped default — the .com deployment bills in Turkish lira. */
export const DEFAULT_BILLING_CURRENCY = "TRY";

/**
 * Does this runtime actually have locale DATA for this tag?
 *
 * `new Intl.NumberFormat(tag)` is not the test: it only throws on a structurally
 * malformed tag. "zz-ZZ", "qq" and "xx-XX" are perfectly well-formed BCP-47 and
 * construct without complaint — they just silently fall back to the default
 * locale. So a typo'd APP_LOCALE would pass every check and then quietly format
 * nothing the way the operator intended.
 *
 * `supportedLocalesOf` answers the real question, and it does not over-reject:
 * tr-TR, de-DE, en, en-US, fr, it-IT and extension subtags (tr-TR-u-nu-latn) all
 * come back supported. It still throws RangeError on malformed input, hence the
 * try/catch.
 */
export function isValidLocale(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    return Intl.NumberFormat.supportedLocalesOf([v]).length > 0;
  } catch {
    return false;
  }
}

/**
 * Currencies this product can actually BILL in — a closed list, not a format check.
 *
 * "Can Intl format it?" is the wrong question and was the wrong check: Intl
 * happily renders "EUU 1.00", "ZZZ 1.00", "QQQ 1.00" for codes that are not
 * currencies at all, so a single mistyped letter in APP_BILLING_CURRENCY used to
 * sail through. Even the real ISO 4217 list would be too loose — XXX is a
 * genuine code meaning "no currency", and nothing can be billed in it.
 *
 * The list is closed on purpose. Supporting a currency is not a formatting
 * concern: it needs three plan prices denominated in it AND three Paddle price
 * ids that charge in it (see scripts/env-check.mjs). Adding one is therefore a
 * deliberate code change, reviewed alongside those values — which is exactly the
 * forcing function we want.
 *
 * SCOPE: this governs the SUBSCRIPTION currency only. Record currencies — a
 * guest's booking (Reservation.currency) or a real charge (Invoice.currency) —
 * are never validated against this and never restricted; a USD booking renders
 * as USD. formatCurrency takes whatever the record says.
 */
export const SUPPORTED_BILLING_CURRENCIES = ["TRY", "EUR"] as const;

export function isSupportedBillingCurrency(value: string): boolean {
  const v = value.trim().toUpperCase();
  return (SUPPORTED_BILLING_CURRENCIES as readonly string[]).includes(v);
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
 * Default IANA timezone for organizations created on THIS deployment. Unset →
 * Europe/Istanbul, which is both the shipped .com answer and the column default
 * that every existing org already carries, so leaving it unset changes nothing.
 *
 * Only a DEFAULT. It is the answer when the browser tells us nothing usable; the
 * real per-org value is whatever resolveNewOrgTimezone() settles on at sign-up
 * and whatever the host later picks in Settings.
 *
 * An invalid value falls back rather than throwing — a bad env must not break
 * sign-up — and the boot gate refuses to start production with one, so this
 * fallback is a dev safety net, not a way to run misconfigured.
 */
export function appDefaultTimezone(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.APP_DEFAULT_TIMEZONE ?? "").trim();
  return raw && isValidTimeZone(raw) ? raw : DEFAULT_TIMEZONE;
}

/** Longest real IANA zone name is ~32 chars; this is slack, not a limit anyone hits. */
const MAX_TIMEZONE_LENGTH = 64;

/**
 * Settle the timezone for a NEW organization from the browser's own report
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`, posted by the sign-up
 * form), falling back to this deployment's default.
 *
 * The candidate is CLIENT-SUPPLIED, so it is validated against the real IANA set
 * before it can reach the database. The blast radius is small either way — a host
 * can only set their own org's zone, and Settings already lets them change it —
 * but an unvalidated value would put junk in a column that drives day boundaries
 * and send windows.
 *
 * Anything unusable — absent, blank, wrong type, over-long, not a zone Intl knows
 * — falls back silently. It must NEVER reject a registration: a stale browser
 * reporting an odd zone is not a reason to refuse someone an account, and the
 * host can correct it in Settings in one click.
 */
export function resolveNewOrgTimezone(
  candidate: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof candidate === "string") {
    const v = candidate.trim();
    // Length first: a megabyte of junk should never reach Intl.
    if (v && v.length <= MAX_TIMEZONE_LENGTH && isValidTimeZone(v)) return v;
  }
  return appDefaultTimezone(env);
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
  if (!requested || !isSupportedBillingCurrency(requested) || requested === DEFAULT_BILLING_CURRENCY) {
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
 * did not supply a usable price for this plan". Unset, malformed, zero and
 * beyond-safe-integer all return null on purpose — a value the parser refuses is
 * not a configured price, and counting it as one is how a half-configured
 * deployment slips through the completeness check.
 *
 * Zero is rejected because all three plans are PAID. The `free` plan code is
 * legacy naming (Başlangıç is the paid entry tier) and there is no permanent free
 * tier, so a 0 here means a typo or a half-finished edit — and it would ship a
 * "€0 / ₺0" plan card to real customers.
 *
 * Above Number.isSafeInteger the parsed value is no longer the number that was
 * written, so it is refused rather than silently charged as something else.
 * scripts/env-check.mjs applies the identical rule; tests pin the two in step.
 */
export function explicitPlanPriceMinor(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = (env[key] ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null; // no signs, no decimals, no floats
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) return null;
  return n > 0 ? n : null;
}
