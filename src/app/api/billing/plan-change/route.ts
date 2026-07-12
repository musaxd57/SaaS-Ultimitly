import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import {
  getSubscriptionCurrentPriceId,
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

  // PENDING guard (Codex): after an AMBIGUOUS apply we must not fire a second
  // PATCH via a fresh preview+token until the first is settled (webhook clears
  // the lock; 15-min TTL self-heals if it never arrives).
  const pending = await prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${session.organizationId}` } });
  if (pending && pending.lockedUntil > new Date()) {
    return NextResponse.json(
      { error: "Önceki plan değişikliği doğrulanıyor — birkaç dakika içinde netleşecek.", pendingVerification: true },
      { status: 409 },
    );
  }

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

  // Already on the target (e.g. a prior ambiguous apply DID land): success without
  // another PATCH (Codex: never re-PATCH what is already applied).
  const alreadyOn = await getSubscriptionCurrentPriceId(r.providerRef);
  if (alreadyOn === r.priceId) {
    await prisma.systemLock.deleteMany({ where: { name: `plan-change-pending:${session.organizationId}` } }).catch(() => {});
    return jsonOk({ ok: true, mode: r.mode, reconciled: true });
  }
  // FAIL-CLOSED + ATOMIC pending claim BEFORE the PATCH (Codex round-4): the
  // upsert version was not a claim — two CONCURRENT applies with two different
  // valid tokens both passed the fast-path check and both PATCHed. updateMany on
  // a free slot is the arbiter (same pattern as the sync lock); the holder field
  // records the TARGET priceId so the webhook only settles the matching change.
  let pendingClaimed = false;
  try {
    const name = `plan-change-pending:${session.organizationId}`;
    await prisma.systemLock.upsert({ where: { name }, create: { name, lockedUntil: new Date(0) }, update: {} });
    const claim = await prisma.systemLock.updateMany({
      where: { name, lockedUntil: { lte: new Date() } },
      data: { lockedUntil: new Date(Date.now() + 15 * 60_000), holder: r.priceId },
    });
    pendingClaimed = claim.count === 1;
  } catch {
    await releasePlanChangeNonce(token.jti);
    return NextResponse.json({ error: "Şu anda işlenemedi, lütfen tekrar deneyin." }, { status: 503 });
  }
  if (!pendingClaimed) {
    await releasePlanChangeNonce(token.jti);
    return NextResponse.json(
      { error: "Önceki plan değişikliği doğrulanıyor — birkaç dakika içinde netleşecek.", pendingVerification: true },
      { status: 409 },
    );
  }
  const clearPending = () =>
    prisma.systemLock.deleteMany({ where: { name: `plan-change-pending:${session.organizationId}` } }).catch(() => {});
  const result = await updateSubscriptionPlan(r.providerRef, r.priceId, r.proration);
  if (!result.ok) {
    if (result.kind === "definitive") {
      // Paddle REJECTED the request (4xx) → the plan did NOT change → nothing charged
      // → release the nonce so the same token can be retried after fixing the cause.
      await releasePlanChangeNonce(token.jti);
      await clearPending(); // definitive: nothing applied → nothing pending
      // Surface Paddle's reason (e.g. "Paddle HTTP 400 (subscription_locked...)") so
      // the owner can see WHY without digging the logs. No ids/secrets in the string.
      return NextResponse.json(
        { error: "Plan değişikliği yapılamadı. Lütfen tekrar deneyin.", detail: result.reason },
        { status: 502 },
      );
    }
    // AMBIGUOUS (5xx / timeout / network): the PATCH MAY have applied at Paddle even
    // though we got no clean response. Paddle has no general-API idempotency key, so we
    // must NOT re-send (would double-apply) → keep the nonce CONSUMED. Reconcile by
    // reading the subscription's current price: if it's already the target, it DID
    // apply (response was just lost) → success. Otherwise leave it for the webhook to
    // settle and tell the customer we're confirming.
    const currentPrice = await getSubscriptionCurrentPriceId(r.providerRef);
    if (currentPrice !== r.priceId) {
      return NextResponse.json(
        {
          pending: true,
          error: "İşleminiz alındı; Paddle onayı bekleniyor. Birkaç dakika içinde güncellenecek.",
        },
        { status: 202 },
      );
    }
    await clearPending(); // reconciled: the change IS live → not pending anymore
    // Reconciled: the change is live at Paddle → fall through to audit + success.
  }
  if (result.ok) await clearPending();

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "billing.plan_change",
    metadata: { from: r.currentCode, to: planCode, mode: r.mode, reconciled: !result.ok },
  }).catch(() => {});

  return jsonOk({ ok: true, mode: r.mode, reconciled: !result.ok });
});
