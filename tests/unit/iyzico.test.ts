import { describe, it, expect, afterEach, vi } from "vitest";
import { buildAuthHeader, getIyzicoConfig, isIyzicoConfigured } from "@/lib/payments/iyzico";

afterEach(() => vi.unstubAllEnvs());

describe("iyzico client (dormant until configured)", () => {
  it("is unconfigured (null) when keys are missing", () => {
    vi.stubEnv("IYZICO_API_KEY", "");
    vi.stubEnv("IYZICO_SECRET_KEY", "");
    expect(getIyzicoConfig()).toBeNull();
    expect(isIyzicoConfigured()).toBe(false);
  });

  it("defaults to the sandbox base URL when configured without an override", () => {
    vi.stubEnv("IYZICO_API_KEY", "key");
    vi.stubEnv("IYZICO_SECRET_KEY", "secret");
    vi.stubEnv("IYZICO_BASE_URL", "");
    expect(getIyzicoConfig()?.baseUrl).toContain("sandbox-api.iyzipay.com");
  });

  it("builds a deterministic IYZWSv2 auth header (given a fixed randomKey)", () => {
    const args = { apiKey: "k", secretKey: "s", uriPath: "/v2/x", body: "{}", randomKey: "RND" } as const;
    const a = buildAuthHeader(args);
    const b = buildAuthHeader(args);
    expect(a.authorization).toBe(b.authorization);
    expect(a.authorization.startsWith("IYZWSv2 ")).toBe(true);

    const decoded = Buffer.from(a.authorization.slice("IYZWSv2 ".length), "base64").toString();
    expect(decoded).toContain("apiKey:k");
    expect(decoded).toContain("randomKey:RND");
    expect(decoded).toMatch(/signature:[a-f0-9]{64}/); // HMAC-SHA256 hex
  });

  it("changes the signature when the secret changes", () => {
    const base = { apiKey: "k", uriPath: "/v2/x", body: "{}", randomKey: "RND" };
    const a = buildAuthHeader({ ...base, secretKey: "s1" });
    const b = buildAuthHeader({ ...base, secretKey: "s2" });
    expect(a.authorization).not.toBe(b.authorization);
  });

  it("generates a fresh randomKey when none is supplied", () => {
    const base = { apiKey: "k", secretKey: "s", uriPath: "/v2/x", body: "{}" };
    expect(buildAuthHeader(base).randomKey).not.toBe(buildAuthHeader(base).randomKey);
  });
});
