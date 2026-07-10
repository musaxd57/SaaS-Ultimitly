import { badRequest, jsonOk, notFound, serverError, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { isPaddleConfigured, updateSubscriptionPlan } from "@/lib/payments/paddle";
import { planChangeEnabled, resolvePlanChange } from "@/lib/billing/plan-change";
import { writeAudit } from "@/lib/audit";

// Apply an in-app plan change. Upgrade → charged immediately (prorated); downgrade
// → takes effect at the next billing period. Paddle owns the proration + charge;
// the resulting webhook updates the local subscription row. Gated behind
// PADDLE_PLAN_CHANGE_ENABLED (404 while off). withManage → owner/manager; org from
// the SESSION → IDOR-proof. Rate-limited so a click-loop can't spam Paddle.
export const POST = withManage(async (session, req) => {
  if (!planChangeEnabled()) return notFound();
  const limited = rateLimit(`plan-change:${session.organizationId}`, 12, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  if (!isPaddleConfigured()) return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });

  const data = (await req.json().catch(() => null)) as { planCode?: unknown } | null;
  const planCode = typeof data?.planCode === "string" ? data.planCode : "";

  const r = await resolvePlanChange(session.organizationId, planCode);
  if (!r.ok) return badRequest({ error: r.error });

  const ok = await updateSubscriptionPlan(r.providerRef, r.priceId, r.proration);
  if (!ok) return serverError("Plan değişikliği yapılamadı. Lütfen tekrar deneyin.");

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "billing.plan_change",
    metadata: { from: r.currentCode, to: planCode, mode: r.mode },
  }).catch(() => {});

  return jsonOk({ ok: true, mode: r.mode });
});
