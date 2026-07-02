import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

// AUTH_SECRET is injected via vitest.config.ts (test.env).

const payload: SessionPayload = {
  userId: "u1",
  organizationId: "org1",
  role: "owner",
  email: "demo@guestops.ai",
  name: "Demo Sahibi",
  sessionEpoch: 0,
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

  it("carries a non-zero sessionEpoch through sign/verify", async () => {
    const token = await signSession({ ...payload, sessionEpoch: 7 });
    expect((await verifySession(token))?.sessionEpoch).toBe(7);
  });

  it("defaults a legacy token (no sessionEpoch claim) to epoch 0 — matches the DB default so the deploy that adds this never mass-logs-out", async () => {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const legacy = await new SignJWT({
      userId: "u1",
      organizationId: "org1",
      role: "owner",
      email: "demo@guestops.ai",
      name: "Demo Sahibi",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("14d")
      .sign(secret);
    const verified = await verifySession(legacy);
    expect(verified).not.toBeNull();
    expect(verified?.sessionEpoch).toBe(0);
  });
});
