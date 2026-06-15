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
  trialing: boolean; // currently inside the free reverse-trial
  trialEndsAt: Date | null;
  trialDaysLeft: number | null; // whole days left (0 once past), null when not trialing
  trialExpired: boolean; // a trial whose end date has passed (effect gated by enforcement)
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "grandfathered"]);

// Reverse trial: every new signup gets full Pro free for this many days (no
// card). If they don't upgrade, access pauses — ONLY once billing is enforced.
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 14;

/** End date for a trial starting now (or at `from`). */
export function trialEndDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Subscription row data for a brand-new signup: a Pro reverse-trial. Stored even
 * while billing is dormant — entitlement treats `trialing` exactly like
 * grandfathered until BILLING_ENFORCED is on, so it changes nothing today.
 */
export function newTrialSubscriptionData() {
  return {
    planCode: "pro",
    status: "trialing",
    provider: "trial",
    trialEndsAt: trialEndDate(),
  };
}

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
      trialing: false,
      trialEndsAt: null,
      trialDaysLeft: null,
      trialExpired: false,
    };
  }
  const plan = planByCode(sub.planCode);
  const now = Date.now();
  const trialing = sub.status === "trialing";
  const trialEndsAt = sub.trialEndsAt ?? null;
  const trialExpired = trialing && trialEndsAt != null && trialEndsAt.getTime() <= now;
  const trialDaysLeft =
    trialing && trialEndsAt != null
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / 86_400_000))
      : null;

  let active = ACTIVE_STATUSES.has(sub.status);
  // An expired reverse-trial only loses access once billing is actually
  // enforced. Until then every org stays unblocked (dormant by design), so
  // flipping BILLING_ENFORCED off always restores access — the true kill-switch.
  if (trialExpired && billingEnforced()) active = false;

  return {
    planCode: sub.planCode,
    planName: plan?.name ?? sub.planCode,
    propertyLimit: plan ? plan.propertyLimit : null,
    status: sub.status,
    active,
    grandfathered: sub.status === "grandfathered",
    trialing,
    trialEndsAt,
    trialDaysLeft,
    trialExpired,
  };
}

/**
 * May this org use PAID features right now (AI auto-reply, automated messages,
 * AI suggest/test, translate, QR)? Free/expired tier keeps browsing + manual
 * work but loses the OpenAI-spending automation. DORMANT-SAFE: always true while
 * BILLING_ENFORCED is off, so nothing is gated until the paywall is switched on.
 * Grandfathered/active/trialing orgs (incl. the founder) are always allowed.
 */
export async function premiumAllowed(organizationId: string): Promise<boolean> {
  if (!billingEnforced()) return true;
  return (await getEntitlement(organizationId)).active;
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
