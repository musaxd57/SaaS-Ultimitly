import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { isPaddleConfigured, previewSubscriptionUpdate } from "@/lib/payments/paddle";
import { planChangeEnabled, resolvePlanChange, signPlanChangeToken } from "@/lib/billing/plan-change";

// Preview an in-app plan change WITHOUT applying it, so the confirm dialog can show
// the exact prorated charge Paddle will make. Gated behind PADDLE_PLAN_CHANGE_ENABLED
// (404 while off). withOwner → account owner only (billing is owner-scoped, matching
// the UI); org comes from the SESSION → IDOR-proof.
// The preview amounts are best-effort (Paddle owns the real charge on apply).
export const POST = withOwner(async (session, req) => {
  if (!planChangeEnabled()) return notFound();
  const limited = await rateLimit(`plan-preview:${session.organizationId}`, 30, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  if (!isPaddleConfigured()) return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });

  const data = (await readJsonCappedOrNull(req)) as { planCode?: unknown } | null;
  const planCode = typeof data?.planCode === "string" ? data.planCode : "";

  const r = await resolvePlanChange(session.organizationId, planCode);
  if (!r.ok) return badRequest({ error: r.error });
  const pending = await prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${session.organizationId}` } });
  if (pending && pending.lockedUntil > new Date()) {
    return NextResponse.json(
      { error: "Önceki plan değişikliği doğrulanıyor — birkaç dakika içinde netleşecek.", pendingVerification: true },
      { status: 409 },
    );
  }

  const preview = await previewSubscriptionUpdate(r.providerRef, r.priceId, r.proration, session.organizationId);
  // Sign the previewed change so /plan-change can bind apply → this exact preview
  // (same org + target price + mode), within a short window.
  const previewToken = signPlanChangeToken({
    org: session.organizationId,
    priceId: r.priceId,
    mode: r.mode,
    amount: preview?.immediateTotal ?? null,
  });
  return jsonOk({
    mode: r.mode, // "upgrade" | "downgrade"
    targetName: r.target.name,
    targetMonthly: r.target.priceMinor / 100,
    immediateTotal: preview?.immediateTotal ?? null, // charged now (upgrade); null on downgrade
    recurringTotal: preview?.recurringTotal ?? null,
    previewToken,
  });
});
