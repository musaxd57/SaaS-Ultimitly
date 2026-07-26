import { planPriceMinor, resolveBilling } from "@/lib/app-config";

// Plan catalog (Faz 2). Pure data — safe to import anywhere (no secrets, no DB).
// Property limits follow the roadmap: Başlangıç 1–2, Pro 3–7, İşletme 8+ (∞).
//
// PRICING (set 2026-06, TRY) — decided via market research:
//   Başlangıç ₺449 · Pro ₺899 · İşletme ₺1.699 (aylık) — the SHIPPED defaults.
//   The landing page now READS these (it used to carry its own literals that
//   could drift); per-deployment overrides come from env, see defaultPlans().
// ACQUISITION = reverse trial: every signup gets full Pro free for 14 days (no
//   card); if not upgraded the account pauses — NO permanent free tier. The
//   trial/pause logic is built when billing is switched on.
// NOTE: the `code` "free" is legacy — Başlangıç is now a PAID entry tier. The
//   entitlement logic keys on `propertyLimit` + subscription status, not on this
//   code, so renaming is deferred to the billing build to avoid churn now.

export type PlanDef = {
  code: string; // free | pro | business (mirrors Organization.plan)
  name: string;
  propertyLimit: number | null; // null = unlimited
  priceMinor: number; // smallest unit (kuruş for TRY); 0 = free
  currency: string;
  interval: string; // month | year
  sortOrder: number;
};

/** Shipped .com prices in MINOR UNITS (kuruş). Env may override per deployment. */
export const SHIPPED_PRICE_MINOR = {
  free: 44900, // ₺449
  pro: 89900, // ₺899
  business: 169900, // ₺1.699
} as const;

/**
 * The ONE source of plan prices for this deployment. Landing, the settings
 * checkout card and the JSON-LD offers all read this — previously the landing
 * page carried its own hardcoded "₺449" strings, which could drift silently.
 *
 * Prices are minor-unit INTEGERS end to end (kuruş / cent), never floats: a
 * subscription price that drifts by a hundredth through binary floating point is
 * a billing defect, and Paddle speaks minor units for the same reason.
 *
 * Currency comes from APP_BILLING_CURRENCY (default TRY), NOT from the org's
 * timezone and NOT from the viewer's locale. Amounts are never converted — a
 * deployment configured for EUR must be given EUR prices, because relabelling a
 * lira figure with a euro sign would be a lie.
 *
 * Currency and prices are resolved TOGETHER (resolveBilling) rather than read
 * independently: a deployment that names a foreign currency without supplying all
 * three prices in it gets neither. `useEnvPrices` is false only in that case, and
 * then the partial env numbers are ignored too — they were denominated in the
 * currency we just refused, so showing 3900 as ₺39 would be a different lie in
 * the same family.
 *
 * Read at call time rather than frozen at module load so tests can drive it
 * through env without module-cache games.
 */
export function defaultPlans(env: NodeJS.ProcessEnv = process.env): PlanDef[] {
  const { currency, useEnvPrices } = resolveBilling(env);
  const price = (key: string, shipped: number) =>
    useEnvPrices ? planPriceMinor(key, shipped, env) : shipped;
  return [
    {
      code: "free",
      name: "Başlangıç",
      propertyLimit: 2,
      priceMinor: price("PLAN_PRICE_BASLANGIC_MINOR", SHIPPED_PRICE_MINOR.free),
      currency,
      interval: "month",
      sortOrder: 0,
    },
    {
      code: "pro",
      name: "Pro",
      propertyLimit: 7,
      priceMinor: price("PLAN_PRICE_PRO_MINOR", SHIPPED_PRICE_MINOR.pro),
      currency,
      interval: "month",
      sortOrder: 1,
    },
    {
      code: "business",
      name: "İşletme",
      propertyLimit: 25,
      priceMinor: price("PLAN_PRICE_ISLETME_MINOR", SHIPPED_PRICE_MINOR.business),
      currency,
      interval: "month",
      sortOrder: 2,
    },
  ];
}

export function planByCode(code: string, env: NodeJS.ProcessEnv = process.env): PlanDef | undefined {
  return defaultPlans(env).find((p) => p.code === code);
}
