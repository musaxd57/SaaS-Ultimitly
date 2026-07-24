import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// Codex #13: the OAuth state cookie was ONLY a CSRF nonce — it did not carry
// which org/user STARTED the flow. An operator impersonating org A who exits
// impersonation (or switches org) while the Hospitable authorize screen is
// open would have the host's tokens saved to whatever org the session holds at
// CALLBACK time. The cookie now packs {state, orgId, userId} and the callback
// requires them to equal the current session BEFORE exchanging the code.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return {
    ...actual,
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
  };
});
vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return { ...actual, verifyToken: vi.fn(async () => ({ properties: 3, name: "Host" })) };
});
vi.mock("@/lib/hospitable-credentials", () => ({ setOrgHospitableOAuthTokens: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

import { GET as authorize } from "@/app/api/hospitable/oauth/authorize/route";
import { GET as callback } from "@/app/api/hospitable/oauth/callback/route";
import { setOrgHospitableOAuthTokens } from "@/lib/hospitable-credentials";
import { exchangeCodeForToken, OAUTH_STATE_COOKIE, packOAuthStateCookie, parseOAuthStateCookie } from "@/lib/hospitable-oauth";

const mockSave = vi.mocked(setOrgHospitableOAuthTokens);
const mockExchange = vi.mocked(exchangeCodeForToken);

function owner(orgId: string, userId: string): SessionPayload {
  return { userId, organizationId: orgId, role: "owner", email: `${userId}@x.com`, name: userId, sessionEpoch: 0 };
}

/** Run the REAL authorize route and pull out the state cookie + query state. */
async function startFlow() {
  const res = await authorize(
    new NextRequest("http://localhost/api/hospitable/oauth/authorize", { headers: { host: "www.lixusai.com" } }),
  );
  const cookie = res.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const state = new URL(res.headers.get("location")!).searchParams.get("state") ?? "";
  return { cookie, state };
}

function callbackReq(state: string, cookie: string) {
  return new NextRequest(`http://localhost/api/hospitable/oauth/callback?state=${state}&code=authcode`, {
    headers: { host: "www.lixusai.com", cookie: `${OAUTH_STATE_COOKIE}=${cookie}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "cid");
  vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_SECRET", "cs");
});

describe("OAuth state ↔ session context binding", () => {
  it("pack/parse round-trips; legacy bare-state and malformed values parse to null", () => {
    const packed = packOAuthStateCookie("abc123", "org_a", "user_1");
    expect(parseOAuthStateCookie(packed)).toEqual({ state: "abc123", organizationId: "org_a", userId: "user_1" });
    expect(parseOAuthStateCookie("just-a-bare-state")).toBeNull(); // pre-fix cookie format
    expect(parseOAuthStateCookie("a.b")).toBeNull();
    expect(parseOAuthStateCookie("a..c")).toBeNull();
    expect(parseOAuthStateCookie(undefined)).toBeNull();
  });

  it("HAPPY: same org+user from authorize to callback → tokens saved to the INITIATING org", async () => {
    session = owner("org_a", "user_1");
    const { cookie, state } = await startFlow();

    const res = await callback(callbackReq(state, cookie));
    expect(res.headers.get("location")).toContain("hospitable=connected");
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toBe("org_a");
  });

  it("ORG DRIFT: session switches to another org mid-flow → rejected, NOTHING saved, code never exchanged", async () => {
    session = owner("org_a", "user_1");
    const { cookie, state } = await startFlow();

    session = owner("org_b", "user_1"); // impersonation exit / org switch while the authorize screen was open
    const res = await callback(callbackReq(state, cookie));
    expect(res.headers.get("location")).toContain("hospitable=context_changed");
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockExchange).not.toHaveBeenCalled(); // rejected BEFORE minting any token
  });

  it("USER DRIFT: a different user finishes the flow in the same org → rejected", async () => {
    session = owner("org_a", "user_1");
    const { cookie, state } = await startFlow();

    session = owner("org_a", "user_2");
    const res = await callback(callbackReq(state, cookie));
    expect(res.headers.get("location")).toContain("hospitable=context_changed");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("LEGACY cookie (bare state, pre-fix format) → state_mismatch, nothing saved", async () => {
    session = owner("org_a", "user_1");
    const res = await callback(callbackReq("somestate", "somestate"));
    expect(res.headers.get("location")).toContain("hospitable=state_mismatch");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("CSRF still enforced: query state ≠ cookie state → state_mismatch", async () => {
    session = owner("org_a", "user_1");
    const { cookie } = await startFlow();
    const res = await callback(callbackReq("forged-state", cookie));
    expect(res.headers.get("location")).toContain("hospitable=state_mismatch");
    expect(mockSave).not.toHaveBeenCalled();
  });
});
