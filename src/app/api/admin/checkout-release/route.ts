import { type NextRequest } from "next/server";
import { requireSession, unauthorized, badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull, forbidden, hasJsonContentType, unsupportedMediaType } from "@/lib/api";
import { crossSiteWrite } from "@/lib/route-guard";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { releasePaidCheckoutByOperator } from "@/lib/billing/checkout-paid";
import { auditActor, writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Operatör paneli: "ÖDEME ALINDI, ABONELİK BEKLENİYOR" KAYDINI SERBEST BIRAK (Codex 11-17; `lib/billing/checkout-paid.ts`). Kayıt, ödemesi
// alınmış ama aboneliği hesaba bağlanmamış işletmeye yeni ödeme ekranı açtırmaz ve süreyle kapanmaz. Olağan çıkışlar kendiliğindendir
// (abonelik bağlanır / Paddle'da iptal edilir). Bu uç nokta emniyet supabıdır: operatör ödemeyi iade ettiyse ya da başka yoldan çözdüyse
// kaydı elle kapatır → müşteri yeniden satın alabilir. Gövde: kayıt kimliği. Yalnız süper-admin (allowlist + 2FA); destek görünümünde
// (bürünme) yazma YOK; işlem işletmenin denetim kaydına yazılır. Bekleyen olmayan kayıt 409.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);
  if (crossSiteWrite(req)) return forbidden();
  if (!hasJsonContentType(req)) return unsupportedMediaType();

  const limited = await rateLimit(`admin-checkout-release:${session.actorUserId ?? session.userId}`, 30, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { intentId?: unknown } | null;
  const intentId = typeof data?.intentId === "string" ? data.intentId.trim() : "";
  if (!intentId || intentId.length > 64) return badRequest({ intentId: "Kayıt kimliği gerekli." });

  const released = await releasePaidCheckoutByOperator(intentId);
  if (!released.ok) {
    if (released.reason === "not_found") return notFound();
    return Response.json({ error: "Bu kayıt artık beklemiyor.", code: released.reason }, { status: 409 });
  }
  await writeAudit({
    organizationId: released.organizationId,
    actorUserId: auditActor(session),
    action: "billing.checkout_released",
    metadata: released.transactionId ? { transactionId: released.transactionId } : {},
  });
  return jsonOk({ ok: true });
}
