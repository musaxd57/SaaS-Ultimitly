import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { totp, verifyTotpStep } from "@/lib/auth/totp";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// U11 (kurucu 10-22: "Dediğin gibi olabilir") — 2FA AÇIKSA hesap silme doğrulama KODU da ister.
// Eskiden yalnız şifre yetiyordu: şifresi sızmış 2FA'lı hesap, ele geçirilmiş oturumla kalıcı silinebiliyordu. Kod tüketilir (aynı
// kod ikinci kez geçmez), hata ortak günlük tavana sayılır, sır çözülemezse silme YOK. 2FA kapalı hesapta davranış aynı (yalnız şifre).
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: vi.fn(async () => currentSession),
    clearSessionCookie: vi.fn(async () => {}),
  };
});

import { POST } from "@/app/api/account/delete/route";

const PASSWORD = "correct-horse";
const SECRET = "JBSWY3DPEHPK3PXP";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

async function seed(twoFactor: { secret: string | null } | null) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Owner",
      email: "owner@example.com",
      passwordHash: await hashPassword(PASSWORD),
      role: "owner",
      emailVerifiedAt: new Date(),
      ...(twoFactor ? { twoFactorSecret: twoFactor.secret, twoFactorEnabledAt: new Date() } : {}),
    },
  });
  currentSession = {
    userId: user.id,
    organizationId: org.id,
    role: "owner",
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
  } as SessionPayload;
  return { orgId: org.id, userId: user.id };
}

const orgExists = async (id: string) => (await prisma.organization.count({ where: { id } })) === 1;
const reauthFailures = (orgId: string) =>
  prisma.auditLog.count({ where: { organizationId: orgId, action: "account.reauth_failed" } });

describe("U11 — 2FA açıkken hesap silme kod ister", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
  });

  it("doğru şifre ama kod YOK → 400 (alan: code), hesap durur", async () => {
    const { orgId } = await seed({ secret: encryptSecret(SECRET) });
    const res = await POST(req({ password: PASSWORD }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.code).toMatch(/kodu girin/);
    expect(await orgExists(orgId)).toBe(true);
  });

  it("yanlış kod → 400, hesap durur, ortak tavana bir hata yazılır", async () => {
    const { orgId } = await seed({ secret: encryptSecret(SECRET) });
    const wrong = totp(SECRET) === "000000" ? "111111" : "000000";
    const res = await POST(req({ password: PASSWORD, code: wrong }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.code).toMatch(/hatalı/);
    expect(await orgExists(orgId)).toBe(true);
    expect(await reauthFailures(orgId)).toBe(1);
  });

  it("doğru kod (boşluklu yazılsa da) → silinir", async () => {
    const { orgId } = await seed({ secret: encryptSecret(SECRET) });
    const code = totp(SECRET);
    const res = await POST(req({ password: PASSWORD, code: `${code.slice(0, 3)} ${code.slice(3)}` }));
    expect(res.status).toBe(200);
    expect(await orgExists(orgId)).toBe(false);
  });

  it("aynı kod daha önce kullanıldıysa (adım tüketilmiş) → 400, hesap durur", async () => {
    const { orgId, userId } = await seed({ secret: encryptSecret(SECRET) });
    const code = totp(SECRET);
    await prisma.user.update({ where: { id: userId }, data: { twoFactorLastStep: verifyTotpStep(SECRET, code)! } });
    const res = await POST(req({ password: PASSWORD, code }));
    expect(res.status).toBe(400);
    expect(await orgExists(orgId)).toBe(true);
  });

  it("sır çözülemiyor → silme YOK (güvenli taraf)", async () => {
    const { orgId } = await seed({ secret: "v1.bozuk.bozuk.bozuk" });
    const res = await POST(req({ password: PASSWORD, code: "123456" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.code).toMatch(/okunamıyor/);
    expect(await orgExists(orgId)).toBe(true);
  });

  it("şifre yanlışsa kod hiç denenmez (adım tüketilmez)", async () => {
    const { userId } = await seed({ secret: encryptSecret(SECRET) });
    const res = await POST(req({ password: "yanlis-sifre", code: totp(SECRET) }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.password).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorLastStep).toBeNull();
  });

  it("2FA KAPALI hesap: eskisi gibi yalnız şifre yeter", async () => {
    const { orgId } = await seed(null);
    const res = await POST(req({ password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await orgExists(orgId)).toBe(false);
  });
});
