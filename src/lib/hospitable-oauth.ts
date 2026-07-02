import "server-only";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Hospitable OAuth vendor flow ("Hospitable ile Bağlan" one-click connect).
// DORMANT until all required env vars are set — mirrors the Paddle/Iyzico
// dormant-adapter pattern: nothing here is called automatically, and the UI
// button only renders when isHospitableOAuthConfigured() is true, so the
// existing manual Personal-Access-Token flow (hospitable/connect route) keeps
// working unconditionally as the fallback/default path.
//
// The actual authorize/token endpoint URLs are NOT guessed — they come from
// env (HOSPITABLE_OAUTH_AUTHORIZE_URL / HOSPITABLE_OAUTH_TOKEN_URL) sourced
// from Hospitable's partner docs, so a wrong guess can never silently ship.
// ---------------------------------------------------------------------------

export const OAUTH_STATE_COOKIE = "hospitable_oauth_state";
const STATE_MAX_AGE = 10 * 60; // 10 minutes — just long enough for the redirect round-trip

export interface HospitableOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
}

/** Null unless every required env var is set — the single dormant/live switch. */
export function getHospitableOAuthConfig(): HospitableOAuthConfig | null {
  const clientId = process.env.HOSPITABLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.HOSPITABLE_OAUTH_CLIENT_SECRET?.trim();
  const authorizeUrl = process.env.HOSPITABLE_OAUTH_AUTHORIZE_URL?.trim();
  const tokenUrl = process.env.HOSPITABLE_OAUTH_TOKEN_URL?.trim();
  const redirectUri =
    process.env.HOSPITABLE_OAUTH_REDIRECT_URI?.trim() ||
    "https://www.lixusai.com/api/hospitable/oauth/callback";
  if (!clientId || !clientSecret || !authorizeUrl || !tokenUrl) return null;
  return { clientId, clientSecret, authorizeUrl, tokenUrl, redirectUri };
}

export function isHospitableOAuthConfigured(): boolean {
  return getHospitableOAuthConfig() !== null;
}

/** A fresh random CSRF state value for one authorize round-trip. */
export function generateOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildAuthorizeUrl(config: HospitableOAuthConfig, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "property:read reservation:read message:read message:write");
  url.searchParams.set("state", state);
  return url.toString();
}

export class HospitableOAuthError extends Error {}

/** Exchange an authorization code for an access token. Throws on any failure. */
export async function exchangeCodeForToken(
  config: HospitableOAuthConfig,
  code: string,
): Promise<string> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new HospitableOAuthError(`Token exchange failed (${res.status})`);
  }
  const data = await res.json().catch(() => null);
  const accessToken = data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new HospitableOAuthError("Token exchange response had no access_token");
  }
  return accessToken;
}
