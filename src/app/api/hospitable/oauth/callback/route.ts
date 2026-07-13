import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { verifyToken, HospitableError } from "@/lib/hospitable";
import { setOrgHospitableOAuthTokens } from "@/lib/hospitable-credentials";
import { writeAudit } from "@/lib/audit";
import { baseUrlFromHost } from "@/lib/auth/email-verify";
import {
  getHospitableOAuthConfig,
  exchangeCodeForToken,
  parseOAuthStateCookie,
  OAUTH_STATE_COOKIE,
} from "@/lib/hospitable-oauth";

// Completes the OAuth round-trip: verifies the CSRF state, exchanges the code
// for a token set, validates the access token (same verifyToken call the
// manual-PAT flow uses), then stores access+refresh+expiry via
// setOrgHospitableOAuthTokens(). getOrgHospitableToken() transparently
// refreshes it going forward — sync/send never see a difference from a PAT.
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
    return NextResponse.redirect(`${base}/settings?hospitable=not_configured`);
  }

  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) {
    // The host declined the authorization screen — not a failure to log loudly.
    return NextResponse.redirect(`${base}/settings?hospitable=denied`);
  }

  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const code = url.searchParams.get("code");
  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const bound = parseOAuthStateCookie(cookieState);
  if (!code || !state || !bound || state !== bound.state) {
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=state_mismatch`),
    );
  }

  // The flow must FINISH in the exact org+user context it STARTED in (Codex
  // #13). If the session drifted between authorize and callback — operator
  // exited impersonation, switched to another customer, or a different user is
  // signed in on this browser — saving here would bind the host's Hospitable
  // tokens to the WRONG tenant. Reject BEFORE the code exchange so no token is
  // ever minted for a mismatched context.
  if (bound.organizationId !== session.organizationId || bound.userId !== session.userId) {
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=context_changed`),
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
    return clearStateCookie(NextResponse.redirect(`${base}/settings?hospitable=connected`));
  } catch (err) {
    const reason = err instanceof HospitableError ? "invalid_token" : "exchange_failed";
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=${reason}`),
    );
  }
}
