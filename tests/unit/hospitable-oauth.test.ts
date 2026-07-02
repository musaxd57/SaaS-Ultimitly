import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getHospitableOAuthConfig,
  isHospitableOAuthConfigured,
  generateOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  HospitableOAuthError,
  type HospitableOAuthConfig,
} from "@/lib/hospitable-oauth";

const ALL_ENVS = {
  HOSPITABLE_OAUTH_CLIENT_ID: "client-1",
  HOSPITABLE_OAUTH_CLIENT_SECRET: "secret-1",
  HOSPITABLE_OAUTH_AUTHORIZE_URL: "https://auth.example.com/authorize",
  HOSPITABLE_OAUTH_TOKEN_URL: "https://auth.example.com/token",
};

describe("getHospitableOAuthConfig / isHospitableOAuthConfigured — dormant by default", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null/false when no env vars are set (default deployment state)", () => {
    expect(getHospitableOAuthConfig()).toBeNull();
    expect(isHospitableOAuthConfigured()).toBe(false);
  });

  it("is null/false when only SOME required vars are set", () => {
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "client-1");
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_SECRET", "secret-1");
    // authorize/token URLs intentionally left unset
    expect(getHospitableOAuthConfig()).toBeNull();
  });

  it("resolves once ALL required vars are set, defaulting the redirect URI", () => {
    for (const [k, v] of Object.entries(ALL_ENVS)) vi.stubEnv(k, v);
    const config = getHospitableOAuthConfig();
    expect(config).not.toBeNull();
    expect(config?.clientId).toBe("client-1");
    expect(config?.redirectUri).toBe("https://www.lixusai.com/api/hospitable/oauth/callback");
    expect(isHospitableOAuthConfigured()).toBe(true);
  });

  it("honors an explicit HOSPITABLE_OAUTH_REDIRECT_URI override", () => {
    for (const [k, v] of Object.entries(ALL_ENVS)) vi.stubEnv(k, v);
    vi.stubEnv("HOSPITABLE_OAUTH_REDIRECT_URI", "https://staging.lixusai.com/api/hospitable/oauth/callback");
    expect(getHospitableOAuthConfig()?.redirectUri).toBe(
      "https://staging.lixusai.com/api/hospitable/oauth/callback",
    );
  });
});

describe("generateOAuthState", () => {
  it("produces a non-trivial, unique value each call", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("buildAuthorizeUrl", () => {
  const config: HospitableOAuthConfig = {
    clientId: "client-1",
    clientSecret: "secret-1",
    authorizeUrl: "https://auth.example.com/authorize",
    tokenUrl: "https://auth.example.com/token",
    redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
  };

  it("includes client_id, redirect_uri, response_type, scope, and state", () => {
    const url = new URL(buildAuthorizeUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-abc");
    // The 4 scopes our vendor application requested — must match exactly.
    expect(url.searchParams.get("scope")).toBe(
      "property:read reservation:read message:read message:write",
    );
  });
});

describe("exchangeCodeForToken", () => {
  const config: HospitableOAuthConfig = {
    clientId: "client-1",
    clientSecret: "secret-1",
    authorizeUrl: "https://auth.example.com/authorize",
    tokenUrl: "https://auth.example.com/token",
    redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the standard OAuth2 authorization_code grant and returns the access token", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok_123" }), { status: 200 }),
    );
    const token = await exchangeCodeForToken(config, "the-code");
    expect(token).toBe("tok_123");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(config.tokenUrl);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "client-1",
      client_secret: "secret-1",
      code: "the-code",
      redirect_uri: config.redirectUri,
    });
  });

  it("throws HospitableOAuthError on a non-OK response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toThrow(HospitableOAuthError);
  });

  it("throws HospitableOAuthError when the response has no access_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 }),
    );
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toThrow(HospitableOAuthError);
  });
});
