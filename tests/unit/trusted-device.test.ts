import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signTrustedDeviceToken, verifyTrustedDeviceToken } from "@/lib/auth/trusted-device";

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-please-32-bytes-minimum"));
afterEach(() => vi.unstubAllEnvs());

describe("trusted device token (fail-closed)", () => {
  it("verifies a token for the SAME user", async () => {
    const token = await signTrustedDeviceToken("user-1");
    expect(await verifyTrustedDeviceToken(token, "user-1")).toBe(true);
  });

  it("rejects a token issued for a DIFFERENT user", async () => {
    const token = await signTrustedDeviceToken("user-1");
    expect(await verifyTrustedDeviceToken(token, "user-2")).toBe(false);
  });

  it("rejects a missing or garbage token (never skips 2FA on error)", async () => {
    expect(await verifyTrustedDeviceToken(undefined, "user-1")).toBe(false);
    expect(await verifyTrustedDeviceToken("not-a-jwt", "user-1")).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signTrustedDeviceToken("user-1");
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-key-32b");
    expect(await verifyTrustedDeviceToken(token, "user-1")).toBe(false);
  });
});
