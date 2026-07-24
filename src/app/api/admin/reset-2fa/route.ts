import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, readJsonCappedOrNull } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Operator panel: RESET a locked-out customer's 2FA. SUPER-ADMIN ONLY.
//
// The lost-phone escape hatch. Self-service recovery is the recovery-code
// login; when the customer has neither phone nor codes they are hard-locked,
// and the operator — after verifying identity out-of-band (phone call, known
// contact) — clears the second factor so they can sign in with password only
// and re-enable 2FA from a trusted device.
//
// Safety properties:
//   * superadmin-only + full audit trail (actor, target, org).
//   * sessionEpoch bump: every existing session for the account dies at the
//     same moment the factor is removed — a hijacked session can't ride the
//     downgraded account.
//   * recovery codes are wiped with the secret (they belong to the old factor).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  try {
    const data = await readJsonCappedOrNull(req);
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email) return badRequest({ email: "Kullanıcının e-posta adresi gerekli." });

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, organizationId: true, twoFactorEnabledAt: true },
    });
    if (!user) return badRequest({ email: "Bu e-posta ile bir kullanıcı bulunamadı." });
    if (!user.twoFactorEnabledAt) {
      return badRequest({ email: "Bu hesapta 2FA zaten kapalı — sıfırlanacak bir şey yok." });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: null,
          twoFactorEnabledAt: null,
          twoFactorLastStep: null,
          sessionEpoch: { increment: 1 }, // kill every live session with the old factor
        },
      }),
      prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "admin.2fa_reset",
      metadata: { targetUserId: user.id, targetEmail: user.email },
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
