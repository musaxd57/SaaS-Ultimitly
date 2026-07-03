import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimit, clientIp, __resetRateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit, then blocks with a retry-after", () => {
    const key = "k";
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 60_000).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000).ok).toBe(true); // different key unaffected
  });

  it("resets after the window elapses", async () => {
    expect(rateLimit("w", 1, 20).ok).toBe(true);
    expect(rateLimit("w", 1, 20).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(rateLimit("w", 1, 20).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the rightmost (trusted-proxy) x-forwarded-for hop, not the spoofable leftmost", () => {
    // "1.2.3.4" is client-supplied (spoofable); "5.6.7.8" is appended by the proxy.
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("5.6.7.8");
    // A single value still works.
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } }))).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip then 'unknown'", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("IGNORES cf-connecting-ip by default — a direct-to-origin client could set it freely", () => {
    const req = new Request("http://x", {
      headers: { "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("5.6.7.8"); // rightmost XFF hop (platform-appended)
  });

  it("prefers cf-connecting-ip only when TRUST_CF_HEADER=1 (origin locked behind Cloudflare)", () => {
    vi.stubEnv("TRUST_CF_HEADER", "1");
    try {
      const req = new Request("http://x", {
        headers: { "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(clientIp(req)).toBe("3.3.3.3");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
