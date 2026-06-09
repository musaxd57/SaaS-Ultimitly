import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { generateSecret, otpauthUri, verifyTotp, verifyTotpStep } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// Two-factor auth (authenticator app) management for the signed-in user.
//   GET                       → { enabled }
//   POST { action:"setup" }   → make a secret (stored encrypted, NOT yet active),
//                               return { secret, otpauthUri } for the app/QR.
//   POST { action:"enable", code } → confirm a first code → 2FA becomes active.
//   POST { action:"disable", code } → confirm a code → turn 2FA off.
// 2FA is only ever ACTIVE once enabled, so an abandoned setup can't lock you out.
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabledAt: true },
  });
  return jsonOk({ enabled: Boolean(user?.twoFactorEnabledAt) });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    const data = await req.json().catch(() => null);
    const action = typeof data?.action === "string" ? data.action : "";
    const code = typeof data?.code === "string" ? data.code : "";

    if (action === "setup") {
      const secret = generateSecret();
      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: null },
      });
      return jsonOk({ secret, otpauthUri: otpauthUri(secret, session.email) });
    }

    if (action === "enable") {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true },
      });
      if (!user?.twoFactorSecret) return badRequest({ _: "Önce kurulum başlatın." });
      const secret = decryptSecret(user.twoFactorSecret);
      const step = verifyTotpStep(secret, code);
      if (step === null) return badRequest({ code: "Kod hatalı veya süresi geçmiş." });
      await prisma.user.update({
        where: { id: session.userId },
        // Record the step so the enabling code can't be replayed at login.
        data: { twoFactorEnabledAt: new Date(), twoFactorLastStep: step },
      });
      return jsonOk({ ok: true, enabled: true });
    }

    if (action === "disable") {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      // Require a valid current code to switch it off (so a hijacked session
      // without the authenticator can't quietly disable 2FA).
      if (user?.twoFactorEnabledAt && user.twoFactorSecret) {
        const secret = decryptSecret(user.twoFactorSecret);
        if (!verifyTotp(secret, code)) return badRequest({ code: "Kapatmak için geçerli bir kod girin." });
      }
      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null },
      });
      return jsonOk({ ok: true, enabled: false });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch {
    return serverError();
  }
}
