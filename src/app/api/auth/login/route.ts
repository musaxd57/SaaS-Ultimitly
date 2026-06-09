import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema, zodFieldErrors } from "@/lib/validators";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie, hasTrustedDevice, setTrustedDeviceCookie } from "@/lib/auth";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { decryptSecret } from "@/lib/crypto";
import { verifyTotp } from "@/lib/auth/totp";
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

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !ok) {
      return NextResponse.json({ error: "E-posta veya şifre hatalı" }, { status: 401 });
    }

    // Second factor (authenticator app), when enabled for this account. The
    // password is correct at this point; we still withhold the session until a
    // valid 6-digit code is supplied — UNLESS this is a remembered ("trusted")
    // device, in which case the code is skipped for 30 days. The password is
    // re-sent with the code, so no server-side pending state is needed.
    let trustedDevice = false;
    if (user.twoFactorEnabledAt) {
      // Fail-closed: any error reading the trusted-device cookie → ask for 2FA.
      trustedDevice = await hasTrustedDevice(user.id);
      if (!trustedDevice) {
        const code = parsed.data.code?.trim() ?? "";
        if (!code) {
          // Tell the client to prompt for the code (no session issued yet).
          return jsonOk({ twoFactorRequired: true });
        }
        const secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : null;
        if (!secret || !verifyTotp(secret, code)) {
          return NextResponse.json(
            { error: "Doğrulama kodu hatalı", twoFactorRequired: true },
            { status: 401 },
          );
        }
      }
    }

    await setSessionCookie({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      email: user.email,
      name: user.name,
    });

    // Remember this device (skip the 2FA code here for 30 days). Only meaningful
    // for 2FA accounts; refreshed on each trusted login so it stays sliding.
    // Never fatal: a failure here must not undo the successful login.
    if (user.twoFactorEnabledAt && (parsed.data.rememberDevice || trustedDevice)) {
      try {
        await setTrustedDeviceCookie(user.id);
      } catch {
        // ignore — the login already succeeded.
      }
    }

    return jsonOk({ ok: true });
  } catch {
    return serverError();
  }
}
