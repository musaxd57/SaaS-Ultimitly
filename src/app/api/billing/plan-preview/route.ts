import { badRequest, jsonOk, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { isPaddleConfigured, previewSubscriptionUpdate } from "@/lib/payments/paddle";
import { planChangeEnabled, resolvePlanChange, signPlanChangeToken } from "@/lib/billing/plan-change";

// Preview an in-app plan change WITHOUT applying it, so the confirm dialog can show
// the exact prorated charge Paddle will make. Gated behind PADDLE_PLAN_CHANGE_ENABLED
// (404 while off). withManage → owner/manager; org comes from the SESSION → IDOR-proof.
// The preview amounts are best-effort (Paddle owns the real charge on apply).
export const POST = withManage(async (session, req) => {
  if (!planChangeEnabled()) return notFound();
  const limited = rateLimit(`plan-preview:${session.organizationId}`, 30, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  if (!isPaddleConfigured()) return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });

  const data = (await req.json().catch(() => null)) as { planCode?: unknown } | null;
  const planCode = typeof data?.planCode === "string" ? data.planCode : "";

  const r = await resolvePlanChange(session.organizationId, planCode);
  if (!r.ok) return badRequest({ error: r.error });

  const preview = await previewSubscriptionUpdate(r.providerRef, r.priceId, r.proration);
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
