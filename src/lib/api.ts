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
      // Also read the CURRENT role + org so authorization is DB-authoritative, not
      // JWT-frozen: a manager demoted to staff (which does NOT bump the epoch)
      // must lose manager powers immediately, not at token expiry.
      select: { sessionEpoch: true, role: true, organizationId: true },
    });
    if (!user || user.sessionEpoch !== session.sessionEpoch) return null;
    // Overwrite role/org with the live DB values (usually identical). withManage's
    // canManage() and every org-scoped query then see the current, not the stale, role.
    session.role = user.role as SessionPayload["role"];
    session.organizationId = user.organizationId;
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
    // FAIL-CLOSED: this guards the API surface (billing / admin / integrations /
    // data export+delete / message send). If we can't confirm the token still maps
    // to a live user with the CURRENT role/org/epoch, deny — a transient DB error
    // must not let a deleted or demoted user act on a stale JWT. (requireAuth, used
    // for page RENDERS, stays lenient so a blip doesn't mass-logout browsing users;
    // every mutation still flows through this fail-closed API guard.)
    return null;
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
  if (err !== undefined) {
    // A Hospitable 402 "Subscription not active" is an EXPECTED external state —
    // the org's OWN Hospitable subscription lapsed, not a Lixus bug (the scheduled
    // sync already treats it this way). Two things: (1) DON'T page Sentry + the
    // alert email on every hit (this flooded the inbox with identical "sistem
    // hatası — api"); log it instead. (2) Return a MEANINGFUL response, not a bare
    // 500 — the caller gets a clear "renew your Hospitable subscription" 409 so the
    // UI can show why the channel action failed. Every OTHER error still pages + 500s.
    const status = (err as { status?: number } | null)?.status;
    if (err instanceof Error && err.name === "HospitableError" && status === 402) {
      console.warn("[api] Hospitable subscription not active (402) — surfaced, not paged");
      return NextResponse.json(
        { error: "Hospitable aboneliğiniz aktif değil. Kanal senkronizasyonu için aboneliğinizi yenileyin." },
        { status: 409 },
      );
    }
    void reportError("api", err);
  }
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

// ---------------------------------------------------------------------------
// Body-size cap. Next 15 route handlers have NO built-in request-body limit
// (experimental.serverActions.bodySizeLimit is Server-Actions-only), so an
// UNAUTHENTICATED POST could buffer an unbounded body into memory before any
// zod/length check runs → OOM / noisy-neighbor on the shared instance. Rate limits
// bound the request COUNT, not the request SIZE. 64 KB is ample for every JSON
// payload we accept (the largest is a KB entry / offer text, well under this).
// ---------------------------------------------------------------------------
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds the size cap");
    this.name = "BodyTooLargeError";
  }
}

export function payloadTooLarge(message = "İstek gövdesi çok büyük.") {
  return NextResponse.json({ error: message }, { status: 413 });
}

/**
 * Read + JSON-parse a request body with a HARD byte cap. Rejects (a) IMMEDIATELY
 * when a Content-Length header exceeds the cap (cheap, no read), and (b) MID-STREAM
 * when the actual bytes exceed it — so a lying or absent Content-Length can't
 * smuggle a huge body past the header check. Throws BodyTooLargeError over the cap;
 * a malformed/empty body throws a SyntaxError (JSON.parse) which the caller maps to
 * a 400. Callers: `catch (e) { if (e instanceof BodyTooLargeError) return
 * payloadTooLarge(); return badRequest({...}); }`.
 */
export async function readJsonCapped<T = unknown>(
  req: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<T> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();

  const stream = req.body;
  if (!stream) return JSON.parse("") as T; // no body → SyntaxError → caller 400

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

/**
 * Drop-in for the `await req.json().catch(() => null)` pattern with the byte cap
 * added. Returns `{ ok: true, data }` on success, or `{ ok: false, tooLarge }`
 * where `tooLarge` distinguishes an over-cap body (→ the route should 413 via
 * payloadTooLarge()) from a malformed/empty body (→ the route's own 400/badRequest).
 */
export async function parseJsonBody<T = unknown>(
  req: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; data: T } | { ok: false; tooLarge: boolean }> {
  try {
    return { ok: true, data: await readJsonCapped<T>(req, maxBytes) };
  } catch (err) {
    return { ok: false, tooLarge: err instanceof BodyTooLargeError };
  }
}
