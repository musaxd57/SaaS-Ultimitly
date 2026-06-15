import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// Avoid touching the real cookie store on the success path (not exercised here).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined) };
});

import { POST } from "@/app/api/auth/login/route";

function loginReq(body: unknown, ip = "1.1.1.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Musa",
        email: "musa@example.com",
        passwordHash: await hashPassword("correct-horse"),
        role: "owner",
        emailVerifiedAt: new Date(), // not testing the verify gate here
      },
    });
  });

  it("rejects wrong credentials with 401", async () => {
    const res = await POST(loginReq({ email: "musa@example.com", password: "nope" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await POST(loginReq({ email: "not-an-email", password: "" }));
    expect(res.status).toBe(400);
  });

  it("rate-limits after 10 attempts from the same IP (429 + Retry-After)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "9.9.9.9"));
      expect(r.status).toBe(401);
    }
    const blocked = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "9.9.9.9"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("limits each IP independently", async () => {
    for (let i = 0; i < 11; i++) {
      await POST(loginReq({ email: "musa@example.com", password: "nope" }, "2.2.2.2"));
    }
    // A fresh IP is still allowed (gets 401, not 429).
    const other = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "3.3.3.3"));
    expect(other.status).toBe(401);
  });
});

// 2FA verification + replay protection at the ROUTE level (not just the totp lib).
// Guards the documented Round-1 fix: a used TOTP step can't be replayed.
describe("POST /api/auth/login — 2FA + TOTP replay", () => {
  const email = "tf@example.com";
  let secret: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    secret = generateSecret();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "TF",
        email,
        passwordHash: await hashPassword("correct-horse"),
        role: "owner",
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date(),
        emailVerifiedAt: new Date(), // not testing the verify gate here
      },
    });
  });

  it("withholds the session and asks for a code when 2FA is on and no code is given", async () => {
    const res = await POST(loginReq({ email, password: "correct-horse" }, "5.0.0.1"));
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRequired).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const res = await POST(loginReq({ email, password: "correct-horse", code: "000000" }, "5.0.0.2"));
    expect(res.status).toBe(401);
  });

  it("accepts a valid code, records the step, and REJECTS replay of the same code", async () => {
    const code = totp(secret);
    const ok = await POST(loginReq({ email, password: "correct-horse", code }, "5.0.0.3"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    const u = await prisma.user.findUnique({ where: { email }, select: { twoFactorLastStep: true } });
    expect(u?.twoFactorLastStep).not.toBeNull();

    // Same code again → replay blocked (step <= twoFactorLastStep).
    const replay = await POST(loginReq({ email, password: "correct-horse", code }, "5.0.0.4"));
    expect(replay.status).toBe(401);
  });
});
