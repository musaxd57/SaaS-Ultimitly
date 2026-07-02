import { type NextRequest } from "next/server";
import {
  requireSession,
  unauthorized,
  forbidden,
  serverError,
  canManage,
  type SessionPayload,
} from "@/lib/api";

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

/** Require a valid session; inject it, capture unexpected throws → 500 (Sentry). */
export function withAuth<P = Record<string, never>>(handler: AuthedHandler<P>) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const session = await requireSession();
    if (!session) return unauthorized();
    try {
      return await handler(session, req, ctx);
    } catch (err) {
      return serverError(undefined, err);
    }
  };
}

/** withAuth + the owner/manager gate (config & destructive actions). */
export function withManage<P = Record<string, never>>(handler: AuthedHandler<P>) {
  return withAuth<P>((session, req, ctx) => {
    if (!canManage(session)) return forbidden();
    return handler(session, req, ctx);
  });
}
