import { describe, it, expect, vi, afterEach } from "vitest";
import { isTrustedAppUrl } from "@/lib/auth/email-verify";

// APP_URL canonical pin (Codex 07-23 #2). appBaseUrl() e-posta doğrulama token
// linklerinin tabanıdır — production'da YALNIZ canonical origin güvenilir.
// secure-url.test.ts deseni: NODE_ENV stubEnv ile iki mod ayrı ayrı pinlenir.

describe("isTrustedAppUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("production: yalnız exact canonical origin (path/slash toleranslı, origin bazlı)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedAppUrl("https://www.lixusai.com")).toBe(true);
    expect(isTrustedAppUrl("https://www.lixusai.com/")).toBe(true); // trailing slash
    expect(isTrustedAppUrl("https://www.lixusai.com/panel")).toBe(true); // origin aynı → taban yine canonical
    // RED edilenler:
    expect(isTrustedAppUrl("http://www.lixusai.com")).toBe(false); // http'li canonical
    expect(isTrustedAppUrl("https://lixusai.com")).toBe(false); // apex bile değil — tek canonical www
    expect(isTrustedAppUrl("https://www.lixusai.eu")).toBe(false); // .eu BİLİNÇLİ allowlist dışı (ayrı deploy)
    expect(isTrustedAppUrl("https://evil.example")).toBe(false);
    expect(isTrustedAppUrl("https://www.lixusai.com.evil.com")).toBe(false); // suffix trick
    expect(isTrustedAppUrl("http://localhost:3000")).toBe(false); // prod'da localhost YOK
  });

  it("dev/test: canonical VEYA localhost ailesi (http dahil); yabancı origin yine RED", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isTrustedAppUrl("https://www.lixusai.com")).toBe(true);
    expect(isTrustedAppUrl("http://localhost:3000")).toBe(true);
    expect(isTrustedAppUrl("https://localhost:3000")).toBe(true);
    expect(isTrustedAppUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isTrustedAppUrl("http://[::1]:3000")).toBe(true);
    expect(isTrustedAppUrl("https://app.example.com")).toBe(false); // dev'de bile yabancı origin red
    expect(isTrustedAppUrl("https://www.lixusai.eu")).toBe(false);
  });

  it("fail-closed: boş / çöp / http(s)-dışı şema", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedAppUrl("")).toBe(false);
    expect(isTrustedAppUrl("not-a-url")).toBe(false);
    expect(isTrustedAppUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedAppUrl("ftp://www.lixusai.com")).toBe(false);
  });
});
