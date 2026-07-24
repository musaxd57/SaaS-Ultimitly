import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// The secret box protects each customer's Hospitable token at rest, so a
// roundtrip + tamper check is security-relevant.
describe("crypto secret box", () => {
  it("roundtrips a secret through encrypt → decrypt", () => {
    const plain = "hospitable_pat_abc123_çöğüş";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain); // ciphertext must not leak the plaintext
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("rejects a tampered payload", () => {
    const enc = encryptSecret("top-secret");
    const parts = enc.split(".");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3], "base64");
    data[0] = data[0] ^ 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a structurally invalid payload", () => {
    expect(() => decryptSecret("not-a-valid-box")).toThrow();
  });
});
