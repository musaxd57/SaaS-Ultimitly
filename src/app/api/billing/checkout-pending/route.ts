import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { markCheckoutPending } from "@/lib/billing/checkout-pending";
import { confirmPaidCheckout } from "@/lib/billing/checkout-intent";
import { adoptCorrelation } from "@/lib/correlation";
import { logEvent } from "@/lib/event-log";

// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" KİLİDİNİ YAZ (kurucu onayı 10-10; `lib/billing/checkout-pending.ts`). Paddle ödeme ekranı `checkout.completed`
// bildirince istemci çağırır. Yalnız işletme SAHİBİ (ödeme ekranı da yalnız sahibe açılır — `api/billing/consent`) ve yalnız KENDİ
// işletmesinin YENİ onay kaydıyla: başka işletmenin onayı 404, eski onay (ödeme ekranı en geç 3 saat önce açılmış) reddedilir.
// Etkisi yalnız kendi işletmesi: 10 dakika yeni ödeme ekranı açılmaz.
// Codex 11-17: istemcinin sözü tek başına yalnız bu 10 dk kilidi yazar. Sinyal ayrıca SUNUCUDA doğrulanır (`confirmPaidCheckout`): ödeme
// Paddle'dan okunup doğrulanırsa "ödeme alındı, abonelik bekleniyor" kalıcı kaydı oluşur — web kancası gecikse / hiç gelmese de kilit
// düşünce ikinci ödeme açılmaz. İstemcinin bildirdiği işlem kimliği yalnız OKUMA anahtarıdır; işletme, işlemin taşıdığı onay satırından gelir.
// ---------------------------------------------------------------------------

/** Onay kaydı en fazla bu kadar eski olabilir (ödeme ekranı açılıp bu süre içinde tamamlanmış). */
const CONSENT_MAX_AGE_MS = 3 * 60 * 60_000;

export const POST = withOwner(async (session, req) => {
  const limited = await rateLimit(`checkout-pending:${session.userId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { consentId?: unknown; transactionId?: unknown } | null;
  const consentId = typeof data?.consentId === "string" ? data.consentId.trim() : "";
  if (!consentId || consentId.length > 64) return badRequest({ consentId: "Geçersiz istek." });

  const consent = await prisma.checkoutConsent.findFirst({
    where: { id: consentId, organizationId: session.organizationId },
    select: { createdAt: true, correlationId: true },
  });
  if (!consent) return notFound();
  // Ödeme zincirine katıl (numara KENDİ işletmesinin onay satırından — istemciden değil).
  if (consent.correlationId) adoptCorrelation(consent.correlationId);
  const now = new Date();
  if (now.getTime() - consent.createdAt.getTime() > CONSENT_MAX_AGE_MS) return badRequest({ consentId: "Geçersiz istek." });

  await markCheckoutPending(session.organizationId, consentId, now);
  await logEvent("billing.checkout.pending", { consentId });
  // Biçimi tutmayan işlem kimliği yok sayılır (kilit yine yazıldı); doğrulama asla fırlatmaz.
  const transactionId = typeof data?.transactionId === "string" && /^txn_[A-Za-z0-9]{1,64}$/.test(data.transactionId) ? data.transactionId : null;
  await confirmPaidCheckout({ organizationId: session.organizationId, transactionId, now });
  return jsonOk({ ok: true });
});
