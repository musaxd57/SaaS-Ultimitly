import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";

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
