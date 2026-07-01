import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// requireSession reads the cookie in production; mock it to our seeded user so we
// can drive the route handler directly.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/account/2fa/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/2fa", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U" };
  });

  it("rejects 'setup' when 2FA is already active — never silently disables it", async () => {
    // 2FA is live on this account.
    await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: encryptSecret("ABCDEFGHIJKLMNOP"), twoFactorEnabledAt: new Date() },
    });

    const res = await POST(req({ action: "setup" }));
    expect(res.status).toBe(400);

    // The enabled flag MUST survive: a session-only attacker can't re-key to disable 2FA.
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabledAt: true },
    });
    expect(u?.twoFactorEnabledAt).not.toBeNull();
  });

  it("allows 'setup' when 2FA is not yet active", async () => {
    const res = await POST(req({ action: "setup" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.secret).toBe("string");
    // Setup must not flip it on — only 'enable' (with a valid code) does that.
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabledAt: true },
    });
    expect(u?.twoFactorEnabledAt).toBeNull();
  });
});
