// Plan catalog (Faz 2). Pure data — safe to import anywhere (no secrets, no DB).
// Property limits follow the roadmap: Başlangıç 1–2, Pro 3–7, İşletme 8+ (∞).
//
// ⚠️ PRICES ARE PLACEHOLDERS — set your real pricing before launch. The runtime
// entitlement logic uses `propertyLimit` from here; the DB `Plan` table mirrors
// this for display/checkout and is seeded from the same values.

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
  { code: "free", name: "Başlangıç", propertyLimit: 2, priceMinor: 0, currency: "TRY", interval: "month", sortOrder: 0 },
  { code: "pro", name: "Pro", propertyLimit: 7, priceMinor: 49900, currency: "TRY", interval: "month", sortOrder: 1 },
  { code: "business", name: "İşletme", propertyLimit: null, priceMinor: 99900, currency: "TRY", interval: "month", sortOrder: 2 },
];

export function planByCode(code: string): PlanDef | undefined {
  return DEFAULT_PLANS.find((p) => p.code === code);
}
