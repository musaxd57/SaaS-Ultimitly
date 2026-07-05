import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";

export type { SessionPayload };

/** Returns the current session or null (for route handlers). Also enforces the
 *  session epoch: a stolen token whose sessionEpoch no longer matches the user's
 *  current DB value (bumped on password change/reset, or if the user was deleted)
 *  is rejected here, so every authed API route returns 401 without any per-route
 *  change. One indexed primary-key lookup; fail-OPEN on a transient DB error so a
 *  blip can never mass-logout (the JWT signature is still valid). */
export async function requireSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { sessionEpoch: true },
    });
    if (!user || user.sessionEpoch !== session.sessionEpoch) return null;
    // While impersonating, ALSO enforce the real operator's epoch — else a stolen
    // impersonation token would survive the operator resetting their OWN password
    // (which bumps only the operator's epoch, not the assumed customer's). Skipped
    // for legacy impersonation tokens minted before this claim (backward compatible).
    if (session.actorUserId && session.actorSessionEpoch !== undefined) {
      const actor = await prisma.user.findUnique({
        where: { id: session.actorUserId },
        select: { sessionEpoch: true },
      });
      if (!actor || actor.sessionEpoch !== session.actorSessionEpoch) return null;
    }
  } catch {
    // DB blip — don't turn a transient read failure into a logout.
  }
  return session;
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function unauthorized() {
  return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 401 });
}

export function badRequest(fields: Record<string, string>) {
  return NextResponse.json({ error: "Doğrulama hatası", fields }, { status: 400 });
}

export function notFound(message = "Kayıt bulunamadı") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function forbidden(message = "Bu işlem için yetkiniz yok") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** 402: a paid/AI feature is used while the subscription is not active. */
export function paymentRequired(
  message = "Aboneliğiniz aktif değil. AI ve otomatik yanıt özellikleri için Ayarlar'dan bir plan seçin.",
) {
  return NextResponse.json({ error: message }, { status: 402 });
}

/**
 * Owner/manager may perform config & destructive actions (create/edit/delete
 * properties, templates, knowledge base, bulk settings, create/delete tasks).
 * Staff (e.g. cleaners) cannot — they only update task status/photos.
 * Operators impersonating a customer carry that org's owner role, so unaffected.
 */
export function canManage(session: SessionPayload | null): boolean {
  return session?.role === "owner" || session?.role === "manager";
}

/**
 * 500 response. Pass the caught error as the 2nd arg so it reaches Sentry/alert
 * email via reportError — a plain `catch {}` here would make the failure totally
 * invisible (only `reportError`, NOT bare console.error, is captured).
 */
export function serverError(message = "Beklenmeyen bir hata oluştu", err?: unknown) {
  if (err !== undefined) void reportError("api", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export function tooManyRequests(retryAfter: number, message = "Çok fazla istek. Lütfen biraz bekleyin.") {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } },
  );
}

/** Verify a property belongs to the org (multi-tenant isolation). */
export async function propertyInOrg(propertyId: string, organizationId: string) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true },
  });
  return Boolean(property);
}
