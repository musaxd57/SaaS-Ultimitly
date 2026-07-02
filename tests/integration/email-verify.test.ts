import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import {
  EMAIL_VERIFY_REQUIRED_FROM,
  needsEmailVerification,
  makeVerifyToken,
  hashVerifyToken,
} from "@/lib/auth/email-verify";

// setSessionCookie touches next/headers cookies() — unavailable outside a request
// scope in tests. Mock it (the existing login-route test does the same).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined) };
});

// Don't actually send mail; capture the HTML so we can pull the verify link.
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
import { emailService } from "@/lib/email";

import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as verifyEmail } from "@/app/api/auth/verify-email/route";

const mockSend = vi.mocked(emailService.send);

function postReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com" },
    body: JSON.stringify(body),
  });
}

const BEFORE = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() - 86_400_000); // pre-cutoff
const AFTER = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() + 86_400_000); // post-cutoff

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  process.env.REGISTRATION_OPEN = "1";
});
afterAll(async () => {
  delete process.env.REGISTRATION_OPEN;
  await prisma.$disconnect();
});

describe("email-verify helpers", () => {
  it("hash is deterministic; makeVerifyToken matches its hash", () => {
    const { raw, hash } = makeVerifyToken();
    expect(raw).toHaveLength(64);
    expect(hash).toBe(hashVerifyToken(raw));
  });

  it("gates ONLY post-cutoff unverified accounts (existing users exempt)", () => {
    expect(needsEmailVerification({ createdAt: BEFORE, emailVerifiedAt: null })).toBe(false);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: null })).toBe(true);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: new Date() })).toBe(false);
  });
});

describe("registration → verification → login", () => {
  it("registration creates an UNVERIFIED account, mails a link, returns verifyEmail (no auto-login)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ verifyEmail: true });
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).toBeTruthy();
    expect(u?.acceptedTermsAt).not.toBeNull(); // KVKK consent recorded
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("rejects registration without KVKK consent (400, no account created)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "noconsent@x.com",
        password: "secret123",
        // consent intentionally omitted
      }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: "noconsent@x.com" } })).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("clicking the e-mailed link verifies the account + clears the token", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    const html = String(mockSend.mock.calls[0][2]);
    const token = html.match(/token=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();

    const res = await verifyEmail(new NextRequest(`http://www.lixusai.com/api/auth/verify-email?token=${token}`));
    expect(res.status).toBe(307); // redirect
    expect(res.headers.get("location")).toContain("/dashboard");
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.emailVerifyTokenHash).toBeNull();
  });

  it("a NEW (post-cutoff) unverified account is BLOCKED from login (403), then allowed once verified", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "ada@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
      },
    });
    const blocked = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ needsVerification: true });

    await prisma.user.update({ where: { email: "ada@x.com" }, data: { emailVerifiedAt: new Date() } });
    const ok = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(ok.status).toBe(200);
  });

  it("an EXISTING (pre-cutoff) user logs in fine even if unverified — founder NOT locked out", async () => {
    const org = await prisma.organization.create({ data: { name: "Nuve" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Founder",
        email: "founder@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: BEFORE,
        emailVerifiedAt: null,
      },
    });
    const res = await login(postReq("http://localhost/api/auth/login", { email: "founder@x.com", password: "secret123" }));
    expect(res.status).toBe(200);
  });
});
