import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getHospitableOAuthConfig,
  isHospitableOAuthConfigured,
  generateOAuthState,
  buildAuthorizeUrl,
  isTrustedRedirectUri,
  exchangeCodeForToken,
  refreshAccessToken,
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

  it("is null/false when only the client ID is set (secret still missing)", () => {
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "client-1");
    expect(getHospitableOAuthConfig()).toBeNull();
  });

  it("resolves once client id+secret are set, defaulting authorize/token/redirect URLs", () => {
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "client-1");
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_SECRET", "secret-1");
    const config = getHospitableOAuthConfig();
    expect(config).not.toBeNull();
    expect(config?.clientId).toBe("client-1");
    // Hospitable's documented, non-partner-specific OAuth2 endpoints.
    expect(config?.authorizeUrl).toBe("https://auth.hospitable.com/oauth/authorize");
    expect(config?.tokenUrl).toBe("https://auth.hospitable.com/oauth/token");
    expect(config?.redirectUri).toBe("https://www.lixusai.com/api/hospitable/oauth/callback");
    expect(isHospitableOAuthConfigured()).toBe(true);
  });

  it("honors explicit URL overrides (authorize/token/redirect) when set", () => {
    for (const [k, v] of Object.entries(ALL_ENVS)) vi.stubEnv(k, v);
    vi.stubEnv("HOSPITABLE_OAUTH_REDIRECT_URI", "https://staging.lixusai.com/api/hospitable/oauth/callback");
    const config = getHospitableOAuthConfig();
    expect(config?.authorizeUrl).toBe(ALL_ENVS.HOSPITABLE_OAUTH_AUTHORIZE_URL);
    expect(config?.tokenUrl).toBe(ALL_ENVS.HOSPITABLE_OAUTH_TOKEN_URL);
    expect(config?.redirectUri).toBe("https://staging.lixusai.com/api/hospitable/oauth/callback");
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
    const authUrl = buildAuthorizeUrl(config, "state-abc");
    expect(authUrl).not.toBeNull();
    const url = new URL(authUrl!);
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

  it("HTTPS-pin: fail-closed (null, NO redirect) when the authorize URL is insecure", () => {
    // Non-localhost http → refused in every environment; no redirect is produced.
    expect(buildAuthorizeUrl({ ...config, authorizeUrl: "http://auth.example.com/authorize" }, "s")).toBeNull();
    expect(buildAuthorizeUrl({ ...config, authorizeUrl: "not-a-url" }, "s")).toBeNull();
  });
});

describe("isTrustedRedirectUri (OAuth callback allowlist)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the canonical callback is trusted in every environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedRedirectUri("https://www.lixusai.com/api/hospitable/oauth/callback")).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isTrustedRedirectUri("https://www.lixusai.com/api/hospitable/oauth/callback")).toBe(true);
  });

  it("PRODUCTION accepts ONLY the canonical callback — a full allowlist of one", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedRedirectUri("https://staging.lixusai.com/api/hospitable/oauth/callback")).toBe(false);
    expect(isTrustedRedirectUri("http://localhost:3000/api/hospitable/oauth/callback")).toBe(false);
    expect(isTrustedRedirectUri("https://evil.example/api/hospitable/oauth/callback")).toBe(false);
  });

  it("DEV/TEST also allows our own *.lixusai.com over https and localhost over http", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isTrustedRedirectUri("https://staging.lixusai.com/api/hospitable/oauth/callback")).toBe(true);
    expect(isTrustedRedirectUri("http://localhost:3000/api/hospitable/oauth/callback")).toBe(true);
    expect(isTrustedRedirectUri("http://127.0.0.1:3000/cb")).toBe(true);
    // Still refuses a foreign host and a non-localhost http.
    expect(isTrustedRedirectUri("https://evil.example/cb")).toBe(false);
    expect(isTrustedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isTrustedRedirectUri("not-a-url")).toBe(false);
  });
});

describe("getHospitableOAuthConfig — fail-closed on an untrusted redirect URI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null (OAuth dormant) when HOSPITABLE_OAUTH_REDIRECT_URI is a foreign host", () => {
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "client-1");
    vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_SECRET", "secret-1");
    vi.stubEnv("HOSPITABLE_OAUTH_REDIRECT_URI", "https://evil.example/api/hospitable/oauth/callback");
    expect(getHospitableOAuthConfig()).toBeNull();
    expect(isHospitableOAuthConfigured()).toBe(false);
  });
});

describe("exchangeCodeForToken / refreshAccessToken", () => {
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

  it("exchangeCodeForToken POSTs the authorization_code grant and returns a full token set", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "tok_123", refresh_token: "ref_123", expires_in: 43200 }),
        { status: 200 },
      ),
    );
    const before = Date.now();
    const tokens = await exchangeCodeForToken(config, "the-code");
    expect(tokens.accessToken).toBe("tok_123");
    expect(tokens.refreshToken).toBe("ref_123");
    // expires_in (12h) converted to an absolute Date, roughly "now + 43200s".
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(before + 43_000_000);
    expect(tokens.expiresAt.getTime()).toBeLessThanOrEqual(before + 43_200_000 + 5000);

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

  it("refreshAccessToken POSTs the refresh_token grant (rotated tokens, no redirect_uri)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "tok_new", refresh_token: "ref_new", expires_in: 43200 }),
        { status: 200 },
      ),
    );
    const tokens = await refreshAccessToken(config, "ref_old");
    expect(tokens.accessToken).toBe("tok_new");
    expect(tokens.refreshToken).toBe("ref_new"); // rotated — the NEW refresh token, not the old one
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "ref_old",
      client_id: "client-1",
      client_secret: "secret-1",
    });
    expect(body.redirect_uri).toBeUndefined();
  });

  it("a 4xx response is a definitive auth failure (authFailure:true) — dead credential", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: true,
    });
  });

  it("a 429 is NOT an auth failure (rate limit, not a dead credential)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: false,
    });
  });

  it("a 5xx response is a transient failure (authFailure:false) — retry later", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("oops", { status: 503 }));
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: false,
    });
  });

  it("a network throw is a transient failure (authFailure:false)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: false,
    });
  });

  it("throws (authFailure:true) when the response has no access_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ refresh_token: "r" }), { status: 200 }),
    );
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: true,
    });
  });

  it("throws (authFailure:true) when the response has no refresh_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "a" }), { status: 200 }),
    );
    await expect(exchangeCodeForToken(config, "the-code")).rejects.toMatchObject({
      authFailure: true,
    });
  });

  it("defaults to the documented 12h lifetime when expires_in is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 }),
    );
    const before = Date.now();
    const tokens = await exchangeCodeForToken(config, "the-code");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(before + 12 * 60 * 60 * 1000 - 5000);
  });
});
