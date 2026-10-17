import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { isPaddleConfigured, previewPriceTotal } from "@/lib/payments/paddle";
import { RESUME_PENDING_LOCK, RESUME_TEXT, resolveResume, resumeConfirmText, resumeEnabled, signResumeToken } from "@/lib/billing/resume";

// I4 C — "Aboneliği devam ettir" ÖNİZLEMESİ (kurucu 10-17, C1): onay penceresindeki tutar Paddle'ın fiyat önizlemesinden (vergi dahil);
// okunamazsa pencere AÇILMAZ (tahmini rakamla para çekilmez). Hiçbir şey uygulamaz. Anahtar `PADDLE_RESUME_ENABLED` kapalıyken 404.
// Yalnız hesap sahibi (faturalandırma sahibin işi); kuruluş OTURUMDAN.
export const POST = withOwner(async (session) => {
  if (!resumeEnabled()) return notFound();
  const limited = await rateLimit(`billing-resume-preview:${session.organizationId}`, 30, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  if (!isPaddleConfigured()) return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });

  const pending = await prisma.systemLock.findUnique({ where: { name: RESUME_PENDING_LOCK(session.organizationId) } });
  if (pending && pending.lockedUntil > new Date()) {
    return NextResponse.json({ error: RESUME_TEXT.inProgress, pendingVerification: true }, { status: 409 });
  }
  const r = await resolveResume(session.organizationId);
  if (!r.ok) return badRequest({ error: r.error });

  const amount = await previewPriceTotal(r.priceId, r.customerId);
  if (!amount) return NextResponse.json({ error: RESUME_TEXT.amountUnknown }, { status: 503 });

  return jsonOk({
    planCode: r.planCode,
    planName: r.planName,
    amount,
    annual: r.annual,
    confirm: resumeConfirmText(r.planName, amount, r.annual),
    previewToken: signResumeToken({ org: session.organizationId, priceId: r.priceId, amount }),
  });
});
