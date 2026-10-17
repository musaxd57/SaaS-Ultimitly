import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// 15 ajan A02 F3 (10-01): müşterinin CANLI 2FA'sını kaldırma kaydı işlemden SONRA, hatayı yutan `writeAudit` ile yazılıyordu →
// veritabanı sarsıntısında 2FA İZSİZ kalkabiliyordu. Kayıt artık AYNI işlemde ve zorunlu: yazılamazsa sıfırlama da olmaz.
// Kayıt arızası `writeAuditInTx` sahtesiyle üretilir (Prisma ajanı sonraki testlere sızmasın diye AYRI dosya).
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { auditFails } = vi.hoisted(() => ({ auditFails: { on: false } }));
vi.mock("@/lib/audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/audit")>();
  return {
    ...actual,
    writeAuditInTx: vi.fn(async (...args: Parameters<typeof actual.writeAuditInTx>) => {
      if (auditFails.on) throw new Error("audit write failed");
      return actual.writeAuditInTx(...args);
    }),
  };
});

import { POST } from "@/app/api/admin/reset-2fa/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/reset-2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function seed() {
  const opOrg = await prisma.organization.create({ data: { name: "Op Org" } });
  const op = await prisma.user.create({
    data: { organizationId: opOrg.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" },
  });
  session = { userId: op.id, organizationId: opOrg.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa: true };
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Kilitli",
      email: "kilitli@example.com",
      passwordHash: "x",
      role: "owner",
      twoFactorSecret: "encrypted-secret",
      twoFactorEnabledAt: new Date(),
      sessionEpoch: 3,
    },
  });
  await prisma.twoFactorRecoveryCode.create({ data: { userId: user.id, codeHash: "hash-1" } });
  return user;
}

describe("2FA sıfırlama — denetim kaydı zorunlu ve aynı işlemde", () => {
  beforeEach(async () => {
    await resetDb();
    auditFails.on = false;
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kayıt yazılamazsa 2FA KALKMAZ: secret, kurtarma kodları ve oturum dönemi aynen kalır, başarı dönmez", async () => {
    const user = await seed();
    auditFails.on = true;
    const res = await POST(req({ email: "kilitli@example.com" }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.twoFactorEnabledAt).not.toBeNull();
    expect(after.twoFactorSecret).toBe("encrypted-secret");
    expect(after.sessionEpoch).toBe(3);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "admin.2fa_reset" } })).toBe(0);
  });

  it("KONTROL: kayıt yazılınca sıfırlama ve kayıt birlikte gerçekleşir", async () => {
    const user = await seed();
    const res = await POST(req({ email: "kilitli@example.com" }));
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.twoFactorEnabledAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "admin.2fa_reset", organizationId: user.organizationId } })).toBe(1);
  });
});
