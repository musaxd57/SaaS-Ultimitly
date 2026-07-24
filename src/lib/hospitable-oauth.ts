import "server-only";
import { randomBytes } from "crypto";
import { isSecureExternalUrl } from "@/lib/secure-url";

// ---------------------------------------------------------------------------
// Hospitable OAuth vendor flow ("Hospitable ile Bağlan" one-click connect).
// DORMANT until the client credentials are set — mirrors the Paddle
// dormant-adapter pattern: nothing here is called automatically, and the UI
// button only renders when isHospitableOAuthConfigured() is true, so the
// existing manual Personal-Access-Token flow (hospitable/connect route) keeps
// working unconditionally as the fallback/default path.
//
// authorize/token URLs default to Hospitable's documented, non-partner-
// specific OAuth2 endpoints (developer.hospitable.com/docs/public-api-docs
// → Authentication), confirmed from two independent lookups — not guessed.
// Still overridable via env in case Hospitable ever changes them.
// ---------------------------------------------------------------------------

export const OAUTH_STATE_COOKIE = "hospitable_oauth_state";
export const STATE_MAX_AGE = 10 * 60; // 10 minutes — just long enough for the redirect round-trip
const DEFAULT_AUTHORIZE_URL = "https://auth.hospitable.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://auth.hospitable.com/oauth/token";
// The ONE trusted production callback that receives the OAuth authorization code.
export const CANONICAL_OAUTH_REDIRECT_URI = "https://www.lixusai.com/api/hospitable/oauth/callback";

// Loopback hosts allowed to receive the callback over http in dev/test only.
const LOCAL_CALLBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Is `uri` a TRUSTED redirect target for the OAuth authorization code?
 *   production : the canonical callback ONLY (a full trusted-allowlist of one) —
 *                a wrong/hostile value must never receive the code.
 *   dev / test : the canonical callback, OR https to our own *.lixusai.com, OR
 *                http to localhost (a local callback while developing).
 * The URI is never logged (it can carry flow parameters).
 */
export function isTrustedRedirectUri(uri: string): boolean {
  if (uri === CANONICAL_OAUTH_REDIRECT_URI) return true;
  if (process.env.NODE_ENV === "production") return false; // canonical only in prod
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol === "https:" && (host === "lixusai.com" || host.endsWith(".lixusai.com"))) return true;
  if (u.protocol === "http:" && LOCAL_CALLBACK_HOSTS.has(host)) return true;
  return false;
}

export interface HospitableOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
}

/** Null unless the client credentials are set — the single dormant/live switch. */
export function getHospitableOAuthConfig(): HospitableOAuthConfig | null {
  const clientId = process.env.HOSPITABLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.HOSPITABLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const authorizeUrl = process.env.HOSPITABLE_OAUTH_AUTHORIZE_URL?.trim() || DEFAULT_AUTHORIZE_URL;
  const tokenUrl = process.env.HOSPITABLE_OAUTH_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL;
  const redirectUri = process.env.HOSPITABLE_OAUTH_REDIRECT_URI?.trim() || CANONICAL_OAUTH_REDIRECT_URI;
  // Fail-closed: an untrusted redirect URI (wrong host / http in production)
  // disables OAuth entirely — the authorization code must never be sent anywhere
  // but the canonical callback. The boot gate refuses it loudly in production; this
  // is the runtime backstop. The URI is not logged.
  if (!isTrustedRedirectUri(redirectUri)) return null;
  return { clientId, clientSecret, authorizeUrl, tokenUrl, redirectUri };
}

export function isHospitableOAuthConfigured(): boolean {
  return getHospitableOAuthConfig() !== null;
}

/** A fresh random CSRF state value for one authorize round-trip. */
export function generateOAuthState(): string {
  return randomBytes(24).toString("hex");
}

// The state cookie binds the round-trip to the INITIATING session context, not
// just to a CSRF nonce (Codex #13): an operator who starts the connect flow
// while impersonating org A, then exits impersonation (or switches to org B)
// before Hospitable redirects back, must NOT have the host's tokens saved to
// whatever org the session happens to hold at callback time. The callback
// requires cookie-org === session-org and cookie-user === session-user.
//
// No HMAC needed: the cookie is httpOnly and only ever EQUALITY-CHECKED against
// the server-side session — a client tampering with its own cookie can only
// make its own flow fail, never redirect a token to a foreign org.

/** Pack the CSRF state + initiating org/user into the state cookie value. */
export function packOAuthStateCookie(state: string, organizationId: string, userId: string): string {
  // "." never appears in the hex state or in cuid ids — an unambiguous join.
  return `${state}.${organizationId}.${userId}`;
}

/** Parse a state cookie; null on any malformed/legacy (bare-state) value. */
export function parseOAuthStateCookie(
  value: string | undefined,
): { state: string; organizationId: string; userId: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return { state: parts[0], organizationId: parts[1], userId: parts[2] };
}

export function buildAuthorizeUrl(config: HospitableOAuthConfig, state: string): string | null {
  // Fail-closed: never build a browser redirect to an insecure authorize endpoint
  // — the whole handshake (including the returned code) would ride that scheme. The
  // boot gate refuses an http HOSPITABLE_OAUTH_AUTHORIZE_URL in production; this is
  // the runtime backstop (production → https only; dev/test → localhost http ok).
  // The URL is never logged.
  if (!isSecureExternalUrl(config.authorizeUrl)) return null;
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "property:read reservation:read message:read message:write");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * `authFailure: true` means Hospitable rejected the credentials themselves
 * (e.g. the refresh token was invalid, reused, or past its 90-day expiry) —
 * the connection is dead and must be re-authorized, so callers should clear
 * the stored tokens. `authFailure: false` means a transient problem (network,
 * timeout, 5xx) — the stored refresh token may still be good, so callers
 * should just skip this cycle and retry later, NOT clear the connection.
 */
export class HospitableOAuthError extends Error {
  authFailure: boolean;
  constructor(message: string, authFailure: boolean) {
    super(message);
    this.authFailure = authFailure;
  }
}

export interface HospitableTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry, derived from the response's expires_in (seconds from now). */
  expiresAt: Date;
}

/** Hospitable docs: access_token expires after 12h; used as a fallback only if
 *  a token response is ever missing expires_in (defensive, should not happen). */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

function parseTokenResponse(data: unknown): HospitableTokenSet {
  const d = data as Record<string, unknown> | null;
  const accessToken = d?.access_token;
  const refreshToken = d?.refresh_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new HospitableOAuthError("Token response had no access_token", true);
  }
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new HospitableOAuthError("Token response had no refresh_token", true);
  }
  const expiresIn =
    typeof d?.expires_in === "number" && d.expires_in > 0
      ? d.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

async function postTokenRequest(
  config: HospitableOAuthConfig,
  body: Record<string, string>,
): Promise<HospitableTokenSet> {
  // HTTPS-pin (P2): the client_secret is POSTed to this URL — never over http.
  // authFailure:false because this is a CONFIG problem, not a dead credential, so
  // it must not clear the stored refresh token. No network call is made. The URL
  // is not included in the message. (The boot gate also refuses an http
  // HOSPITABLE_OAUTH_TOKEN_URL in production.)
  if (!isSecureExternalUrl(config.tokenUrl)) {
    throw new HospitableOAuthError("OAuth token URL is not https — refused (no client_secret sent).", false);
  }
  let res: Response;
  try {
    res = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new HospitableOAuthError(
      `Token request network failure: ${err instanceof Error ? err.message : "unknown"}`,
      false,
    );
  }
  if (!res.ok) {
    // 4xx from an OAuth token endpoint is the standard shape for "invalid_grant"
    // (bad code / bad or reused refresh token) — treat as a definitive auth
    // failure. 5xx/429 are the server's problem, not the credential's — retry later.
    const authFailure = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new HospitableOAuthError(`Token request failed (${res.status})`, authFailure);
  }
  const data = await res.json().catch(() => null);
  return parseTokenResponse(data);
}

/** Exchange an authorization code for a token set. Throws HospitableOAuthError. */
export async function exchangeCodeForToken(
  config: HospitableOAuthConfig,
  code: string,
): Promise<HospitableTokenSet> {
  return postTokenRequest(config, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
}

/** Use a refresh token to get a new token set. Refresh tokens ROTATE — the
 *  response's refresh_token replaces the one that was just used. Throws
 *  HospitableOAuthError (authFailure:true means this refresh token is dead). */
export async function refreshAccessToken(
  config: HospitableOAuthConfig,
  refreshToken: string,
): Promise<HospitableTokenSet> {
  return postTokenRequest(config, {
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });
}
