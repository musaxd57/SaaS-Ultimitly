import { prisma } from "@/lib/db";
import { badRequest, jsonOk, tooManyRequests } from "@/lib/api";
import { withAuth } from "@/lib/route-guard";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { checkoutConsentSchema, zodFieldErrors } from "@/lib/validators";

// Server-side record of the Ön Bilgilendirme + Mesafeli Satış acceptance at
// CHECKOUT — the evidence counterpart to the client checkbox in paddle-plans.tsx.
// The client calls this right before Paddle's overlay opens. organizationId and
// userId come from the SESSION (never the request body) → IDOR-proof; legal
// version, IP (rightmost XFF) and User-Agent are server-derived so they can't be
// forged. One row per acceptance (a user may go through checkout more than once).
export const POST = withAuth(async (session, req) => {
  // Light per-user cap so a script can't bloat the table; generous for real use
  // (no human opens checkout 20×/hour). Best-effort on the client, so a 429 here
  // never blocks the purchase — earlier accepted records already stand.
  const limited = rateLimit(`checkout-consent:${session.userId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = await req.json().catch(() => null);
  const parsed = checkoutConsentSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  await prisma.checkoutConsent.create({
    data: {
      organizationId: session.organizationId, // from session → can't record for another org
      userId: session.userId,
      planCode: parsed.data.planCode,
      priceId: parsed.data.priceId,
      legalVersion: LEGAL_VERSION, // server-side, not client-supplied
      ip: clientIp(req), // rightmost XFF (platform-observed), spoof-resistant
      userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null, // capped free text
    },
  });
  return jsonOk({ ok: true }, 201);
});
