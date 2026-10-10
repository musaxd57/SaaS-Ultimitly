import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditInTx } from "@/lib/audit";
import { trialEndDate } from "@/lib/billing/subscription";
import { TRIAL_END_REASON_IDENTITY_REUSED } from "@/lib/billing/trial-identity";

// ---------------------------------------------------------------------------
// Operatör paneli: DENEMEYİ GERİ VER (deneme kimliği istisnası; kurucu onayı 10-10). Aynı ilan / takvim başka hesapta görüldüğü için
// denemesi biten bir kuruluşta meşru durum varsa (ilan yeni sahibe geçti, ajans iki hesap kullanıyor…) operatör istisna tanır:
// kuruluş bundan sonra kimlik kuralından MUAF olur ve — denemesi bu sebeple bittiyse — yeni bir deneme süresi başlar.
// Yalnız süper-admin (allowlist + 2FA); her istisna denetim kaydına yazılır (operatör kimliğiyle).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  const limited = await rateLimit(`admin-trial-exempt:${session.actorUserId ?? session.userId}`, 30, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { organizationId?: unknown } | null;
  const organizationId = typeof data?.organizationId === "string" ? data.organizationId.trim() : "";
  if (!organizationId || organizationId.length > 64) return badRequest({ organizationId: "İşletme kimliği gerekli." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return notFound();

  const now = new Date();
  const restored = await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { trialIdentityExempt: true } });
    // Yalnız BU SEBEPLE bitmiş deneme yeniden başlar (ödeme yapan / kendi süresi dolmuş deneme değişmez).
    const res = await tx.subscription.updateMany({
      where: { organizationId, provider: "trial", trialEndReason: TRIAL_END_REASON_IDENTITY_REUSED },
      data: { trialEndsAt: trialEndDate(now), trialEndReason: null },
    });
    await writeAuditInTx(tx, {
      organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "trial.identity_exempt",
      metadata: { trialRestored: res.count === 1 },
    });
    return res.count === 1;
  });
  return jsonOk({ ok: true, trialRestored: restored });
}
