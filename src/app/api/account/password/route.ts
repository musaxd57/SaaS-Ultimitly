import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  tooManyRequests,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { emailService } from "@/lib/email";

// ---------------------------------------------------------------------------
// Change the signed-in user's password — gated by an E-MAIL VERIFICATION CODE,
// NOT the current password. Rationale: this screen exists so a user who FORGOT
// their password can still recover while logged in, so asking for the current
// password would defeat the purpose. Instead we e-mail a short-lived 8-digit
// code to the account's own address; entering it proves control of the inbox,
// which a merely-stolen/stale session cannot do on its own.
//
//   POST { action: "request" }                  → e-mail a fresh code (10 min)
//   POST { action: "confirm", code, newPassword } → verify code → set password
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_CODE_ATTEMPTS = 5; // wrong-code guesses before the code is burned

/**
 * Crypto-strong 8-digit code (10^8 space). 8 rather than 6 digits because the
 * code is the PRIMARY barrier here (no current-password is asked): the extra
 * two digits keep brute-force negligible even across re-requests + rate limits.
 */
function verificationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  return String(n).padStart(8, "0");
}

function codeEmailHtml(code: string): string {
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#111">Lixus AI — Şifre değiştirme kodu</h2>
      <p>Hesabınızın şifresini değiştirmek için doğrulama kodunuz:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>
      <p style="color:#555">Bu kod <strong>10 dakika</strong> geçerlidir. Bu isteği siz yapmadıysanız
      bu e-postayı yok sayın — şifreniz değişmez.</p>
    </div>`;
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Throttle the whole flow per user (covers code-request e-mail spam AND
  // confirm attempts). The wrong-code attempt counter below adds a second cap.
  const limited = rateLimit(`pw-change:${session.userId}`, 8, 10 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await req.json().catch(() => null);
    const action = typeof data?.action === "string" ? data.action : "";

    // STEP 1 — e-mail a verification code to the signed-in user's own address.
    if (action === "request") {
      // Tighter, separate cap on code REQUESTS specifically — stops both inbox-
      // bombing and "re-roll a fresh code to refill the guess budget" abuse.
      const reqLimit = rateLimit(`pw-change-req:${session.userId}`, 4, 15 * 60_000);
      if (!reqLimit.ok) return tooManyRequests(reqLimit.retryAfter);

      const code = verificationCode();
      const codeHash = await hashPassword(code);
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          pwChangeCodeHash: codeHash,
          pwChangeCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          pwChangeCodeAttempts: 0,
        },
      });

      const sent = await emailService.sendReporting(
        session.email,
        "Lixus AI — Şifre değiştirme kodu",
        codeEmailHtml(code),
      );
      if (!sent.ok) {
        // Couldn't deliver → don't leave a dangling code lying around.
        await prisma.user.update({
          where: { id: session.userId },
          data: { pwChangeCodeHash: null, pwChangeCodeExpiresAt: null },
        });
        return badRequest({ _: "Kod e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin." });
      }
      return jsonOk({ ok: true });
    }

    // STEP 2 — verify the code, then set the new password.
    if (action === "confirm") {
      const code = typeof data?.code === "string" ? data.code.trim() : "";
      const newPassword = typeof data?.newPassword === "string" ? data.newPassword.trim() : "";
      if (newPassword.length < 8) {
        return badRequest({ newPassword: "Şifre en az 8 karakter olmalı." });
      }
      if (!/^\d{8}$/.test(code)) {
        return badRequest({ code: "8 haneli doğrulama kodunu girin." });
      }

      // Atomically CLAIM one guess slot: only succeeds if a live, unexpired code
      // exists AND attempts are still under the cap. Doing the check+increment in
      // a single conditional updateMany closes the read-then-act race (parallel
      // confirms can't each slip past a stale "attempts < 5" read), and it caps
      // total guesses PER CODE regardless of how the request was reached.
      const claim = await prisma.user.updateMany({
        where: {
          id: session.userId,
          pwChangeCodeHash: { not: null },
          pwChangeCodeExpiresAt: { gt: new Date() },
          pwChangeCodeAttempts: { lt: MAX_CODE_ATTEMPTS },
        },
        data: { pwChangeCodeAttempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        // No live code / expired / out of attempts → burn whatever's there.
        await prisma.user.updateMany({
          where: { id: session.userId },
          data: { pwChangeCodeHash: null, pwChangeCodeExpiresAt: null },
        });
        return badRequest({
          code: "Kod geçersiz, süresi dolmuş ya da çok fazla denendi. “Kod gönder” ile yeni bir kod isteyin.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { pwChangeCodeHash: true },
      });
      const ok = user?.pwChangeCodeHash ? await verifyPassword(code, user.pwChangeCodeHash) : false;
      if (!ok) {
        // Wrong code — the attempt was already counted by the atomic claim above.
        return badRequest({ code: "Kod hatalı." });
      }

      // Code valid → set the new password and burn the code.
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          passwordHash,
          pwChangeCodeHash: null,
          pwChangeCodeExpiresAt: null,
          pwChangeCodeAttempts: 0,
          // Invalidate every OTHER live session (a stolen token carries the old
          // epoch → it stops matching on the next request).
          sessionEpoch: { increment: 1 },
        },
      });
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.password_change",
        metadata: { targetUserId: session.userId, via: "email_code" },
      });
      return jsonOk({ ok: true });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
