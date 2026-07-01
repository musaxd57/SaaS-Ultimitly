import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema, zodFieldErrors } from "@/lib/validators";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie, hasTrustedDevice, setTrustedDeviceCookie } from "@/lib/auth";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { decryptSecret } from "@/lib/crypto";
import { verifyTotpStep } from "@/lib/auth/totp";
import { writeAudit } from "@/lib/audit";
import { needsEmailVerification } from "@/lib/auth/email-verify";
import type { UserRole } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    // Throttle login attempts per IP: 10 tries / 5 minutes (anti brute-force).
    const limited = rateLimit(`login:${clientIp(req)}`, 10, 5 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    const data = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const email = parsed.data.email.toLowerCase();
    // Per-ACCOUNT throttle (in addition to the per-IP one above): an attacker
    // rotating IPs otherwise gets unlimited password / 2FA-code guesses against
    // one account. Generous cap so a legitimate user is not locked out.
    const acct = rateLimit(`login-acct:${email}`, 20, 15 * 60 * 1000);
    if (!acct.ok) {
      return NextResponse.json(
        { error: "Bu hesap için çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(acct.retryAfter) } },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !ok) {
      // Record a failed attempt against a KNOWN account (targeted-attack signal).
      // Unknown emails have no org to scope to — the rate limiter covers those.
      if (user) {
        await writeAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.login_failed",
          metadata: { reason: "bad_password", ip: clientIp(req) },
        });
      }
      return NextResponse.json({ error: "E-posta veya şifre hatalı" }, { status: 401 });
    }

    // E-mail verification gate — ONLY for self-serve accounts created at/after the
    // cutoff. Every pre-existing account (the founder, staff, operator-created
    // customers) is exempt, so this can never lock out a current user.
    if (needsEmailVerification(user)) {
      return NextResponse.json(
        {
          error: "E-postanı doğrulaman gerekiyor. Kayıt sırasında gönderdiğimiz doğrulama bağlantısına tıkla.",
          needsVerification: true,
        },
        { status: 403 },
      );
    }

    // Second factor (authenticator app), when enabled for this account. The
    // password is correct at this point; we still withhold the session until a
    // valid 6-digit code is supplied — UNLESS this is a remembered ("trusted")
    // device, in which case the code is skipped for 30 days. The password is
    // re-sent with the code, so no server-side pending state is needed.
    // The trusted-device cookie is bound to this epoch, so resetting 2FA
    // (disable→re-enable) invalidates every previously-remembered device.
    const twoFaEpoch = user.twoFactorEnabledAt ? user.twoFactorEnabledAt.getTime() : 0;
    let trustedDevice = false;
    if (user.twoFactorEnabledAt) {
      // Fail-closed: any error reading the trusted-device cookie → ask for 2FA.
      trustedDevice = await hasTrustedDevice(user.id, twoFaEpoch);
      if (!trustedDevice) {
        const code = parsed.data.code?.trim() ?? "";
        if (!code) {
          // Tell the client to prompt for the code (no session issued yet).
          return jsonOk({ twoFactorRequired: true });
        }
        // Fail-soft: if the secret can't be decrypted (e.g. ENCRYPTION_KEY was
        // rotated after launch), don't 500 — treat it as an invalid code so the
        // response stays clean instead of crashing the login handler.
        let secret: string | null = null;
        try {
          secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : null;
        } catch {
          secret = null;
        }
        const step = secret ? verifyTotpStep(secret, code) : null;
        // Reject a wrong code OR a code already used (replay within its window).
        if (step === null || (user.twoFactorLastStep != null && step <= user.twoFactorLastStep)) {
          return NextResponse.json(
            { error: "Doğrulama kodu hatalı", twoFactorRequired: true },
            { status: 401 },
          );
        }
        // Burn this step so the same code cannot be replayed.
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorLastStep: step },
        });
      }
    }

    await setSessionCookie({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      email: user.email,
      name: user.name,
    });

    // Security breadcrumb: a successful sign-in (who + when). Non-fatal.
    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.login_success",
      metadata: { ip: clientIp(req), twoFactor: Boolean(user.twoFactorEnabledAt) },
    });

    // Remember this device (skip the 2FA code here for 30 days). Only meaningful
    // for 2FA accounts; refreshed on each trusted login so it stays sliding.
    // Never fatal: a failure here must not undo the successful login.
    if (user.twoFactorEnabledAt && (parsed.data.rememberDevice || trustedDevice)) {
      try {
        await setTrustedDeviceCookie(user.id, twoFaEpoch);
      } catch {
        // ignore — the login already succeeded.
      }
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
