import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { markCheckoutPending } from "@/lib/billing/checkout-pending";

// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" KİLİDİNİ YAZ (kurucu onayı 10-10; `lib/billing/checkout-pending.ts`). Paddle ödeme ekranı `checkout.completed`
// bildirince istemci çağırır. Yalnız işletme SAHİBİ (ödeme ekranı da yalnız sahibe açılır — `api/billing/consent`) ve yalnız KENDİ
// işletmesinin YENİ onay kaydıyla: başka işletmenin onayı 404, eski onay (ödeme ekranı en geç 3 saat önce açılmış) reddedilir.
// Etkisi yalnız kendi işletmesi: 10 dakika yeni ödeme ekranı açılmaz.
// ---------------------------------------------------------------------------

/** Onay kaydı en fazla bu kadar eski olabilir (ödeme ekranı açılıp bu süre içinde tamamlanmış). */
const CONSENT_MAX_AGE_MS = 3 * 60 * 60_000;

export const POST = withOwner(async (session, req) => {
  const limited = await rateLimit(`checkout-pending:${session.userId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { consentId?: unknown } | null;
  const consentId = typeof data?.consentId === "string" ? data.consentId.trim() : "";
  if (!consentId || consentId.length > 64) return badRequest({ consentId: "Geçersiz istek." });

  const consent = await prisma.checkoutConsent.findFirst({
    where: { id: consentId, organizationId: session.organizationId },
    select: { createdAt: true },
  });
  if (!consent) return notFound();
  const now = new Date();
  if (now.getTime() - consent.createdAt.getTime() > CONSENT_MAX_AGE_MS) return badRequest({ consentId: "Geçersiz istek." });

  await markCheckoutPending(session.organizationId, consentId, now);
  return jsonOk({ ok: true });
});
