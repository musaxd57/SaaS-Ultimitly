import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/lib/constants";

// Edge-safe session helpers (jose only). Used by both middleware and server.

export const SESSION_COOKIE = "guestops_session";
// 14 days (seconds), sliding. Re-issued on every active request, so daily users
// never get logged out; only 14-day-idle sessions expire. Shorter than 30d to
// bound a stolen token's blast radius (a forgot-password reset rotates the
// password but does not yet invalidate live sessions — sessionEpoch is deferred).
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

export interface SessionPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
  name: string;
  // Session invalidation counter (see User.sessionEpoch). Signed into the JWT;
  // server-side auth compares it to the user's current DB value so a password
  // change/reset kills stolen tokens. Legacy tokens (no claim) verify as 0, which
  // matches the DB default 0 → nobody is logged out on the deploy that adds this.
  sessionEpoch: number;
  // Impersonation (operator panel): when a super-admin "enters" a customer org,
  // the session carries the customer's context above AND these actor fields —
  // the REAL operator behind it — so we can show a banner, keep super-admin
  // powers, and switch back. Signed into the JWT, so they cannot be forged.
  actorUserId?: string;
  actorEmail?: string;
  actorName?: string;
  // The real operator's OWN sessionEpoch, signed in while impersonating, so a
  // stolen impersonation token dies when the operator resets their password
  // (which bumps their epoch). Absent on legacy tokens → the actor-epoch check
  // is skipped for them (backward compatible; nobody is logged out on rollout).
  actorSessionEpoch?: number;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    if (
      typeof payload.userId === "string" &&
      typeof payload.organizationId === "string" &&
      typeof payload.email === "string"
    ) {
      return {
        userId: payload.userId,
        organizationId: payload.organizationId,
        role: (payload.role as UserRole) ?? "staff",
        email: payload.email,
        name: (payload.name as string) ?? "",
        sessionEpoch: typeof payload.sessionEpoch === "number" ? payload.sessionEpoch : 0,
        ...(typeof payload.actorUserId === "string" ? { actorUserId: payload.actorUserId } : {}),
        ...(typeof payload.actorEmail === "string" ? { actorEmail: payload.actorEmail } : {}),
        ...(typeof payload.actorName === "string" ? { actorName: payload.actorName } : {}),
        ...(typeof payload.actorSessionEpoch === "number" ? { actorSessionEpoch: payload.actorSessionEpoch } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
