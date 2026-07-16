import { prisma } from "@/lib/db";
import { badRequest, jsonOk, serverError, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { createPortalSession, isPaddleConfigured } from "@/lib/payments/paddle";

// Generate a Paddle-hosted customer-portal link for THIS org's subscription so an
// owner/manager can change plan, cancel, or update their card. Everything is done
// in Paddle's own tested UI (Paddle owns the proration: upgrade immediate,
// downgrade at period end), so we never compute charges ourselves. The org comes
// from the SESSION (never the body) → IDOR-proof; withManage restricts it to
// owner/manager. The returned link is single-use + short-lived → never cached.
export const POST = withManage(async (session) => {
  const limited = await rateLimit(`billing-portal:${session.organizationId}`, 12, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  if (!isPaddleConfigured()) {
    return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });
  }

  const sub = await prisma.subscription.findUnique({
    where: { organizationId: session.organizationId }, // session-scoped → can't target another org
    select: { provider: true, providerRef: true },
  });
  if (!sub || sub.provider !== "paddle" || !sub.providerRef) {
    return badRequest({ error: "Yönetilecek bir Paddle aboneliği bulunamadı." });
  }

  const links = await createPortalSession(sub.providerRef);
  if (!links) {
    return serverError("Abonelik yönetim bağlantısı oluşturulamadı. Lütfen tekrar deneyin.");
  }
  return jsonOk({ url: links.overview, cancelUrl: links.cancel });
});
