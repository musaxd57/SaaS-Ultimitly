import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { emailService } from "@/lib/email";
import {
  emailOutboxEnabled,
  enqueueIdentityEmail,
  kickEmailOutboxDrain,
  changeCodeEmailHtml,
} from "@/lib/email-outbox";

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

// The e-mail template lives in email-outbox.ts (changeCodeEmailHtml) — ONE
// source for both the outbox worker and this route's legacy synchronous path.

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Throttle the whole flow per user (covers code-request e-mail spam AND
  // confirm attempts). The wrong-code attempt counter below adds a second cap.
  const limited = await rateLimit(`pw-change:${session.userId}`, 8, 10 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await readJsonCappedOrNull(req);
    const action = typeof data?.action === "string" ? data.action : "";

    // STEP 1 — e-mail a verification code to the signed-in user's own address.
    if (action === "request") {
      // Tighter, separate cap on code REQUESTS specifically — stops both inbox-
      // bombing and "re-roll a fresh code to refill the guess budget" abuse.
      const reqLimit = await rateLimit(`pw-change-req:${session.userId}`, 4, 15 * 60_000);
      if (!reqLimit.ok) return tooManyRequests(reqLimit.retryAfter);

      const code = verificationCode();
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      // Durable outbox (Tur-4, flag ON): hash + send-intent in ONE transaction;
      // no provider call on the request path. A provider outage becomes a
      // scheduled retry instead of "code e-mail failed, try later".
      if (emailOutboxEnabled()) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: session.userId },
            data: { pwChangeCodeHash: codeHash, pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 },
          });
          await enqueueIdentityEmail(tx, {
            userId: session.userId,
            kind: "pw_change_code",
            secret: code,
            recipient: session.email,
            expiresAt,
          });
        });
        kickEmailOutboxDrain();
        return jsonOk({ ok: true });
      }

      // Legacy synchronous path (flag OFF) — unchanged behaviour.
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          pwChangeCodeHash: codeHash,
          pwChangeCodeExpiresAt: expiresAt,
          pwChangeCodeAttempts: 0,
        },
      });

      const sent = await emailService.sendReporting(
        session.email,
        "Lixus AI — Şifre değiştirme kodu",
        changeCodeEmailHtml(code),
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
      const codeHash = user?.pwChangeCodeHash ?? null;
      if (!codeHash || !(await verifyPassword(code, codeHash))) {
        // Wrong code — the attempt was already counted by the atomic claim above.
        return badRequest({ code: "Kod hatalı." });
      }

      // Code valid → CONSUME the code and set the password in ONE conditional
      // write (Codex P1): the WHERE pins the exact hash we just verified, so of
      // two parallel confirms racing the same code only the FIRST matches — the
      // second sees count=0 (hash already NULLed, or replaced by a newer code)
      // and is rejected. Kills last-writer-wins on the password and enforces the
      // code's single-use promise (email-verify atomic-consume emsali).
      const passwordHash = await hashPassword(newPassword);
      const consumed = await prisma.user.updateMany({
        where: { id: session.userId, pwChangeCodeHash: codeHash },
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
      if (consumed.count === 0) {
        return badRequest({ code: "Kod az önce kullanıldı. Yeni bir kod isteyin." });
      }
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
