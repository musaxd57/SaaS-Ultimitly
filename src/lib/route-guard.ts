import { type NextRequest } from "next/server";
import { currentCorrelationId, newCorrelationId, runWithCorrelation, USER_VISIBLE_CORRELATION_PREFIX } from "@/lib/correlation";
import {
  requireSession,
  unauthorized,
  forbidden,
  serverError,
  canManage,
  impersonationReadOnly,
  type SessionPayload,
} from "@/lib/api";
import { hostWriteLimited } from "@/lib/host-write-limit";
import { isReadOnlyMethod } from "@/lib/auth/impersonation";

// ---------------------------------------------------------------------------
// Route auth wrappers. Fold the repeated preamble — requireSession → 401, the
// owner/manager gate, and try/catch → serverError (Sentry) — into one place so
// the SAFE path is the default and a route author can't forget a step.
//
// IMPORTANT: these are AUTH-only. They inject the (non-null) session but do NOT
// org-scope anything — every handler still carries its own
// `organizationId: session.organizationId` / `propertyInOrg` / findFirst gate
// (tenant isolation stays where the query is). Do NOT wrap public/secret routes
// (webhooks, cron, health, token routes), super-admin routes, or routes with a
// custom gate — they keep guarding themselves.
//
// Kept in a SEPARATE module (not api.ts) on purpose: withAuth imports
// requireSession from @/lib/api as a cross-module reference, so a test that
// `vi.mock("@/lib/api", { requireSession })` is still honoured through the
// wrapper. (An intra-module call inside api.ts would bypass that mock.)
// ---------------------------------------------------------------------------
type RouteCtx<P> = { params: Promise<P> };

type AuthedHandler<P> = (
  session: SessionPayload,
  req: NextRequest,
  ctx: RouteCtx<P>,
) => Promise<Response> | Response;

/** Require a valid session; inject it, capture unexpected throws → 500 (Sentry).
 *  `ctx` is REQUIRED (Next's route-type validation demands a non-optional second
 *  parameter for dynamic segments). Next always passes it; tests that invoke a
 *  handler directly must pass it too (e.g. `{ params: Promise.resolve({}) }` for
 *  a collection route). */
export function withAuth<P = Record<string, never>>(handler: AuthedHandler<P>) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const session = await requireSession();
    if (!session) return unauthorized();
    // Başka siteden yazma (güvenlik 2. tur 10-22): çerez `SameSite=Lax` başka siteden POST'u zaten oturumsuz bırakır; bu kapı kardeş alt
    // alan adından (same-site) gelen ve gövdesiz (JSON ön-uçuşu tetiklemeyen) yazmayı da keser. Yazma kovasından ÖNCE — sayaç yakılmaz.
    if (crossSiteWrite(req)) return forbidden();
    // K8 (kurucu kararı 09-28): bürünmüşken (destek görünümü) müşteri hesabında yazma yok — TEK boğaz.
    const readOnly = impersonationReadOnly(session, req.method);
    if (readOnly) return readOnly;
    // Ev sahibi yazma hız sınırı (`host-write-limit.ts`, 10-21): okuma saymaz, yazma kişi başına dakikada 300.
    const limited = await hostWriteLimited(session, req.method);
    if (limited) return limited;
    // TAKİP NUMARASI (kurucu kararı 10-10): her kimlikli istek kendi numarasıyla koşar — SUNUCUDA üretilir, istemcinin gönderdiği başlık
    // KABUL EDİLMEZ (başkasının zincirine satır yazdırılamaz). Hata raporu / olay günlüğü / 500 yanıtı aynı numarayı taşır; yanıt başlığı
    // `X-Correlation-ID`.
    const correlationId = newCorrelationId();
    // Numara ekranda YALNIZ ödeme ekranının uçlarında gösterilir (kurucu kararı 10-12 sabah); diğerlerinde arka planda kalır.
    const showToUser = (req.nextUrl?.pathname ?? new URL(req.url).pathname).startsWith(USER_VISIBLE_CORRELATION_PREFIX);
    return runWithCorrelation({ id: correlationId, organizationId: session.organizationId, showToUser }, async () => {
      let res: Response;
      try {
        res = await handler(session, req, ctx);
      } catch (err) {
        res = serverError(undefined, err);
      }
      // Yanıt anındaki numara: işlem bir zincire katıldıysa (ödeme) başlık gövde ve olaylarla AYNI numarayı taşır.
      return withCorrelationHeader(res, currentCorrelationId() ?? correlationId);
    });
  };
}

/** Tarayıcının `Sec-Fetch-Site` başlığına göre başka siteden gelen yazma isteği. Başlık yoksa (sunucu istemcisi, test, eski tarayıcı)
 *  geçer — asıl kapı çerezdir; okuma (GET/HEAD/OPTIONS) hiç bakılmaz. `none` = adres çubuğu / yer imi (kullanıcının kendisi). */
export function crossSiteWrite(req: Request): boolean {
  if (isReadOnlyMethod(req.method)) return false;
  const site = req.headers.get("sec-fetch-site");
  return Boolean(site && site !== "same-origin" && site !== "none");
}

/** Yanıta takip numarası başlığı (değişmez başlıklı yanıtta — ör. `Response.redirect` — sessizce atlanır). */
function withCorrelationHeader(res: Response, id: string): Response {
  try {
    res.headers.set(CORRELATION_HEADER, id);
  } catch {
    /* değişmez başlık listesi */
  }
  return res;
}

export const CORRELATION_HEADER = "X-Correlation-ID";

/** withAuth + the owner/manager gate (config & destructive actions). */
export function withManage<P = Record<string, never>>(handler: AuthedHandler<P>) {
  return withAuth<P>((session, req, ctx) => {
    if (!canManage(session)) return forbidden();
    return handler(session, req, ctx);
  });
}

/** withAuth + the OWNER-only gate (stricter than withManage). Billing/payment and
 *  legally-loaded actions are an account-owner concern — a manager gets 403. The
 *  UI already hides these surfaces from non-owners, so this closes the gap where a
 *  manager could reach the route directly. (An owner-only route with its own
 *  feature-gate that must run FIRST, e.g. the erasure route, keeps its inline
 *  `role !== "owner"` check after the gate instead of using this.) */
export function withOwner<P = Record<string, never>>(handler: AuthedHandler<P>) {
  return withAuth<P>((session, req, ctx) => {
    if (session.role !== "owner") return forbidden();
    return handler(session, req, ctx);
  });
}
