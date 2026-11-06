import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { signSession, verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/session";
import { hashVerifyToken } from "@/lib/auth/email-verify";

// ---------------------------------------------------------------------------
// M-2 dilim 2 — Opus incelemesinin istediği pinler (S4, S9):
//  · işletme ÜSTÜNE YAZILMAZ: belirteç B, ana işletme A → oturum B (bekçi testte bilerek aşılır; üretim yazıcısı bekçiyi korur)
//  · giriş seçimi: son kullanılan etkin → ana etkin → en eski etkin → yok
//  · bürünme: çıkarılmış sahip seçilmez, etkin yönetici seçilir; hiç etkin üyelik yoksa giriş yok
//  · e-posta doğrulama: etkin üyelik yoksa oturum BASILMAZ, ayrı sebep kodu
//  · kabuk adı OTURUMUN işletmesinden; iddiasız eski belirteç doğrulanınca üyelik kimliği + kuşağı oturuma yazılır (S3 — yeniden imza yükseltir)
// ---------------------------------------------------------------------------

const jar = vi.hoisted(() => ({ token: undefined as string | undefined, set: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (jar.token ? { value: jar.token } : undefined),
    set: (a: string | { name: string; value: string }, b?: string) => {
      jar.set.push(typeof a === "string" ? { name: a, value: b ?? "" } : a);
    },
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { requireSession } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { pickLoginMembership } from "@/lib/membership/session";
import { enterOrganization, exitImpersonation } from "@/lib/admin";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import AppLayout from "@/app/(app)/layout";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as changePassword } from "@/app/api/account/password/route";
import { hashPassword } from "@/lib/auth/password";

/** Testte İKİNCİ üyelik: bekçi bilerek boş bırakılır (çok üyelik dilim 6c'ye kadar üretimde imkânsız). */
async function extraMembership(userId: string, organizationId: string, role: string, status = "active", createdAt?: Date) {
  return prisma.membership.create({
    data: { userId, organizationId, role, status, origin: "seed", singleMembershipGuard: null, ...(createdAt ? { createdAt } : {}) },
  });
}

describe("M-2 dilim 2 — pinler", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    jar.token = undefined;
    jar.set.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 işletme ÜSTÜNE YAZILMAZ: ana işletme A, belirteç B → API ve sayfa oturumu B'de, rol B'deki üyelikten", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const u = await makeUser({ data: { organizationId: a.id, name: "Ayşe", email: "ayse-pin@example.test", passwordHash: "x", role: "owner" } });
    const mb = await extraMembership(u.id, b.id, "staff");
    const token: SessionPayload = { userId: u.id, organizationId: b.id, role: "staff", email: u.email, name: u.name, sessionEpoch: 0, membershipId: mb.id, membershipEpoch: 0 };
    jar.token = await signSession(token);
    const api = await requireSession();
    expect(api).toMatchObject({ organizationId: b.id, role: "staff" });
    const page = await requireAuth();
    expect(page).toMatchObject({ organizationId: b.id, role: "staff" });
    // Düzen (sayfa kabuğu) da B'de: işletme adı oturumun üyeliğinden, ana işletmeden değil.
    const shell = (await AppLayout({ children: "x" })) as { props: { user: { orgName: string; role: string } } };
    expect(shell.props.user).toMatchObject({ orgName: "Lale B", role: "staff" });
  });

  it("🚨 iddiasız ESKİ belirteç: doğrulanınca üyelik kimliği + kuşağı oturuma yazılır → parola değişiminin yeniden imzası belirteci YÜKSELTİR", async () => {
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    const u = await makeUser({ data: { organizationId: org.id, name: "Ayşe", email: "ayse-eski@example.test", passwordHash: "x", role: "manager" } });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: u.id } });
    const legacy: SessionPayload = { userId: u.id, organizationId: org.id, role: "manager", email: u.email, name: u.name, sessionEpoch: 0 };
    jar.token = await signSession(legacy);
    expect(await requireSession()).toMatchObject({ membershipId: m.id, membershipEpoch: 0 });
    expect(await requireAuth()).toMatchObject({ membershipId: m.id, membershipEpoch: 0 });
    // Uçtan uca: parola değişimi oturumu `...session` ile yeniden imzalar (kod e-postası adımı atlanır — kod satıra doğrudan yazılır).
    await prisma.user.update({
      where: { id: u.id },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() + 600_000), pwChangeCodeAttempts: 0 },
    });
    jar.set.length = 0;
    const res = await changePassword(
      new NextRequest("http://www.lixusai.com/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm", code: "12345678", newPassword: "Lale-yeni-sifre-2026" }),
      }),
    );
    expect(res.status).toBe(200);
    const written = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!;
    expect(await verifySession(written.value)).toMatchObject({ userId: u.id, membershipId: m.id, membershipEpoch: 0, sessionEpoch: 1 });
  });

  it("giriş seçimi: son kullanılan ETKİN → ana ETKİN → en eski etkin → hiçbiri yoksa null", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const c = await prisma.organization.create({ data: { name: "Lale C" } });
    const u = await makeUser({ data: { organizationId: a.id, name: "Ayşe", email: "ayse-pick@example.test", passwordHash: "x", role: "staff" } });
    await extraMembership(u.id, b.id, "staff", "active", new Date("2020-01-01T00:00:00Z"));
    await extraMembership(u.id, c.id, "manager", "active", new Date("2021-01-01T00:00:00Z"));
    const pick = async () =>
      (await pickLoginMembership(prisma, (await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))))?.organizationId ?? null;
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveOrganizationId: c.id } });
    expect(await pick()).toBe(c.id);
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveOrganizationId: null } });
    expect(await pick()).toBe(a.id);
    await prisma.membership.updateMany({ where: { userId: u.id, organizationId: a.id }, data: { status: "revoked" } });
    expect(await pick()).toBe(b.id);
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveOrganizationId: c.id } });
    await prisma.membership.updateMany({ where: { userId: u.id, organizationId: c.id }, data: { status: "revoked" } });
    expect(await pick()).toBe(b.id);
    await prisma.membership.updateMany({ where: { userId: u.id }, data: { status: "revoked" } });
    expect(await pick()).toBeNull();
  });

  it("🚨 giriş: oturum son kullanılan işletmede (B) basılır, giriş KAYDI Ü-3 kararına kadar ANA işletmeye (A) — tek kural (Opus S8)", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const u = await makeUser({
      data: { organizationId: a.id, name: "Ayşe", email: "ayse-giris@example.test", passwordHash: await bcrypt.hash("secret123", 4), role: "owner", emailVerifiedAt: new Date() },
    });
    await extraMembership(u.id, b.id, "staff");
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveOrganizationId: b.id } });
    const res = await login(
      new NextRequest("http://www.lixusai.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ email: "ayse-giris@example.test", password: "secret123" }),
      }),
    );
    expect(res.status).toBe(200);
    const written = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!;
    expect(await verifySession(written.value)).toMatchObject({ organizationId: b.id, role: "staff" });
    expect(await prisma.auditLog.findMany({ where: { action: "auth.login_success" }, select: { organizationId: true } })).toEqual([{ organizationId: a.id }]);
  });

  it("🚨 bürünme: çıkarılmış sahip SEÇİLMEZ, etkin yönetici seçilir; hiç etkin üyelik yoksa giriş YOK", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "ops-pin@lixusai.com");
    const opOrg = await prisma.organization.create({ data: { name: "Operatör" } });
    const op = await makeUser({ data: { organizationId: opOrg.id, name: "Op", email: "ops-pin@lixusai.com", passwordHash: "x", role: "owner", twoFactorEnabledAt: new Date() } });
    const target = await prisma.organization.create({ data: { name: "Müşteri" } });
    const owner = await makeUser({ data: { organizationId: target.id, name: "Sahip", email: "sahip-pin@example.test", passwordHash: "x", role: "owner" } });
    const manager = await makeUser({ data: { organizationId: target.id, name: "Yönetici", email: "yon-pin@example.test", passwordHash: "x", role: "manager" } });
    await prisma.membership.updateMany({ where: { userId: owner.id }, data: { status: "revoked" } });
    const current: SessionPayload = { userId: op.id, organizationId: opOrg.id, role: "owner", email: op.email, name: "Op", sessionEpoch: 0, mfa: true };
    expect(await enterOrganization(current, target.id)).toBe(true);
    const written = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!;
    expect(await verifySession(written.value)).toMatchObject({ userId: manager.id, organizationId: target.id, role: "manager" });
    await prisma.membership.updateMany({ where: { organizationId: target.id }, data: { status: "revoked" } });
    jar.set.length = 0;
    expect(await enterOrganization(current, target.id)).toBe(false);
    expect(jar.set.filter((c) => c.value && c.name.endsWith(SESSION_COOKIE))).toEqual([]);
  });

  it("bürünmeden çıkış: operatör KENDİ son kullandığı ETKİN üyeliğine döner (son kullanılan → ana; Opus R7)", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "ops-cikis@lixusai.com");
    const opOrg = await prisma.organization.create({ data: { name: "Operatör" } });
    const other = await prisma.organization.create({ data: { name: "Operatör 2" } });
    const op = await makeUser({ data: { organizationId: opOrg.id, name: "Op", email: "ops-cikis@lixusai.com", passwordHash: "x", role: "owner", twoFactorEnabledAt: new Date() } });
    await extraMembership(op.id, other.id, "manager");
    await prisma.user.update({ where: { id: op.id }, data: { lastActiveOrganizationId: other.id } });
    const target = await prisma.organization.create({ data: { name: "Müşteri" } });
    await makeUser({ data: { organizationId: target.id, name: "Sahip", email: "sahip-cikis@example.test", passwordHash: "x", role: "owner" } });
    const current: SessionPayload = { userId: op.id, organizationId: opOrg.id, role: "owner", email: op.email, name: "Op", sessionEpoch: 0, mfa: true };
    expect(await enterOrganization(current, target.id)).toBe(true);
    jar.token = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!.value;
    jar.set.length = 0;
    expect(await exitImpersonation()).toBe(true);
    const back = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!;
    expect(await verifySession(back.value)).toMatchObject({ userId: op.id, organizationId: other.id, role: "manager" });
  });

  it("🚨 e-posta doğrulama: etkin üyelik yoksa hesap doğrulanır ama OTURUM BASILMAZ (ayrı sebep kodu)", async () => {
    const org = await prisma.organization.create({ data: { name: "Lale A" } });
    const token = "t".repeat(43);
    const u = await makeUser({
      data: {
        organizationId: org.id,
        name: "Yeni",
        email: "yeni-pin@example.test",
        passwordHash: await bcrypt.hash("secret123", 4),
        role: "owner",
        emailVerifyTokenHash: hashVerifyToken(token),
        emailVerifyExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.membership.updateMany({ where: { userId: u.id }, data: { status: "revoked" } });
    const res = await verifyEmail(
      new NextRequest("http://www.lixusai.com/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "secret123" }),
      }),
    );
    expect(await res.json()).toEqual({ ok: true, requiresLogin: true, reason: "no_membership" });
    expect(jar.set.filter((c) => c.value && c.name.endsWith(SESSION_COOKIE))).toEqual([]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).not.toBeNull();
  });
});
