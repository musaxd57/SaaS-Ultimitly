import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import {
  getHospitableOAuthConfig,
  generateOAuthState,
  buildAuthorizeUrl,
  OAUTH_STATE_COOKIE,
} from "@/lib/hospitable-oauth";

// Starts the "Hospitable ile Bağlan" one-click OAuth flow: mints a CSRF state,
// stores it in a short-lived httpOnly cookie, and redirects the browser to
// Hospitable's authorize screen. Same authorization rule as the manual-token
// connect route (owner or operator/super-admin only).
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  if (!(session.role === "owner" || isSuperAdmin(session))) {
    return NextResponse.redirect(new URL("/settings?hospitable=forbidden", req.url));
  }

  const config = getHospitableOAuthConfig();
  if (!config) {
    // Dormant — the UI button is hidden whenever this is the case, so reaching
    // here directly is an edge case (e.g. stale tab); fail safe, not loudly.
    return NextResponse.redirect(new URL("/settings?hospitable=not_configured", req.url));
  }

  const state = generateOAuthState();
  const res = NextResponse.redirect(buildAuthorizeUrl(config, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
