import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { baseUrlFromHost } from "@/lib/auth/email-verify";
import {
  getHospitableOAuthConfig,
  generateOAuthState,
  buildAuthorizeUrl,
  packOAuthStateCookie,
  OAUTH_STATE_COOKIE,
  STATE_MAX_AGE,
} from "@/lib/hospitable-oauth";

// Starts the "Hospitable ile Bağlan" one-click OAuth flow: mints a CSRF state,
// stores it in a short-lived httpOnly cookie, and redirects the browser to
// Hospitable's authorize screen. Same authorization rule as the manual-token
// connect route (owner or operator/super-admin only).
export async function GET(req: NextRequest) {
  // Behind Railway, req.url's origin is the INTERNAL container address
  // (localhost:xxxx) — every redirect back to OUR OWN site must be built from
  // the Host header instead, or the browser gets sent to an unreachable
  // localhost URL (see lib/auth/email-verify.ts for the same, earlier fix).
  const base = baseUrlFromHost(req.headers.get("host"));
  const session = await requireSession();
  if (!session) return NextResponse.redirect(`${base}/login`);
  if (!(session.role === "owner" || isSuperAdmin(session))) {
    return NextResponse.redirect(`${base}/settings?hospitable=forbidden`);
  }

  const config = getHospitableOAuthConfig();
  if (!config) {
    // Dormant — the UI button is hidden whenever this is the case, so reaching
    // here directly is an edge case (e.g. stale tab); fail safe, not loudly.
    return NextResponse.redirect(`${base}/settings?hospitable=not_configured`);
  }

  const state = generateOAuthState();
  const authorizeUrl = buildAuthorizeUrl(config, state);
  if (!authorizeUrl) {
    // Fail-closed: the configured authorize endpoint is not https (config error).
    // Do NOT produce a redirect or set the state cookie — send the operator back
    // to Settings with the same generic marker used when OAuth is not configured.
    return NextResponse.redirect(`${base}/settings?hospitable=not_configured`);
  }
  const res = NextResponse.redirect(authorizeUrl);
  // Bind the round-trip to the INITIATING org+user (not just CSRF): the callback
  // rejects if the session context changed mid-flow (e.g. impersonation exit),
  // so the tokens can never be saved to a different tenant than the one that
  // started the connect.
  res.cookies.set(OAUTH_STATE_COOKIE, packOAuthStateCookie(state, session.organizationId, session.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
  return res;
}
