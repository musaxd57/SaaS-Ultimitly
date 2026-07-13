import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { generateSecret, otpauthUri, verifyTotp, verifyTotpStep } from "@/lib/auth/totp";
import {
  regenerateRecoveryCodes,
  clearRecoveryCodes,
  remainingRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from "@/lib/auth/recovery-codes";
import { writeAudit } from "@/lib/audit";

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
  const enabled = Boolean(user?.twoFactorEnabledAt);
  return jsonOk({
    enabled,
    // Unused single-use recovery codes left (0 also when 2FA is off).
    recoveryRemaining: enabled ? await remainingRecoveryCodes(session.userId) : 0,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // Throttle 2FA management (enable/disable code attempts) — anti code brute-force.
  const limited = rateLimit(`2fa:${session.userId}`, 10, 10 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  try {
    const data = await req.json().catch(() => null);
    const action = typeof data?.action === "string" ? data.action : "";
    const code = typeof data?.code === "string" ? data.code : "";

    if (action === "setup") {
      // Guard: never let "setup" run on an already-active account. Setup writes
      // twoFactorEnabledAt: null (re-keying), which would silently DISABLE live
      // 2FA with no code — so a hijacked session could turn 2FA off. To re-key,
      // the user must first "disable" (which requires a valid current code).
      const current = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabledAt: true },
      });
      if (current?.twoFactorEnabledAt) {
        return badRequest({ _: "2FA zaten aktif. Yenilemek için önce kapatın." });
      }
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
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_enable",
        metadata: { targetUserId: session.userId },
      });
      return jsonOk({ ok: true, enabled: true });
    }

    if (action === "disable") {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      // FAIL-CLOSED: a hijacked session without the authenticator must NOT be able
      // to disable 2FA. Always require a valid current code. If the secret can't be
      // decrypted (should never happen — ENCRYPTION_KEY doesn't rotate), refuse
      // rather than silently allowing disable — and an undecryptable secret would
      // already block login (same verify), so this doesn't make recovery worse.
      if (user?.twoFactorEnabledAt) {
        let secret: string | null = null;
        if (user.twoFactorSecret) {
          try {
            secret = decryptSecret(user.twoFactorSecret);
          } catch {
            secret = null;
          }
        }
        if (!secret || !verifyTotp(secret, code)) {
          return badRequest({ code: "Kapatmak için geçerli bir kod girin." });
        }
      }
      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null },
      });
      // Recovery codes are a 2FA artifact — they die with it. A later re-enable
      // starts with zero codes (the old set was minted under the old secret's
      // trust context and must not resurrect).
      await clearRecoveryCodes(session.userId);
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_disable",
        metadata: { targetUserId: session.userId },
      });
      return jsonOk({ ok: true, enabled: false });
    }

    if (action === "recovery_codes") {
      // (Re)generate the single-use recovery code set. Same bar as "disable":
      // 2FA must be ACTIVE and a CURRENT code is required — minting codes is a
      // future 2FA bypass, so a hijacked session alone must not be enough.
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      if (!user?.twoFactorEnabledAt) {
        return badRequest({ _: "Kurtarma kodları için önce 2FA'yı açın." });
      }
      let secret: string | null = null;
      if (user.twoFactorSecret) {
        try {
          secret = decryptSecret(user.twoFactorSecret);
        } catch {
          secret = null;
        }
      }
      if (!secret || !verifyTotp(secret, code)) {
        return badRequest({ code: "Geçerli bir doğrulama kodu girin." });
      }
      // Regeneration atomically invalidates every previous code.
      const codes = await regenerateRecoveryCodes(session.userId);
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_recovery_generate",
        metadata: { targetUserId: session.userId, count: RECOVERY_CODE_COUNT },
      });
      // The ONLY place the plaintexts ever leave the server — shown once.
      return jsonOk({ ok: true, codes, recoveryRemaining: codes.length });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
