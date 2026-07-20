import { describe, it, expect, afterEach, vi } from "vitest";
import { isSecureExternalUrl } from "@/lib/secure-url";

// P2 HTTPS-pin runtime predicate. A base URL that carries a secret (API key /
// bearer token / OAuth client_secret) must be https in production; dev/test may
// use http ONLY to localhost (a local mock / injected test transport). This is
// the shared guard behind hospitable / hospitable-oauth / supply-ai / shadow-ai.

describe("isSecureExternalUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("https is always accepted", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSecureExternalUrl("https://api.akashml.com/v1")).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isSecureExternalUrl("https://public.api.hospitable.com/v2")).toBe(true);
  });

  it("PRODUCTION refuses http — even to localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSecureExternalUrl("http://api.akashml.com/v1")).toBe(false);
    expect(isSecureExternalUrl("http://localhost:3000")).toBe(false);
    expect(isSecureExternalUrl("http://127.0.0.1/v1")).toBe(false);
  });

  it("DEV/TEST allows http ONLY to localhost (injected transport / local mock)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isSecureExternalUrl("http://localhost:3000/v1")).toBe(true);
    expect(isSecureExternalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isSecureExternalUrl("http://[::1]:8080/v1")).toBe(true);
    // A non-localhost http endpoint is refused even in dev/test — the carve-out
    // is deliberately narrow (a real external host must be https everywhere).
    expect(isSecureExternalUrl("http://api.akashml.com/v1")).toBe(false);
    expect(isSecureExternalUrl("http://evil.example/v1")).toBe(false);
  });

  it("fails closed on empty / garbage / non-http(s) schemes", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSecureExternalUrl("")).toBe(false);
    expect(isSecureExternalUrl(undefined)).toBe(false);
    expect(isSecureExternalUrl(null)).toBe(false);
    expect(isSecureExternalUrl("not-a-url")).toBe(false);
    expect(isSecureExternalUrl("ftp://api.akashml.com")).toBe(false);
    // http:// to localhost is a dev-only allowance — still refused in prod above.
    vi.stubEnv("NODE_ENV", "development");
    expect(isSecureExternalUrl("ftp://localhost")).toBe(false);
  });
});
