import { describe, it, expect } from "vitest";
import {
  hotp,
  totp,
  verifyTotp,
  verifyTotpStep,
  generateSecret,
  base32Encode,
  base32Decode,
} from "@/lib/auth/totp";

describe("TOTP / HOTP", () => {
  // RFC 4226 Appendix D reference vectors: secret = ASCII "12345678901234567890".
  const refSecret = Buffer.from("12345678901234567890", "ascii");
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  it("matches the RFC 4226 HOTP reference vectors", () => {
    for (let c = 0; c < expected.length; c++) {
      expect(hotp(refSecret, c)).toBe(expected[c]);
    }
  });

  it("base32 encode/decode roundtrips", () => {
    const buf = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it("totp produces the same code the verifier accepts", () => {
    const secret = generateSecret();
    const now = Date.now();
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, 1, now)).toBe(true);
  });

  it("accepts a code from the adjacent 30s window (clock skew)", () => {
    const secret = generateSecret();
    const now = Date.now();
    const prevWindowCode = totp(secret, now - 30_000);
    expect(verifyTotp(secret, prevWindowCode, 1, now)).toBe(true);
  });

  it("rejects a code from outside the allowed window", () => {
    const secret = generateSecret();
    const now = Date.now();
    const farCode = totp(secret, now - 5 * 60_000); // 5 min ago → out of ±1 window
    expect(verifyTotp(secret, farCode, 1, now)).toBe(false);
  });

  it("rejects a malformed code", () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, "12345")).toBe(false); // too short
    expect(verifyTotp(secret, "")).toBe(false);
  });

  it("ignores spaces/non-digits in the entered code", () => {
    const secret = generateSecret();
    const now = Date.now();
    const code = totp(secret, now);
    expect(verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, 1, now)).toBe(true);
  });

  it("verifyTotpStep returns the matched step (for replay protection) or null", () => {
    const secret = generateSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / 30);
    const code = totp(secret, now);
    // A valid code resolves to its time-step; a caller burns steps <= lastStep.
    expect(verifyTotpStep(secret, code, 1, now)).toBe(step);
    expect(verifyTotpStep(secret, "000000", 1, now)).toBeNull();
    // The previous window's code resolves to the earlier (smaller) step.
    const prev = totp(secret, now - 30_000);
    expect(verifyTotpStep(secret, prev, 1, now)).toBe(step - 1);
  });
});
