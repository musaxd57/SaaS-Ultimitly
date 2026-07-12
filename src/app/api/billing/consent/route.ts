import { prisma } from "@/lib/db";
import { badRequest, jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { paddlePriceToPlanCode } from "@/lib/payments/paddle";
import { checkoutConsentSchema, zodFieldErrors } from "@/lib/validators";

// Server-side record of the Ön Bilgilendirme + Mesafeli Satış acceptance at
// CHECKOUT — the evidence counterpart to the client checkbox in paddle-plans.tsx.
// The client calls this right before Paddle's overlay opens. organizationId and
// userId come from the SESSION (never the request body) → IDOR-proof; legal
// version, IP (rightmost XFF) and User-Agent are server-derived so they can't be
// forged. One row per acceptance (a user may go through checkout more than once).
// Contract/payment authority: owner + manager only (staff must not be able to
// record a distance-sales consent for the org — Codex finding).
export const POST = withManage(async (session, req) => {
  // Light per-user cap so a script can't bloat the table; generous for real use
  // (no human opens checkout 20×/hour). Best-effort on the client, so a 429 here
  // never blocks the purchase — earlier accepted records already stand.
  const limited = rateLimit(`checkout-consent:${session.userId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = await req.json().catch(() => null);
  const parsed = checkoutConsentSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  // Cross-check the plan LABEL against the price id server-side: the priceId is
  // what actually drives the Paddle charge, so it is authoritative. When the
  // price→plan map is configured and the client-supplied planCode disagrees, a
  // tampered/buggy client is trying to record inconsistent consent evidence —
  // refuse (fail-closed) so we never store "agreed to Pro" against a Business
  // price. When the map is unconfigured (derived === null) we can't cross-check,
  // so the validated client value stands. Store the derived code when available.
  const derivedPlanCode = paddlePriceToPlanCode(parsed.data.priceId);
  if (derivedPlanCode && derivedPlanCode !== parsed.data.planCode) {
    return badRequest({ planCode: "Seçilen plan ile fiyat eşleşmiyor." });
  }

  const row = await prisma.checkoutConsent.create({
    data: {
      organizationId: session.organizationId, // from session → can't record for another org
      userId: session.userId,
      planCode: derivedPlanCode ?? parsed.data.planCode, // price-derived is authoritative
      priceId: parsed.data.priceId,
      legalVersion: LEGAL_VERSION, // server-side, not client-supplied
      ip: clientIp(req), // rightmost XFF (platform-observed), spoof-resistant
      userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null, // capped free text
    },
    select: { id: true },
  });
  // Return the row id as a server-trusted nonce: the client passes it in the Paddle
  // checkout's custom_data, and the webhook resolves the org FROM this row (whose
  // organizationId is session-derived) instead of trusting a client-sent org id.
  return jsonOk({ ok: true, consentId: row.id }, 201);
});
