import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth/session";
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_MAX_AGE,
  signTrustedDeviceToken,
  verifyTrustedDeviceToken,
} from "@/lib/auth/trusted-device";

export type { SessionPayload };

/** Read & verify the current session from cookies. Returns null if absent/invalid. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** Require a session in a Server Component / Action. Redirects to /login otherwise. */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Mark the current browser as a remembered device for this user (30 days). */
export async function setTrustedDeviceCookie(userId: string): Promise<void> {
  const token = await signTrustedDeviceToken(userId);
  const store = await cookies();
  store.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUSTED_DEVICE_MAX_AGE,
  });
}

/** Whether the current browser is a remembered device for this user. Fail-closed. */
export async function hasTrustedDevice(userId: string): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(TRUSTED_DEVICE_COOKIE)?.value;
    return await verifyTrustedDeviceToken(token, userId);
  } catch {
    return false;
  }
}
