import "server-only";

import { prisma } from "@/lib/db";
import { planByCode } from "./plans";

// ---------------------------------------------------------------------------
// Subscription entitlements (Faz 2). SAFE BY DESIGN — see ROADMAP "en kritik
// risk: canlı müşterileri yanlışlıkla paywall'a düşürmemek".
//
//   * An org with NO Subscription row → grandfathered → active → UNLIMITED.
//     (This is the backfill-by-default: every existing customer stays unblocked.)
//   * Enforcement only ever happens when BILLING_ENFORCED=true.
//
// Nothing here is wired into property creation yet — turning the paywall ON is a
// deliberate, separate step taken only after existing orgs are confirmed active.
// ---------------------------------------------------------------------------

export type Entitlement = {
  planCode: string;
  planName: string;
  propertyLimit: number | null; // null = unlimited
  status: string;
  active: boolean; // may the org use paid features right now?
  grandfathered: boolean; // existing org, no subscription row
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "grandfathered"]);

/** True only when billing is explicitly enforced. Default OFF → nothing blocked. */
export function billingEnforced(): boolean {
  return process.env.BILLING_ENFORCED === "true";
}

/** Resolve an organization's current entitlement (permissive default). */
export async function getEntitlement(organizationId: string): Promise<Entitlement> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub) {
    return {
      planCode: "grandfathered",
      planName: "Mevcut müşteri",
      propertyLimit: null,
      status: "grandfathered",
      active: true,
      grandfathered: true,
    };
  }
  const plan = planByCode(sub.planCode);
  return {
    planCode: sub.planCode,
    planName: plan?.name ?? sub.planCode,
    propertyLimit: plan ? plan.propertyLimit : null,
    status: sub.status,
    active: ACTIVE_STATUSES.has(sub.status),
    grandfathered: sub.status === "grandfathered",
  };
}

export type AddPropertyCheck = {
  allowed: boolean;
  reason?: "subscription_inactive" | "property_limit";
  limit?: number | null;
  current?: number;
};

/**
 * Whether the org may add another property. NON-BLOCKING unless billing is
 * enforced, so calling this today always returns { allowed: true }.
 */
export async function canAddProperty(organizationId: string): Promise<AddPropertyCheck> {
  if (!billingEnforced()) return { allowed: true };

  const ent = await getEntitlement(organizationId);
  if (!ent.active) return { allowed: false, reason: "subscription_inactive" };
  if (ent.propertyLimit == null) return { allowed: true, limit: null };

  const current = await prisma.property.count({ where: { organizationId } });
  if (current >= ent.propertyLimit) {
    return { allowed: false, reason: "property_limit", limit: ent.propertyLimit, current };
  }
  return { allowed: true, limit: ent.propertyLimit, current };
}
