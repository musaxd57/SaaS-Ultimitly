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

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).");
  }
  return new TextEncoder().encode(secret);
}

/** Sign a trusted-device token bound to a single user. */
export async function signTrustedDeviceToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TRUSTED_DEVICE_MAX_AGE}s`)
    .sign(getSecretKey());
}

/** True only if the token is valid, unexpired, our purpose, AND for THIS user. */
export async function verifyTrustedDeviceToken(
  token: string | undefined,
  userId: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload.purpose === PURPOSE && payload.userId === userId;
  } catch {
    return false; // fail-closed
  }
}
