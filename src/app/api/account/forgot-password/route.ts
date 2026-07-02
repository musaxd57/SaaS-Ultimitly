import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { badRequest, jsonOk, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { emailService } from "@/lib/email";

// ---------------------------------------------------------------------------
// PUBLIC "forgot my password" RESET (logged OUT). Mirrors the logged-in
// account/password code flow but keyed on EMAIL and hardened against
// account-enumeration. Uses separate pwResetCode* columns so a public reset
// request can never burn/overwrite a code the user is mid-using in Settings.
//
//   POST { action: "request", email }                    → ALWAYS 200 (mails a
//                                                            code only if the
//                                                            account exists)
//   POST { action: "confirm", email, code, newPassword } → verify → set password
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_CODE_ATTEMPTS = 5;

/** Crypto-strong 8-digit code (10^8 space) — the primary barrier, like the
 *  logged-in flow. */
function verificationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  return String(n).padStart(8, "0");
}

function codeEmailHtml(code: string): string {
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#111">Lixus AI — Şifre sıfırlama kodu</h2>
      <p>Şifrenizi sıfırlamak için doğrulama kodunuz:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>
      <p style="color:#555">Bu kod <strong>10 dakika</strong> geçerlidir. Bu isteği siz yapmadıysanız
      bu e-postayı yok sayın — şifreniz değişmez.</p>
    </div>`;
}

// Same generic message whether the email is unknown, the code is wrong, expired,
// or exhausted — so the response never reveals whether an account exists.
const GENERIC_CONFIRM =
  "Kod geçersiz, süresi dolmuş ya da çok fazla denendi. “Kod gönder” ile yeni bir kod isteyin.";

export async function POST(req: NextRequest) {
  // Per-IP cap over the whole flow (enumeration / code-spray defense).
  const ipLimit = rateLimit(`forgot:${clientIp(req)}`, 12, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  try {
    const data = await req.json().catch(() => null);
    const action = typeof data?.action === "string" ? data.action : "";
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return badRequest({ email: "Geçerli bir e-posta girin." });
    }

    // STEP 1 — request a reset code. ALWAYS returns 200 and never reveals whether
    // the account exists; only sends mail when it does.
    if (action === "request") {
      // Per-account request cap (inbox-bomb + "re-roll a fresh code" defense).
      const reqLimit = rateLimit(`forgot-req:${email}`, 4, 15 * 60_000);
      if (!reqLimit.ok) return tooManyRequests(reqLimit.retryAfter);

      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) {
        // Spend a comparable bcrypt cost so the not-found path isn't measurably
        // faster than the real path (removes a cheap timing oracle).
        await hashPassword(verificationCode());
        return jsonOk({ ok: true });
      }

      const code = verificationCode();
      const codeHash = await hashPassword(code);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          pwResetCodeHash: codeHash,
          pwResetCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          pwResetCodeAttempts: 0,
        },
      });
      const sent = await emailService.sendReporting(
        email,
        "Lixus AI — Şifre sıfırlama kodu",
        codeEmailHtml(code),
      );
      if (!sent.ok) {
        // Couldn't deliver → don't leave a dangling code. Stay generic (no
        // different error shape that would leak existence).
        await prisma.user.update({
          where: { id: user.id },
          data: { pwResetCodeHash: null, pwResetCodeExpiresAt: null },
        });
      }
      return jsonOk({ ok: true });
    }

    // STEP 2 — confirm the code, then set the new password. Generic errors only.
    if (action === "confirm") {
      const code = typeof data?.code === "string" ? data.code.trim() : "";
      const newPassword = typeof data?.newPassword === "string" ? data.newPassword.trim() : "";
      if (newPassword.length < 8) {
        return badRequest({ newPassword: "Şifre en az 8 karakter olmalı." });
      }
      if (!/^\d{8}$/.test(code)) {
        return badRequest({ code: "8 haneli doğrulama kodunu girin." });
      }
      const confLimit = rateLimit(`forgot-confirm:${email}`, 8, 10 * 60_000);
      if (!confLimit.ok) return tooManyRequests(confLimit.retryAfter);

      // Atomically CLAIM one guess slot — only succeeds if a live, unexpired code
      // exists AND attempts are under the cap. Single conditional updateMany
      // closes the read-then-act race and caps guesses per code.
      const claim = await prisma.user.updateMany({
        where: {
          email,
          pwResetCodeHash: { not: null },
          pwResetCodeExpiresAt: { gt: new Date() },
          pwResetCodeAttempts: { lt: MAX_CODE_ATTEMPTS },
        },
        data: { pwResetCodeAttempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        // No live code (or unknown email) → burn any stale code, parity-cost, and
        // return the SAME generic error as a wrong code.
        await prisma.user.updateMany({
          where: { email },
          data: { pwResetCodeHash: null, pwResetCodeExpiresAt: null },
        });
        await verifyPassword(code, await hashPassword(code));
        return badRequest({ code: GENERIC_CONFIRM });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, organizationId: true, pwResetCodeHash: true },
      });
      const ok = user?.pwResetCodeHash ? await verifyPassword(code, user.pwResetCodeHash) : false;
      if (!ok || !user) {
        return badRequest({ code: GENERIC_CONFIRM });
      }

      // Code valid → set the new password and burn the code.
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          pwResetCodeHash: null,
          pwResetCodeExpiresAt: null,
          pwResetCodeAttempts: 0,
          // When sessionEpoch lands (deferred auth-hardening), add
          // `sessionEpoch: { increment: 1 }` here to kill other live sessions.
        },
      });
      await writeAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "account.password_reset",
        metadata: { via: "email_code", ip: clientIp(req) },
      });
      return jsonOk({ ok: true });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
