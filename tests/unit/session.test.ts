import { describe, it, expect } from "vitest";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

// AUTH_SECRET is injected via vitest.config.ts (test.env).

const payload: SessionPayload = {
  userId: "u1",
  organizationId: "org1",
  role: "owner",
  email: "demo@guestops.ai",
  name: "Demo Sahibi",
};

describe("session JWT", () => {
  it("round-trips a signed session", async () => {
    const token = await signSession(payload);
    expect(typeof token).toBe("string");

    const verified = await verifySession(token);
    expect(verified).toMatchObject(payload);
  });

  it("returns null for a missing token", async () => {
    expect(await verifySession(undefined)).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(payload);
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(await verifySession(tampered)).toBeNull();
  });
});
