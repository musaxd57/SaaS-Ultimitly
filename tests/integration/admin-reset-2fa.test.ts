import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Operator 2FA reset — the lost-phone-AND-no-recovery-codes escape hatch.
// Must be superadmin-only, wipe secret + recovery codes together, and bump
// sessionEpoch so every live session of the downgraded account dies.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/admin/reset-2fa/route";

const OPERATOR_EMAIL = "operator@lixusai.com";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/reset-2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// A REAL operator user row — AuditLog.actorUserId is a FK, so a fabricated id
// would silently drop the audit write (writeAudit never throws).
async function makeOperatorSession(email: string): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: `Op Org ${email}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Op", email, passwordHash: "x", role: "owner" },
  });
  return { userId: user.id, organizationId: org.id, role: "owner", email, name: "Op", sessionEpoch: 0 };
}

async function seedLockedUser() {
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Kilitli Müşteri",
      email: "kilitli@example.com",
      passwordHash: "x",
      role: "owner",
      twoFactorSecret: "encrypted-secret",
      twoFactorEnabledAt: new Date(),
      twoFactorLastStep: 123,
      sessionEpoch: 3,
    },
  });
  await prisma.twoFactorRecoveryCode.createMany({
    data: [
      { userId: user.id, codeHash: "hash-1" },
      { userId: user.id, codeHash: "hash-2" },
    ],
  });
  return user;
}

describe("POST /api/admin/reset-2fa — operator escape hatch", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects non-operators (a customer owner is NOT enough) and changes nothing", async () => {
    const user = await seedLockedUser();
    session = { userId: "u", organizationId: "org", role: "owner", email: "customer@example.com", name: "U", sessionEpoch: 0 };
    const res = await POST(req({ email: user.email }));
    expect(res.status).toBe(401);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.twoFactorEnabledAt).toBeInstanceOf(Date);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })).toBe(2);
  });

  it("operator reset: clears secret + recovery codes, bumps sessionEpoch, writes audit", async () => {
    const user = await seedLockedUser();
    session = await makeOperatorSession(OPERATOR_EMAIL);
    const res = await POST(req({ email: "KILITLI@example.com" })); // case-insensitive match
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.twoFactorSecret).toBeNull();
    expect(after.twoFactorEnabledAt).toBeNull();
    expect(after.twoFactorLastStep).toBeNull();
    expect(after.sessionEpoch).toBe(4); // old sessions die with the old factor
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "admin.2fa_reset" } });
    expect(audit?.organizationId).toBe(user.organizationId);
  });

  it("unknown e-mail and already-off 2FA are clear field errors (no silent no-op)", async () => {
    session = await makeOperatorSession(OPERATOR_EMAIL);
    expect((await POST(req({ email: "yok@example.com" }))).status).toBe(400);

    const org = await prisma.organization.create({ data: { name: "O2" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "N", email: "no2fa@example.com", passwordHash: "x", role: "owner" },
    });
    const res = await POST(req({ email: "no2fa@example.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.email).toContain("zaten kapalı");
  });
});
