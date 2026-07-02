import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  getOrgHospitableToken,
  isPrimaryOrg,
  setOrgHospitableToken,
  setOrgHospitableOAuthTokens,
  clearOrgHospitableToken,
  getConnectionInfo,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";

vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return {
    ...actual,
    getHospitableOAuthConfig: vi.fn(),
    refreshAccessToken: vi.fn(),
  };
});
import { getHospitableOAuthConfig, refreshAccessToken, HospitableOAuthError } from "@/lib/hospitable-oauth";
const mockGetConfig = vi.mocked(getHospitableOAuthConfig);
const mockRefresh = vi.mocked(refreshAccessToken);

const FAKE_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
};

// Core multi-tenant isolation invariant: each org uses ITS OWN Hospitable token;
// only the founder's ("primary", oldest) org may fall back to the global env
// token. A customer org must NEVER receive the shared token.
describe("hospitable-credentials (multi-tenant isolation)", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.unstubAllEnvs();
  });

  async function makeOrg(name: string) {
    return prisma.organization.create({ data: { name } });
  }

  it("primary = oldest org; only it falls back to the env token", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    const founder = await makeOrg("Founder"); // created first → oldest → primary
    // ensure a distinct, later createdAt for the customer org
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    expect(await isPrimaryOrg(founder.id)).toBe(true);
    expect(await isPrimaryOrg(customer.id)).toBe(false);

    // Founder (primary) gets the env token; customer gets NOTHING (isolation).
    expect(await getOrgHospitableToken(founder.id)).toBe("FOUNDER_ENV_TOKEN");
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });

  it("a connected org uses its OWN token, never the env token", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    const founder = await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    await setOrgHospitableToken(customer.id, "CUSTOMER_OWN_TOKEN", "3 mülk");
    expect(await getOrgHospitableToken(customer.id)).toBe("CUSTOMER_OWN_TOKEN");

    // Even the primary org prefers its own stored token over the env fallback.
    await setOrgHospitableToken(founder.id, "FOUNDER_OWN_TOKEN", "8 mülk");
    expect(await getOrgHospitableToken(founder.id)).toBe("FOUNDER_OWN_TOKEN");
  });

  it("disconnect drops the stored token (back to null for a customer org)", async () => {
    await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");
    await setOrgHospitableToken(customer.id, "CUSTOMER_OWN_TOKEN", null);
    await clearOrgHospitableToken(customer.id);
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });

  it("getConnectionInfo reports a customer org with no token as disconnected", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    const info = await getConnectionInfo(customer.id);
    expect(info.connected).toBe(false);
    expect(info.ownToken).toBe(false);
    expect(info.envAvailable).toBe(false); // env fallback is primary-only
  });

  it("getConnectionInfo treats an undecryptable stored token as disconnected", async () => {
    const customer = await makeOrg("Customer");
    // Simulate a corrupt/rotated-key value directly in the DB.
    await prisma.organization.update({
      where: { id: customer.id },
      data: { hospitableTokenEnc: "v1.not.real.ciphertext" },
    });
    const info = await getConnectionInfo(customer.id);
    expect(info.ownToken).toBe(false);
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });
});

// OAuth-connected orgs carry a real expiry (Hospitable access tokens live 12h)
// and must be transparently refreshed — every scenario below exercises the
// SAME getOrgHospitableToken() every sync/send call site already uses, so a
// green suite here means zero caller changes are needed anywhere else.
describe("hospitable-credentials (OAuth token refresh)", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  async function makeOrg(name: string) {
    return prisma.organization.create({ data: { name } });
  }

  it("returns the stored access token as-is when not yet due for refresh", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      "5 mülk",
    );
    expect(await getOrgHospitableToken(org.id)).toBe("access-1");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refreshes and persists a new token set when the access token is due/expired", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() - 1000) },
      "5 mülk",
    );
    mockGetConfig.mockReturnValue(FAKE_CONFIG);
    mockRefresh.mockResolvedValue({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });

    const token = await getOrgHospitableToken(org.id);
    expect(token).toBe("access-new");
    expect(mockRefresh).toHaveBeenCalledWith(FAKE_CONFIG, "refresh-old");

    // Persisted so the NEXT call doesn't refresh again.
    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updated.hospitableTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    mockRefresh.mockClear();
    expect(await getOrgHospitableToken(org.id)).toBe("access-new");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a definitive auth failure (dead refresh token) clears the connection — Settings shows disconnected", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-old", refreshToken: "refresh-dead", expiresAt: new Date(Date.now() - 1000) },
      "5 mülk",
    );
    mockGetConfig.mockReturnValue(FAKE_CONFIG);
    mockRefresh.mockRejectedValue(new HospitableOAuthError("invalid_grant", true));

    expect(await getOrgHospitableToken(org.id)).toBeNull();
    const info = await getConnectionInfo(org.id);
    expect(info.connected).toBe(false);
    expect(info.ownToken).toBe(false);
  });

  it("a transient failure (network/5xx) does NOT clear the connection — retried next cycle", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-old", refreshToken: "refresh-still-good", expiresAt: new Date(Date.now() - 1000) },
      "5 mülk",
    );
    mockGetConfig.mockReturnValue(FAKE_CONFIG);
    mockRefresh.mockRejectedValueOnce(new HospitableOAuthError("network timeout", false));

    expect(await getOrgHospitableToken(org.id)).toBeNull(); // this cycle: not connected
    const info = await getConnectionInfo(org.id);
    expect(info.connected).toBe(true); // but the connection itself is still intact
    expect(info.ownToken).toBe(true);

    // Next cycle succeeds once the transient issue clears.
    mockRefresh.mockResolvedValueOnce({
      accessToken: "access-recovered",
      refreshToken: "refresh-recovered",
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });
    expect(await getOrgHospitableToken(org.id)).toBe("access-recovered");
  });

  it("returns null (never throws) when OAuth is not configured but a token is due for refresh", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() - 1000) },
      "5 mülk",
    );
    mockGetConfig.mockReturnValue(null); // env vars unset — dormant
    expect(await getOrgHospitableToken(org.id)).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("switching to a manually-pasted PAT clears any prior OAuth refresh/expiry state", async () => {
    const org = await makeOrg("Org");
    await setOrgHospitableOAuthTokens(
      org.id,
      { accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      "5 mülk",
    );
    await setOrgHospitableToken(org.id, "MANUAL_PAT", "5 mülk");

    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updated.hospitableRefreshTokenEnc).toBeNull();
    expect(updated.hospitableTokenExpiresAt).toBeNull();
    // Never expires now — no refresh attempted even long after the old expiry would have passed.
    expect(await getOrgHospitableToken(org.id)).toBe("MANUAL_PAT");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
