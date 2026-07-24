import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
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

// ---------------------------------------------------------------------------
// Preview → apply binding. A plan change (esp. an upgrade that charges NOW) must
// be applied ONLY via a change the customer previewed. The preview route mints an
// HMAC-signed, short-lived token binding {org, priceId, mode, amount}; the apply
// route REQUIRES it and re-checks it against the resolved change + session. So the
// apply endpoint can't be called blind (no preview), can't be reused for a
// different plan/price, and can't be replayed after it expires.
// ---------------------------------------------------------------------------

const PLAN_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

type PlanTokenPayload = {
  org: string;
  priceId: string;
  mode: "upgrade" | "downgrade";
  amount: string | null; // the immediate charge shown at preview (bound + re-checked at apply)
  jti: string; // single-use nonce (consumed once at apply — expiry is NOT single-use)
  exp: number;
};

function planTokenSecret(): string {
  return process.env.AUTH_SECRET ?? "";
}

/** Sign a preview token binding the change the customer just saw. A fresh random
 *  jti makes it single-use: apply consumes the jti once (see consumePlanChangeNonce). */
export function signPlanChangeToken(p: Omit<PlanTokenPayload, "exp" | "jti">): string {
  const payload: PlanTokenPayload = {
    ...p,
    jti: randomBytes(12).toString("base64url"),
    exp: Date.now() + PLAN_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", planTokenSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Verify a preview token: HMAC + not-expired. Returns the payload or null. */
export function verifyPlanChangeToken(token: string | undefined | null): PlanTokenPayload | null {
  const secret = planTokenSecret();
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  let ok = false;
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    ok = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: PlanTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlanTokenPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  if (typeof payload.jti !== "string" || payload.jti.length === 0) return null; // single-use id required
  return payload;
}

// ---------------------------------------------------------------------------
// Single-use enforcement. The HMAC token proves "the customer previewed THIS
// change"; the jti makes it usable ONCE. Apply CLAIMS the jti in SystemLock (a
// unique @id row) BEFORE the Paddle mutation — a concurrent double-submit or a
// replay within the 10-min TTL finds the row already present and is refused, so
// it can't drive a second PATCH/charge. DB-backed → correct across replicas
// (unlike the in-memory rate-limiter). On a FAILED apply the jti is released so
// the customer can retry the same token (nothing was charged).
// ---------------------------------------------------------------------------

const NONCE_PREFIX = "plan-change-nonce:";

/** Atomically claim a token's jti. Returns true on first use, false if already
 *  consumed (replay / double-submit). Throws only on an unexpected DB error →
 *  the caller must fail closed (no charge). */
export async function consumePlanChangeNonce(jti: string, expiresAt: Date): Promise<boolean> {
  // Opportunistic sweep: an expired nonce can't be replayed (its token is expired
  // too), so the row is safe to drop — keeps SystemLock from growing unbounded.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: NONCE_PREFIX }, lockedUntil: { lt: new Date() } } })
    .catch(() => {});
  try {
    await prisma.systemLock.create({ data: { name: `${NONCE_PREFIX}${jti}`, lockedUntil: expiresAt } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** Release a claimed jti (only after a FAILED apply) so the token can be retried. */
export async function releasePlanChangeNonce(jti: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: `${NONCE_PREFIX}${jti}` } }).catch(() => {});
}
