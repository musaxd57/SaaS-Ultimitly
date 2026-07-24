import { SignJWT, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// "Bu cihazı 30 gün hatırla" — after a successful 2FA login, an opt-in trusted-
// device cookie lets THIS browser skip the 6-digit code on future fresh logins.
// The password is ALWAYS still required. FAIL-CLOSED by design: a missing /
// invalid / tampered / wrong-user token verifies as false, so a bug can only
// ever ASK for 2FA again — it can never wrongly skip it or lock anyone out.
//
// Edge-safe (jose only); the cookie read/write helpers live in @/lib/auth.
// ---------------------------------------------------------------------------

export const TRUSTED_DEVICE_COOKIE = "guestops_trusted_device";
export const TRUSTED_DEVICE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)
const PURPOSE = "trusted_device";

// The token is bound to a 2FA "epoch" (the user's twoFactorEnabledAt time). When
// 2FA is disabled and re-enabled — e.g. after a suspected compromise — the epoch
// changes and every previously-issued trusted cookie stops matching, forcing the
// new 2FA. So "remember 30 days" never outlives a deliberate 2FA reset.

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).");
  }
  return new TextEncoder().encode(secret);
}

/** Sign a trusted-device token bound to a single user + their 2FA epoch. */
export async function signTrustedDeviceToken(userId: string, epoch: number): Promise<string> {
  return new SignJWT({ userId, purpose: PURPOSE, epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TRUSTED_DEVICE_MAX_AGE}s`)
    .sign(getSecretKey());
}

/** True only if valid, unexpired, our purpose, for THIS user AND this 2FA epoch. */
export async function verifyTrustedDeviceToken(
  token: string | undefined,
  userId: string,
  epoch: number,
): Promise<boolean> {
  if (!token) return false;
  try {
    // Pin the algorithm (matches session.ts): without an allowlist, jose would
    // accept ANY alg the token header declares. Our tokens are always HS256, so
    // reject anything else — defense-in-depth against algorithm-confusion. (Even
    // if bypassed this only skips the 2FA prompt; the password is still required.)
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return (
      payload.purpose === PURPOSE &&
      payload.userId === userId &&
      payload.epoch === epoch
    );
  } catch {
    return false; // fail-closed
  }
}
