import { describe, it, expect, vi, afterEach } from "vitest";
import { assertCriticalEnv, register } from "@/instrumentation";

// Boot-time fail-fast: production must refuse to start with a missing or
// placeholder AUTH_SECRET (forgeable sessions), and the assertion must run even
// when the internal cron is disabled (it sits BEFORE the early returns).

describe("assertCriticalEnv (production boot gate)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws when AUTH_SECRET is missing", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => assertCriticalEnv()).toThrow(/AUTH_SECRET/);
  });

  it("throws on the dev placeholder secret", () => {
    vi.stubEnv("AUTH_SECRET", "dev-secret-change-me-please-32-bytes-min");
    expect(() => assertCriticalEnv()).toThrow(/placeholder/);
  });

  it("passes with a real secret (short one only warns)", () => {
    vi.stubEnv("AUTH_SECRET", "a-real-production-secret-value-42-chars-xx");
    expect(() => assertCriticalEnv()).not.toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("AUTH_SECRET", "short-but-real-secret");
    expect(() => assertCriticalEnv()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("register() enforces it in production even when the internal cron is disabled", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERNAL_CRON_DISABLED", "1");
    vi.stubEnv("AUTH_SECRET", "");
    await expect(register()).rejects.toThrow(/AUTH_SECRET/);
    // ...and boots cleanly with a real secret (cron disabled → no timers started).
    vi.stubEnv("AUTH_SECRET", "a-real-production-secret-value-42-chars-xx");
    await expect(register()).resolves.toBeUndefined();
  });

  it("register() is a no-op outside production (dev boots without AUTH_SECRET)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SECRET", "");
    await expect(register()).resolves.toBeUndefined();
  });
});
