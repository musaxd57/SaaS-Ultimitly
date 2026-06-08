import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  tooManyRequests,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Set a new password for the signed-in user. Authenticated by the active session
 * (so an owner who forgot their password can recover access while logged in).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Throttle password changes (anti-abuse / anti-lockout-spam).
  const limited = rateLimit(`pw-change:${session.userId}`, 5, 10 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await req.json().catch(() => null);
    const newPassword = typeof data?.newPassword === "string" ? data.newPassword.trim() : "";
    if (newPassword.length < 8) {
      return badRequest({ newPassword: "Şifre en az 8 karakter olmalı." });
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: session.userId }, data: { passwordHash } });
    return jsonOk({ ok: true });
  } catch {
    return serverError();
  }
}
