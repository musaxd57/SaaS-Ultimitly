import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { signSession, verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// M-2 DİLİM 2 — OTURUM ÜYELİKTEN (tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §3; Opus M4, M15).
// Gerçek imzalı çerezle (next/headers taklidi) hem API yolu (`requireSession`) hem sayfa yolu (`requireAuth`) sınanır.
// ---------------------------------------------------------------------------

const jar = vi.hoisted(() => ({ token: undefined as string | undefined, set: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (jar.token ? { value: jar.token } : undefined),
    set: (a: string | { name: string; value: string }, b?: string) => {
      const entry = typeof a === "string" ? { name: a, value: b ?? "" } : a;
      jar.set.push(entry);
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
import { setHomeMembershipRole } from "@/lib/membership/write";
import { NO_ACTIVE_MEMBERSHIP_TEXT } from "@/lib/membership/session";
import { POST as login } from "@/app/api/auth/login/route";
import { enterOrganization, exitImpersonation } from "@/lib/admin";
import { GET as health } from "@/app/api/health/route";
import { clearProbeCache } from "@/lib/health-probe";
import { __resetStrictQueueState } from "@/lib/outbox/health";
import { __resetStrictMembershipState } from "@/lib/membership/health";

async function seedOwner(email = "sahip-ms@example.test", password?: string) {
  const org = await prisma.organization.create({ data: { name: "Lale A" } });
  const user = await makeUser({
    data: {
      organizationId: org.id,
      name: "Sahip",
      email,
      passwordHash: password ? await bcrypt.hash(password, 4) : "x",
      role: "owner",
      emailVerifiedAt: new Date(),
    },
  });
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
  return { org, user, membership };
}

function baseSession(u: { id: string; email: string; name: string }, organizationId: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { userId: u.id, organizationId, role: "owner", email: u.email, name: u.name, sessionEpoch: 0, ...extra };
}
async function useToken(s: SessionPayload) {
  jar.token = await signSession(s);
}
/** Son yazılan OTURUM çerezinin iddiaları (giriş, tanınan cihaz çerezini de yazar — adla seçilir). */
async function lastWrittenSession(): Promise<SessionPayload | null> {
  const written = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE));
  return written ? verifySession(written.value) : null;
}

describe("M-2 dilim 2 — oturum üyelikten doğrulanır", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    jar.token = undefined;
    jar.set.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("eski (üyelik iddiasız) belirteç doldurulan üyelikle GEÇERLİ; rol üyelikten", async () => {
    const { org, user } = await seedOwner();
    await useToken(baseSession(user, org.id, { role: "staff" }));
    const s = await requireSession();
    expect(s?.organizationId).toBe(org.id);
    expect(s?.role).toBe("owner");
  });

  it("🚨 belirtecin işletmesinde üyelik YOKSA oturum geçersiz — ana işletmeye SESSİZCE taşınmaz (eski kod üstüne yazıyordu)", async () => {
    const { user } = await seedOwner();
    const other = await prisma.organization.create({ data: { name: "Başka işletme" } });
    await useToken(baseSession(user, other.id));
    expect(await requireSession()).toBeNull();
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("🚨 üyelik çıkarıldıysa (revoked) API 401, sayfa çıkışa", async () => {
    const { org, user, membership } = await seedOwner();
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "revoked", revokedAt: new Date() } });
    await useToken(baseSession(user, org.id));
    expect(await requireSession()).toBeNull();
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("🚨 rol değişince üyelik kuşağı artar: eski belirteç düşer, yeni kuşaklı belirteç geçer", async () => {
    const { org, user } = await seedOwner();
    await prisma.$transaction((tx) => setHomeMembershipRole(tx, user.id, org.id, "manager", "seed"));
    await useToken(baseSession(user, org.id, { membershipEpoch: 0 }));
    expect(await requireSession()).toBeNull();
    await useToken(baseSession(user, org.id, { role: "manager", membershipEpoch: 1 }));
    expect((await requireSession())?.role).toBe("manager");
  });

  it("🚨 belirteç BAŞKA bir üyelik kimliği taşıyorsa (yeniden alınmış üyelik — ABA) geçersiz", async () => {
    const { org, user } = await seedOwner();
    await useToken(baseSession(user, org.id, { membershipId: "mem_eski" }));
    expect(await requireSession()).toBeNull();
  });

  it("sayfa yolu B2: üyelik rolü belirteçteki rolden farklıysa çıkış; aynıysa geçer", async () => {
    const { org, user, membership } = await seedOwner();
    await useToken(baseSession(user, org.id, { role: "staff", membershipId: membership.id }));
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
    await useToken(baseSession(user, org.id, { role: "owner", membershipId: membership.id }));
    expect((await requireAuth()).organizationId).toBe(org.id);
  });

  it("🚨 giriş: oturum seçilen üyelikle basılır (işletme + üyelik kimliği + kuşak)", async () => {
    const { org, user, membership } = await seedOwner("giris-ms@example.test", "uzun-bir-sifre-123");
    const res = await login(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.70" },
        body: JSON.stringify({ email: "giris-ms@example.test", password: "uzun-bir-sifre-123" }),
      }),
    );
    expect(res.status).toBe(200);
    const s = await lastWrittenSession();
    expect(s).toMatchObject({ userId: user.id, organizationId: org.id, role: "owner", membershipId: membership.id, membershipEpoch: 0 });
  });

  it("🚨 giriş: hiç ETKİN üyeliği olmayan kişiye oturum BASILMAZ — sade metin (doğru şifreden sonra)", async () => {
    const { membership } = await seedOwner("cikmis-ms@example.test", "uzun-bir-sifre-123");
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "revoked" } });
    const res = await login(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.71" },
        body: JSON.stringify({ email: "cikmis-ms@example.test", password: "uzun-bir-sifre-123" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(NO_ACTIVE_MEMBERSHIP_TEXT);
    expect(jar.set.filter((c) => c.value && c.name.endsWith(SESSION_COOKIE))).toEqual([]);
  });

  it("🚨 bürünme: hedef işletmenin sahip ÜYELİĞİYLE girer; çıkışta operatör KENDİ üyeliğine döner", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "ops-ms@lixusai.com");
    const opOrg = await prisma.organization.create({ data: { name: "Operatör" } });
    const op = await makeUser({ data: { organizationId: opOrg.id, name: "Op", email: "ops-ms@lixusai.com", passwordHash: "x", role: "owner", twoFactorEnabledAt: new Date() } });
    const opMembership = await prisma.membership.findFirstOrThrow({ where: { userId: op.id } });
    const { org, user, membership } = await seedOwner();
    expect(await enterOrganization(baseSession(op, opOrg.id, { mfa: true }), org.id)).toBe(true);
    const entered = await lastWrittenSession();
    expect(entered).toMatchObject({ userId: user.id, organizationId: org.id, membershipId: membership.id, actorUserId: op.id });
    jar.token = await signSession(entered!);
    jar.set.length = 0;
    expect(await exitImpersonation()).toBe(true);
    expect(await lastWrittenSession()).toMatchObject({ userId: op.id, organizationId: opOrg.id, membershipId: opMembership.id });
  });

  it("bürünmeden çıkış: operatörün etkin üyeliği yoksa müşteri işletmesinde KALMAZ — oturum temizlenir", async () => {
    const opOrg = await prisma.organization.create({ data: { name: "Operatör" } });
    const op = await makeUser({ data: { organizationId: opOrg.id, name: "Op", email: "ops2-ms@lixusai.com", passwordHash: "x", role: "owner" } });
    await prisma.membership.updateMany({ where: { userId: op.id }, data: { status: "revoked" } });
    const { org, user } = await seedOwner();
    await useToken(baseSession(user, org.id, { actorUserId: op.id, actorEmail: op.email, actorName: "Op", actorSessionEpoch: 0 }));
    expect(await exitImpersonation()).toBe(false);
    expect(jar.set.filter((c) => c.name.endsWith(SESSION_COOKIE)).every((c) => c.value === "")).toBe(true);
  });

  it("🚨 sağlık (strict): HİÇ üyelik satırı olmayan kullanıcı varsa 503 users_without_membership; yalnız çıkarılmış üyeliği olan sayılmaz", async () => {
    // Taze zamanlayıcı nabzı (sağlık testleriyle aynı satır) — yoksa strict mod üyelik denetimine varmadan "sync_unknown" döner.
    await prisma.systemLock.create({ data: { name: "scheduled-sync", lockedUntil: new Date(0) } });
    clearProbeCache();
    __resetStrictQueueState();
    __resetStrictMembershipState();
    const { membership } = await seedOwner();
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "revoked" } });
    const before = await (await health(new NextRequest("http://localhost/api/health?strict=1"))).json();
    expect(before.membership).toBe("ok");
    const org = await prisma.organization.create({ data: { name: "Eski kod" } });
    await prisma.user.create({ data: { organizationId: org.id, name: "Üyeliksiz", email: "uyeliksiz@example.test", passwordHash: "x", role: "owner" } });
    clearProbeCache();
    // Üyelik yoklaması 30 sn önbellekli (Opus S2) → yeni satır önbellek süresi dolana kadar görünmez; testte süre beklenmez, sıfırlanır.
    __resetStrictMembershipState();
    const after = await health(new NextRequest("http://localhost/api/health?strict=1"));
    expect(after.status).toBe(503);
    expect(await after.json()).toMatchObject({ ok: false, membership: "missing", reason: "users_without_membership" });
  });

  it("migration 94: yalnız HİÇ üyeliği olmayan kullanıcıya üyelik yazar; çıkarılmış üyelik DİRİLMEZ; tekrar koşulabilir", async () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/94_membership_backfill_repeat/migration.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.toUpperCase().startsWith('INSERT INTO "MEMBERSHIP"'));
    expect(sql).toHaveLength(1);
    const { user: removed, membership } = await seedOwner("cikarilmis-ms@example.test");
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "revoked" } });
    const org = await prisma.organization.create({ data: { name: "Eski kod" } });
    const orphan = await prisma.user.create({ data: { organizationId: org.id, name: "Ü", email: "orphan-ms@example.test", passwordHash: "x", role: "staff" } });
    await prisma.$executeRawUnsafe(sql[0]!);
    await prisma.$executeRawUnsafe(sql[0]!);
    expect(await prisma.membership.findMany({ where: { userId: orphan.id }, select: { role: true, status: true, origin: true } })).toEqual([
      { role: "staff", status: "active", origin: "backfill" },
    ]);
    expect(await prisma.membership.findMany({ where: { userId: removed.id }, select: { status: true } })).toEqual([{ status: "revoked" }]);
  });
});
