// Plan catalog (Faz 2). Pure data — safe to import anywhere (no secrets, no DB).
// Property limits follow the roadmap: Başlangıç 1–2, Pro 3–7, İşletme 8+ (∞).
//
// PRICING (set 2026-06, TRY) — decided via market research:
//   Başlangıç ₺449 · Pro ₺899 · İşletme ₺1.699 (aylık). Keep in sync with the
//   landing TIERS in src/components/marketing/landing-page.tsx.
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

export const DEFAULT_PLANS: PlanDef[] = [
  { code: "free", name: "Başlangıç", propertyLimit: 2, priceMinor: 44900, currency: "TRY", interval: "month", sortOrder: 0 },
  { code: "pro", name: "Pro", propertyLimit: 7, priceMinor: 89900, currency: "TRY", interval: "month", sortOrder: 1 },
  { code: "business", name: "İşletme", propertyLimit: 200, priceMinor: 169900, currency: "TRY", interval: "month", sortOrder: 2 },
];

export function planByCode(code: string): PlanDef | undefined {
  return DEFAULT_PLANS.find((p) => p.code === code);
}
