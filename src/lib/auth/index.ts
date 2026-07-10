import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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

/** Require a session in a Server Component / Action. Redirects to /login otherwise.
 *  ALSO enforces the session epoch on the PAGE path: the (app) layout checks it,
 *  but a Next.js soft/client navigation does NOT re-run the layout server
 *  component, so without a per-render check a password-reset-invalidated (or
 *  stolen) session could keep READING page data until a full document load.
 *  requireAuth runs on every page-segment render, closing that gap. Fail-OPEN on a
 *  transient DB blip (never mass-logout — the JWT signature is still valid). */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");

  // Epoch check outside try/catch's control flow: redirect() throws NEXT_REDIRECT,
  // which must NOT be swallowed by the fail-open catch below.
  let invalid = false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { sessionEpoch: true },
    });
    if (!user || user.sessionEpoch !== session.sessionEpoch) invalid = true;
    else if (session.actorUserId && session.actorSessionEpoch !== undefined) {
      // Impersonation: also enforce the real operator's epoch (see requireSession).
      const actor = await prisma.user.findUnique({
        where: { id: session.actorUserId },
        select: { sessionEpoch: true },
      });
      if (!actor || actor.sessionEpoch !== session.actorSessionEpoch) invalid = true;
    }
  } catch {
    // DB blip — don't turn a transient read failure into a logout.
  }
  if (invalid) redirect("/api/auth/logout");
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
  // Overwrite-then-expire with the SAME attributes the cookie was set with
  // (notably path:"/"). A bare delete-by-name can fail to clear the cookie
  // behind some proxy/path setups, leaving a valid session alive after logout.
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Mark the current browser as a remembered device for this user (30 days). */
export async function setTrustedDeviceCookie(userId: string, epoch: number): Promise<void> {
  const token = await signTrustedDeviceToken(userId, epoch);
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
export async function hasTrustedDevice(userId: string, epoch: number): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(TRUSTED_DEVICE_COOKIE)?.value;
    return await verifyTrustedDeviceToken(token, userId, epoch);
  } catch {
    return false;
  }
}
