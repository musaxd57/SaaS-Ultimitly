import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { verifyToken, HospitableError } from "@/lib/hospitable";
import { setOrgHospitableOAuthTokens } from "@/lib/hospitable-credentials";
import { writeAudit } from "@/lib/audit";
import {
  getHospitableOAuthConfig,
  exchangeCodeForToken,
  OAUTH_STATE_COOKIE,
} from "@/lib/hospitable-oauth";

// Completes the OAuth round-trip: verifies the CSRF state, exchanges the code
// for a token set, validates the access token (same verifyToken call the
// manual-PAT flow uses), then stores access+refresh+expiry via
// setOrgHospitableOAuthTokens(). getOrgHospitableToken() transparently
// refreshes it going forward — sync/send never see a difference from a PAT.
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  if (!(session.role === "owner" || isSuperAdmin(session))) {
    return NextResponse.redirect(new URL("/settings?hospitable=forbidden", req.url));
  }

  const config = getHospitableOAuthConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/settings?hospitable=not_configured", req.url));
  }

  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) {
    // The host declined the authorization screen — not a failure to log loudly.
    return NextResponse.redirect(new URL("/settings?hospitable=denied", req.url));
  }

  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const code = url.searchParams.get("code");
  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (!code || !state || !cookieState || state !== cookieState) {
    return clearStateCookie(
      NextResponse.redirect(new URL("/settings?hospitable=state_mismatch", req.url)),
    );
  }

  try {
    const tokens = await exchangeCodeForToken(config, code);
    const info = await verifyToken(tokens.accessToken);
    await setOrgHospitableOAuthTokens(session.organizationId, tokens, `${info.properties} mülk`);
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "hospitable.connect",
      metadata: { via: "oauth", properties: info.properties },
    });
    return clearStateCookie(NextResponse.redirect(new URL("/settings?hospitable=connected", req.url)));
  } catch (err) {
    const reason = err instanceof HospitableError ? "invalid_token" : "exchange_failed";
    return clearStateCookie(
      NextResponse.redirect(new URL(`/settings?hospitable=${reason}`, req.url)),
    );
  }
}
