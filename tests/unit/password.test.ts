import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("produces a bcrypt hash distinct from the plaintext", async () => {
    const hash = await hashPassword("demo1234");
    expect(hash).not.toBe("demo1234");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("demo1234");
    expect(await verifyPassword("demo1234", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("demo1234");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
