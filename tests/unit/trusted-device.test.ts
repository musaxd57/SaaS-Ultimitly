import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signTrustedDeviceToken, verifyTrustedDeviceToken } from "@/lib/auth/trusted-device";

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-please-32-bytes-minimum"));
afterEach(() => vi.unstubAllEnvs());

const EPOCH = 1_700_000_000_000; // a fixed 2FA-enabled timestamp

describe("trusted device token (fail-closed)", () => {
  it("verifies a token for the SAME user and SAME 2FA epoch", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH)).toBe(true);
  });

  it("rejects a token issued for a DIFFERENT user", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-2", EPOCH)).toBe(false);
  });

  it("rejects a token after the 2FA epoch changes (disable → re-enable)", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH + 1)).toBe(false);
  });

  it("rejects a missing or garbage token (never skips 2FA on error)", async () => {
    expect(await verifyTrustedDeviceToken(undefined, "user-1", EPOCH)).toBe(false);
    expect(await verifyTrustedDeviceToken("not-a-jwt", "user-1", EPOCH)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH);
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-key-32b");
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH)).toBe(false);
  });
});
