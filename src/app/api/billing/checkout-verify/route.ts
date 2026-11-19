import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { markCheckoutPending } from "@/lib/billing/checkout-pending";
import { instantCheckoutLinkEnabled, verifyAndLinkCheckout } from "@/lib/billing/checkout-verify";
import { adoptCorrelation } from "@/lib/correlation";

// ---------------------------------------------------------------------------
// ÖDEME EKRANI TAMAMLANDI → HEMEN DOĞRULA (kurucu 11-18 akşam: "Ödeme ekranı tamamlanınca Lixus işlem kimliğini alıp Paddle'dan hemen kontrol
// etmeli … 10 dakika bir bekleme kuralı olmamalı"; çekirdek `lib/billing/checkout-verify.ts`). Ekran bu ucu ödeme tamamlanınca ve plan
// açılana kadar kısa aralıklarla çağırır; cevap üç durumdan biridir: `active` (plan açık) · `awaiting` (bekliyor) · `unverified` (Paddle
// okunamadı — yeniden sor). Neden bekletildiği müşteriye söylenmez (teşhis kodu yanıtta YOK; operatör olay günlüğünden okur).
//
// Yalnız işletme SAHİBİ ve yalnız KENDİ işletmesinin YENİ onay kaydıyla (`checkout-pending` ile aynı kapı): başka işletmenin onayı 404,
// eski onay reddedilir. İstemcinin gönderdiği işlem kimliği yalnız OKUMA anahtarıdır — Paddle'daki işlem bu onay kaydını taşımıyorsa
// hiçbir şey yazılmaz. Anahtar `BILLING_INSTANT_LINK_ENABLED` kapalıyken uç YOKTUR (404; ekran eski akışla sürer).
// ---------------------------------------------------------------------------

/** Onay kaydı en fazla bu kadar eski olabilir (ödeme ekranı açılıp bu süre içinde tamamlanmış). */
const CONSENT_MAX_AGE_MS = 3 * 60 * 60_000;

export const POST = withOwner(async (session, req) => {
  if (!instantCheckoutLinkEnabled()) return notFound();
  // Ekran plan açılana kadar yeniden sorar (3 · 6 · 12 sn …): saatte 120 istek birkaç dakikalık beklemeyi karşılar, döngüyü sınırlar.
  const limited = await rateLimit(`checkout-verify:${session.userId}`, 120, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { consentId?: unknown; transactionId?: unknown } | null;
  const consentId = typeof data?.consentId === "string" ? data.consentId.trim() : "";
  const transactionId = typeof data?.transactionId === "string" && /^txn_[A-Za-z0-9]{1,64}$/.test(data.transactionId) ? data.transactionId : null;
  if (!consentId || consentId.length > 64) return badRequest({ consentId: "Geçersiz istek." });
  if (!transactionId) return badRequest({ transactionId: "Geçersiz istek." });

  const consent = await prisma.checkoutConsent.findFirst({
    where: { id: consentId, organizationId: session.organizationId },
    select: { createdAt: true, correlationId: true },
  });
  if (!consent) return notFound();
  if (consent.correlationId) adoptCorrelation(consent.correlationId);
  const now = new Date();
  if (now.getTime() - consent.createdAt.getTime() > CONSENT_MAX_AGE_MS) return badRequest({ consentId: "Geçersiz istek." });

  // Kısa kilit yine yazılır (aynı onay kilidi uzatamaz): sunucu ödemeyi görene kadarki saniyelerde ikinci sekme ödeme ekranı açmasın.
  await markCheckoutPending(session.organizationId, consentId, now);
  const result = await verifyAndLinkCheckout({ organizationId: session.organizationId, consentId, transactionId, now });
  return jsonOk({ state: result.state });
});
