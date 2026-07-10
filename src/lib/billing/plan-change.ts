import "server-only";

import { prisma } from "@/lib/db";
import { DEFAULT_PLANS, planByCode, type PlanDef } from "./plans";

// ---------------------------------------------------------------------------
// In-app plan change (upgrade / downgrade). Paddle's hosted customer portal does
// NOT offer plan changes (only cancel + payment method), so the seller has to
// drive PATCH /subscriptions/{id} directly. This module holds the pure decision
// helpers; the actual Paddle calls live in payments/paddle.ts.
//
// GATED: OFF by default. While off, the app keeps the portal-only "manage"
// button and the plan cards stay locked — nothing here is reachable. Flip
// PADDLE_PLAN_CHANGE_ENABLED on ONLY after a real plan change is verified live.
// ---------------------------------------------------------------------------

/** In-app upgrade/downgrade buttons enabled? Default OFF → portal-only. */
export function planChangeEnabled(): boolean {
  const v = process.env.PADDLE_PLAN_CHANGE_ENABLED;
  return v === "true" || v === "1";
}

export type PlanChangeMode = "upgrade" | "downgrade" | "same" | "unknown";

/**
 * Classify a target plan relative to the current one by catalog order. A higher
 * sortOrder is an upgrade, lower is a downgrade. An unknown target → "unknown"
 * (caller rejects); no known current (e.g. grandfathered) → treat as "upgrade".
 */
export function planChangeMode(currentCode: string, targetCode: string): PlanChangeMode {
  const tgt = DEFAULT_PLANS.find((p) => p.code === targetCode);
  if (!tgt) return "unknown";
  const cur = DEFAULT_PLANS.find((p) => p.code === currentCode);
  if (!cur) return "upgrade";
  if (cur.code === tgt.code) return "same";
  return tgt.sortOrder > cur.sortOrder ? "upgrade" : "downgrade";
}

/** Paddle price id for a plan code (from env), or null when unconfigured. */
export function priceIdForPlanCode(code: string): string | null {
  const map: Record<string, string | undefined> = {
    free: process.env.PADDLE_PRICE_BASLANGIC?.trim(),
    pro: process.env.PADDLE_PRICE_PRO?.trim(),
    business: process.env.PADDLE_PRICE_ISLETME?.trim(),
  };
  return map[code] || null;
}

export type ProrationMode = "prorated_immediately" | "prorated_next_billing_period";

/**
 * Paddle proration mode for a change. Upgrade → charge the prorated difference
 * NOW and switch immediately. Downgrade → apply at the next billing period so the
 * customer keeps the tier they already paid for until it renews (no refund math).
 */
export function prorationModeFor(mode: PlanChangeMode): ProrationMode {
  return mode === "downgrade" ? "prorated_next_billing_period" : "prorated_immediately";
}

export type ResolvedPlanChange =
  | {
      ok: true;
      providerRef: string;
      currentCode: string;
      mode: Exclude<PlanChangeMode, "same" | "unknown">;
      proration: ProrationMode;
      priceId: string;
      target: PlanDef;
    }
  | { ok: false; error: string };

/**
 * Validate a requested plan change for an org and resolve everything the Paddle
 * call needs: the subscription's providerRef, the target price id, and the
 * upgrade/downgrade proration mode. Shared by the preview + apply routes so both
 * enforce the SAME guards (real Paddle sub, known target, not the same plan,
 * configured price). Org id comes from the session at the call site → IDOR-proof.
 */
export async function resolvePlanChange(
  organizationId: string,
  planCode: string,
): Promise<ResolvedPlanChange> {
  const target = planByCode(planCode);
  if (!target) return { ok: false, error: "Geçersiz plan." };

  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { provider: true, providerRef: true, planCode: true },
  });
  if (!sub || sub.provider !== "paddle" || !sub.providerRef) {
    return { ok: false, error: "Yönetilecek bir Paddle aboneliği bulunamadı." };
  }

  const mode = planChangeMode(sub.planCode, planCode);
  if (mode === "same") return { ok: false, error: "Zaten bu plandasınız." };
  if (mode === "unknown") return { ok: false, error: "Geçersiz plan." };

  const priceId = priceIdForPlanCode(planCode);
  if (!priceId) return { ok: false, error: "Plan fiyatı yapılandırılmadı." };

  return {
    ok: true,
    providerRef: sub.providerRef,
    currentCode: sub.planCode,
    mode,
    proration: prorationModeFor(mode),
    priceId,
    target,
  };
}
