import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import {
  isPaddleConfigured,
  previewSubscriptionUpdate,
  updateSubscriptionPlan,
} from "@/lib/payments/paddle";
import {
  consumePlanChangeNonce,
  planChangeEnabled,
  releasePlanChangeNonce,
  resolvePlanChange,
  verifyPlanChangeToken,
} from "@/lib/billing/plan-change";
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

  const data = (await req.json().catch(() => null)) as
    | { planCode?: unknown; previewToken?: unknown }
    | null;
  const planCode = typeof data?.planCode === "string" ? data.planCode : "";

  const r = await resolvePlanChange(session.organizationId, planCode);
  if (!r.ok) return badRequest({ error: r.error });

  // Bind apply → a real preview: require a valid, unexpired preview token whose
  // org + target price + mode match this change. Blocks a direct/blind apply, a
  // replay, and reuse for a different plan/price (Codex).
  const token = verifyPlanChangeToken(typeof data?.previewToken === "string" ? data.previewToken : null);
  if (!token) {
    return badRequest({ error: "Önizleme doğrulanamadı — lütfen tekrar deneyin." });
  }
  if (token.org !== session.organizationId || token.priceId !== r.priceId || token.mode !== r.mode) {
    return badRequest({ error: "Önizleme bu plan değişikliğiyle eşleşmiyor." });
  }

  // Single-use: claim the token's jti BEFORE touching Paddle. A replay / concurrent
  // double-submit within the 10-min TTL finds it already consumed → 409, so it can't
  // drive a second PATCH/charge. (Expiry alone is NOT single-use.) Fail closed if the
  // claim errors (never charge on an unknown nonce state).
  let claimed: boolean;
  try {
    claimed = await consumePlanChangeNonce(token.jti, new Date(token.exp));
  } catch {
    return NextResponse.json({ error: "Şu anda işlenemedi, lütfen tekrar deneyin." }, { status: 503 });
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "Bu önizleme zaten kullanıldı — lütfen tekrar deneyin." },
      { status: 409 },
    );
  }

  // Amount integrity: re-preview NOW and require the charge the customer confirmed to
  // still hold. If Paddle computes a different immediate total (proration drift /
  // currency change), or an upgrade can't be priced, refuse — the customer must
  // re-confirm the new amount. A downgrade has no immediate charge (both null) → ok.
  const fresh = await previewSubscriptionUpdate(r.providerRef, r.priceId, r.proration);
  const freshAmount = fresh?.immediateTotal ?? null;
  const amountUnknownUpgrade = r.mode === "upgrade" && !freshAmount;
  if (amountUnknownUpgrade || freshAmount !== token.amount) {
    await releasePlanChangeNonce(token.jti); // not applied → let them retry after re-preview
    return NextResponse.json(
      {
        error: "Tutar değişti — lütfen yeni tutarı onaylayın.",
        amountChanged: true,
        immediateTotal: freshAmount,
      },
      { status: 409 },
    );
  }

  const result = await updateSubscriptionPlan(r.providerRef, r.priceId, r.proration);
  if (!result.ok) {
    // Nothing was charged → release the nonce so the SAME token can be retried.
    await releasePlanChangeNonce(token.jti);
    // Surface Paddle's reason (e.g. "Paddle HTTP 400 (subscription_locked...)") so
    // the owner can see WHY without digging the logs. No ids/secrets in the string.
    return NextResponse.json(
      { error: "Plan değişikliği yapılamadı. Lütfen tekrar deneyin.", detail: result.reason },
      { status: 502 },
    );
  }

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "billing.plan_change",
    metadata: { from: r.currentCode, to: planCode, mode: r.mode },
  }).catch(() => {});

  return jsonOk({ ok: true, mode: r.mode });
});
