import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { writeAudit, auditActor, auditImpersonation } from "@/lib/audit";
import { createPortalSession, getSubscriptionStatus, isPaddleConfigured, previewPriceTotal, resumeSubscription } from "@/lib/payments/paddle";
import { consumePlanChangeNonce, releasePlanChangeNonce } from "@/lib/billing/plan-change";
import { RESUME_PENDING_LOCK, RESUME_TEXT, resolveResume, resumeEnabled, verifyResumeToken } from "@/lib/billing/resume";

// ---------------------------------------------------------------------------
// I4 C — duraklatılmış aboneliği HEMEN devam ettir (kurucu 10-17: "tıklanınca hemen ödeme alınsın"). Paket değiştirme rotasıyla AYNI
// para güvenliği: önizlenmiş tutara bağlı, imzalı, TEK kullanımlık belirteç · Paddle'a gitmeden önce yeniden önizleme (tutar değiştiyse
// 409, yeni tutar) · kuruluş başına "işleniyor" kilidi (atomik) · kesin ret (4xx) → hiçbir şey çekilmedi, yeniden denenebilir · BELİRSİZ
// sonuç (5xx / zaman aşımı) → KÖRLEMESİNE yeniden gönderilmez, Paddle'dan durum okunur (etkinse başarı, değilse 202 bekliyor).
// Kart reddi → "Ödeme alınamadı. Kart bilgilerinizi güncelleyin." + Paddle'ın kart güncelleme sayfası (yoksa portal ana sayfası).
// Erişim Paddle olayıyla açılır (webhook yerel satırı yazar). Anahtar `PADDLE_RESUME_ENABLED` kapalıyken 404; yalnız hesap sahibi.
// ---------------------------------------------------------------------------

export const POST = withOwner(async (session, req) => {
  if (!resumeEnabled()) return notFound();
  const limited = await rateLimit(`billing-resume:${session.organizationId}`, 12, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  if (!isPaddleConfigured()) return badRequest({ error: "Abonelik yönetimi şu anda kullanılamıyor." });
  const org = session.organizationId;
  const lockName = RESUME_PENDING_LOCK(org);

  const pending = await prisma.systemLock.findUnique({ where: { name: lockName } });
  if (pending && pending.lockedUntil > new Date()) {
    return NextResponse.json({ error: RESUME_TEXT.inProgress, pendingVerification: true }, { status: 409 });
  }
  const r = await resolveResume(org);
  if (!r.ok) return badRequest({ error: r.error });

  const data = (await readJsonCappedOrNull(req)) as { previewToken?: unknown } | null;
  const token = verifyResumeToken(typeof data?.previewToken === "string" ? data.previewToken : null);
  if (!token) return badRequest({ error: RESUME_TEXT.tokenExpired });
  if (token.org !== org || token.priceId !== r.priceId) return badRequest({ error: RESUME_TEXT.tokenExpired });

  let claimed: boolean;
  try {
    claimed = await consumePlanChangeNonce(token.jti, new Date(token.exp));
  } catch {
    return NextResponse.json({ error: RESUME_TEXT.failed }, { status: 503 });
  }
  if (!claimed) return NextResponse.json({ error: RESUME_TEXT.tokenUsed }, { status: 409 });

  // Tutar bütünlüğü: müşterinin onayladığı rakam HÂLÂ geçerli olmalı (fiyat / vergi / para birimi değiştiyse yeniden onay).
  const fresh = await previewPriceTotal(r.priceId, r.customerId, r.addressId);
  if (!fresh || fresh !== token.amount) {
    await releasePlanChangeNonce(token.jti);
    return NextResponse.json({ error: fresh ? RESUME_TEXT.amountChanged : RESUME_TEXT.amountUnknown, amountChanged: Boolean(fresh), amount: fresh }, { status: 409 });
  }

  // Atomik "işleniyor" kilidi Paddle'dan ÖNCE (iki sekmeden iki geçerli belirteçle eşzamanlı iki devam → iki tahsilat olmasın).
  let lockClaimed = false;
  try {
    // Eşzamanlı iki istek satırı aynı anda oluşturmaya çalışırsa biri tekil anahtar hatası alır (P2002) — satır artık var demektir; hakemlik
    // aşağıdaki koşullu güncellemenin (mutasyon testi 10-17: eskiden ikinci istek 503 "tamamlanamadı" alıyordu, doğrusu 409 "sürüyor").
    await prisma.systemLock
      .upsert({ where: { name: lockName }, create: { name: lockName, lockedUntil: new Date(0) }, update: {} })
      .catch((e: unknown) => {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      });
    lockClaimed =
      (await prisma.systemLock.updateMany({
        where: { name: lockName, lockedUntil: { lte: new Date() } },
        data: { lockedUntil: new Date(Date.now() + 15 * 60_000), holder: r.priceId },
      })).count === 1;
  } catch {
    await releasePlanChangeNonce(token.jti);
    return NextResponse.json({ error: RESUME_TEXT.failed }, { status: 503 });
  }
  if (!lockClaimed) {
    await releasePlanChangeNonce(token.jti);
    return NextResponse.json({ error: RESUME_TEXT.inProgress, pendingVerification: true }, { status: 409 });
  }
  const clearLock = () => prisma.systemLock.deleteMany({ where: { name: lockName } }).catch(() => {});
  const audit = (action: string, extra: Record<string, unknown> = {}) =>
    writeAudit({
      organizationId: org,
      actorUserId: auditActor(session),
      action,
      // Onaylanan tutar izde (gerçek tahsilatla karşılaştırma — sandbox P8; kişisel veri yok).
      metadata: { plan: r.planCode, amount: token.amount, ...extra, ...auditImpersonation(session) },
    }).catch(() => {});

  // KİLİTTEN SONRA, Paddle'a gitmeden ÖNCE canlı durum yeniden okunur (Haiku 10-17): başka sekmenin devamı kilit düşmeden hemen önce
  // tamamlanmış olabilir — etkin aboneliğe ikinci "devam" gönderilmez. Okunamazsa kapalı yön.
  const live = await getSubscriptionStatus(r.providerRef);
  if (live?.status !== "paused") {
    await releasePlanChangeNonce(token.jti);
    await clearLock();
    const already = live?.status === "active" || live?.status === "trialing";
    return NextResponse.json({ error: already ? RESUME_TEXT.alreadyActive : RESUME_TEXT.statusUnknown, alreadyActive: already }, { status: 409 });
  }

  const result = await resumeSubscription(r.providerRef, org);
  if (!result.ok && result.kind === "definitive") {
    await releasePlanChangeNonce(token.jti);
    await clearLock();
    await audit("billing.resume_rejected", { declined: result.declined });
    if (result.declined) {
      const links = await createPortalSession(r.providerRef);
      return NextResponse.json(
        { error: RESUME_TEXT.declined, cardUpdateUrl: links?.updatePaymentMethod ?? links?.overview ?? null },
        { status: 402 },
      );
    }
    void reportError(`billing-resume-rejected org=${org}`, new Error(result.reason));
    return NextResponse.json({ error: RESUME_TEXT.failed }, { status: 502 });
  }
  if (!result.ok) {
    // BELİRSİZ: tahsilat gerçekleşmiş olabilir — yeniden gönderilmez, belirteç tüketik kalır. Paddle'daki durum okunur.
    const now = await getSubscriptionStatus(r.providerRef);
    if (now?.status === "past_due") {
      // Devam etti ama ödeme alınamadı → kart güncelleme (Paddle aynı işlemi yeniden dener; Haiku 10-17).
      await clearLock();
      await audit("billing.resume_payment_failed");
      const links = await createPortalSession(r.providerRef);
      return NextResponse.json({ error: RESUME_TEXT.declined, cardUpdateUrl: links?.updatePaymentMethod ?? links?.overview ?? null }, { status: 402 });
    }
    if (now?.status !== "active") {
      // Hâlâ duraklatılmış / okunamadı: istek Paddle'da sürüyor olabilir → kilit KALIR (ikinci tahsilat olmasın), sonuç vaat edilmez.
      await audit("billing.resume_pending");
      return NextResponse.json({ pending: true, error: RESUME_TEXT.pending }, { status: 202 });
    }
  }
  // Yanıtta durum yoksa / beklenmedikse (Haiku 10-17) başarı VARSAYILMAZ: Paddle'dan canlı durum okunur.
  let okStatus = result.ok ? result.status : null;
  if (result.ok && okStatus !== "active" && okStatus !== "past_due") okStatus = (await getSubscriptionStatus(r.providerRef))?.status ?? null;
  if (result.ok && okStatus === "past_due") {
    // SANDBOX D1 (10-17, belge): tahsilat başarısızsa devam isteği hata DÖNMEZ — abonelik "ödeme gecikmiş" olur. Başarı denmez; kart
    // güncelleme bağlantısı verilir (Paddle aynı işlemi yeniden dener). Kilit kalkar: abonelik artık duraklatılmış değil, ikinci devam
    // zaten reddedilir (canlı durum).
    await clearLock();
    await audit("billing.resume_payment_failed");
    const links = await createPortalSession(r.providerRef);
    return NextResponse.json({ error: RESUME_TEXT.declined, cardUpdateUrl: links?.updatePaymentMethod ?? links?.overview ?? null }, { status: 402 });
  }
  if (result.ok && okStatus !== "active") {
    // Durum hâlâ belli değil (duraklatılmış görünüyor / okunamadı): başarı vaat edilmez, kilit KALIR (ikinci tahsilat olmasın).
    await audit("billing.resume_pending");
    return NextResponse.json({ pending: true, error: RESUME_TEXT.pending }, { status: 202 });
  }
  // Başarı: kilit webhook'a kadar KALIR (yerel satır Paddle olayıyla "active" olana dek ikinci bir devam denemesi açılmasın; olay kilidi
  // siler, gelmezse 15 dk sonra kendiliğinden düşer).
  await audit("billing.resumed", { reconciled: !result.ok });
  return jsonOk({ ok: true, reconciled: !result.ok });
});
