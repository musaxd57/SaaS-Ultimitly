import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/lib/constants";

// Edge-safe session helpers (jose only). Used by both middleware and server.

export const SESSION_COOKIE = "guestops_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (seconds)

export interface SessionPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
  name: string;
  // Impersonation (operator panel): when a super-admin "enters" a customer org,
  // the session carries the customer's context above AND these actor fields —
  // the REAL operator behind it — so we can show a banner, keep super-admin
  // powers, and switch back. Signed into the JWT, so they cannot be forged.
  actorUserId?: string;
  actorEmail?: string;
  actorName?: string;
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
    const { payload } = await jwtVerify(token, getSecretKey());
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
        ...(typeof payload.actorUserId === "string" ? { actorUserId: payload.actorUserId } : {}),
        ...(typeof payload.actorEmail === "string" ? { actorEmail: payload.actorEmail } : {}),
        ...(typeof payload.actorName === "string" ? { actorName: payload.actorName } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
