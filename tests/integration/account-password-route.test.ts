import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// requireSession reads the cookie in production; mock it to our seeded user.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// Capture the e-mailed verification code instead of actually sending mail.
let lastEmailHtml = "";
let emailOk = true;
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _subject: string, html: string) => {
      lastEmailHtml = html;
      return emailOk ? { ok: true } : { ok: false, error: "no mailer" };
    }),
  },
}));

import { POST } from "@/app/api/account/password/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function codeFromEmail(): string {
  const m = lastEmailHtml.match(/(\d{6})/);
  if (!m) throw new Error("no code in e-mail");
  return m[1];
}

describe("POST /api/account/password (e-mail code flow)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "old", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U" };
  });

  it("request e-mails a code and stores it hashed (never plaintext)", async () => {
    const res = await POST(req({ action: "request" }));
    expect(res.status).toBe(200);
    const code = codeFromEmail();
    expect(code).toMatch(/^\d{6}$/);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { pwChangeCodeHash: true, pwChangeCodeExpiresAt: true },
    });
    expect(u?.pwChangeCodeHash).toBeTruthy();
    expect(u?.pwChangeCodeHash).not.toBe(code); // stored hashed
    expect(u?.pwChangeCodeExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("confirm with the correct code sets the new password and burns the code", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();

    const res = await POST(req({ action: "confirm", code, newPassword: "brandnew123" }));
    expect(res.status).toBe(200);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, pwChangeCodeHash: true },
    });
    expect(await verifyPassword("brandnew123", u!.passwordHash)).toBe(true);
    expect(u?.pwChangeCodeHash).toBeNull(); // code burned after use
  });

  it("rejects a wrong code, increments attempts, and leaves the password unchanged", async () => {
    await POST(req({ action: "request" }));

    const res = await POST(req({ action: "confirm", code: "000000", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, pwChangeCodeAttempts: true },
    });
    expect(u?.passwordHash).toBe("old"); // unchanged
    expect(u?.pwChangeCodeAttempts).toBe(1);
  });

  it("rejects confirm when no code was requested", async () => {
    const res = await POST(req({ action: "confirm", code: "123456", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
    expect(u?.passwordHash).toBe("old");
  });

  it("rejects a too-short new password", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();
    const res = await POST(req({ action: "confirm", code, newPassword: "short" }));
    expect(res.status).toBe(400);
  });

  it("does not leave a dangling code if the e-mail could not be delivered", async () => {
    emailOk = false;
    const res = await POST(req({ action: "request" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { pwChangeCodeHash: true },
    });
    expect(u?.pwChangeCodeHash).toBeNull();
  });
});
