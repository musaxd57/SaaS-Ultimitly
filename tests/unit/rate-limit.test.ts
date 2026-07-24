import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../helpers/db";
import { rateLimit, clientIp, sweepExpiredRateLimits, __resetRateLimit } from "@/lib/rate-limit";

// Dağıtık (DB-destekli) sabit-pencere limiter. Otorite Postgres satırı: limitler
// replikalar arasında ve deploy/restart sonrasında da tutar. DB hatasında yerel
// bellek sayacı devrede kalır (koruma asla tamamen kapanmaz).

describe("rateLimit (DB-backed)", () => {
  beforeEach(async () => {
    __resetRateLimit();
    await prisma.rateLimitCounter.deleteMany();
    vi.restoreAllMocks();
  });

  it("allows up to the limit, then blocks with a retry-after", async () => {
    const key = "k";
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    }
    const blocked = await rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(61);
  });

  it("tracks keys independently", async () => {
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(true);
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(false);
    expect((await rateLimit("b", 1, 60_000)).ok).toBe(true); // different key unaffected
  });

  it("resets after the window elapses (expired row is reset in place)", async () => {
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(true);
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(false);
    // Deterministic expiry: force the window end into the past instead of sleeping.
    await prisma.rateLimitCounter.update({
      where: { key: "w" },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(true);
    const row = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { key: "w" } });
    expect(row.count).toBe(1); // fresh window, not a stale continuation
  });

  it("PARALEL isteklerde atomiktir: limit 5 iken 10 eşzamanlı istekten tam 5'i geçer", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rateLimit("burst", 5, 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const row = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { key: "burst" } });
    expect(row.count).toBe(10); // her hit sayıldı, karar count<=limit ile verildi
  });

  it("DB hatasında yerel bellek sayacına düşer — koruma tamamen kapanmaz", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    expect((await rateLimit("fb", 2, 60_000)).ok).toBe(true);
    expect((await rateLimit("fb", 2, 60_000)).ok).toBe(true);
    const blocked = await rateLimit("fb", 2, 60_000);
    expect(blocked.ok).toBe(false); // bellek fallback'i de sınırı uyguluyor
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("sweepExpiredRateLimits yalnız süresi geçmiş satırları siler", async () => {
    await prisma.rateLimitCounter.createMany({
      data: [
        { key: "old", count: 3, resetAt: new Date(Date.now() - 10 * 60_000) },
        { key: "live", count: 1, resetAt: new Date(Date.now() + 60_000) },
      ],
    });
    const swept = await sweepExpiredRateLimits();
    expect(swept).toBe(1);
    expect(await prisma.rateLimitCounter.findUnique({ where: { key: "old" } })).toBeNull();
    expect(await prisma.rateLimitCounter.findUnique({ where: { key: "live" } })).not.toBeNull();
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

  it("IGNORES x-real-ip by default when XFF is present — flipping authority needs live-header verification", () => {
    const req = new Request("http://x", {
      headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("5.6.7.8"); // today's behaviour pinned
  });

  it("prefers x-real-ip over XFF only when TRUST_X_REAL_IP=1 (verified Railway edge header)", () => {
    vi.stubEnv("TRUST_X_REAL_IP", "1");
    try {
      const req = new Request("http://x", {
        headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(clientIp(req)).toBe("7.7.7.7");
      // Absent/blank x-real-ip still falls back to the rightmost XFF hop.
      const noReal = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
      expect(clientIp(noReal)).toBe("5.6.7.8");
    } finally {
      vi.unstubAllEnvs();
    }
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
