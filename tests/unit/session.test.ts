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

  it("carries the operator's actorSessionEpoch through an impersonation session", async () => {
    const token = await signSession({
      ...payload,
      email: "customer@client.com",
      organizationId: "org2",
      actorUserId: "operator1",
      actorEmail: "operator@example.com",
      actorName: "Operator",
      actorSessionEpoch: 3,
    });
    const verified = await verifySession(token);
    expect(verified?.actorUserId).toBe("operator1");
    expect(verified?.actorSessionEpoch).toBe(3); // used to kill a stolen impersonation token on operator reset
  });

  it("leaves actorSessionEpoch undefined on a session that isn't impersonating (guard skips the actor check)", async () => {
    const verified = await verifySession(await signSession(payload));
    expect(verified?.actorSessionEpoch).toBeUndefined();
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
