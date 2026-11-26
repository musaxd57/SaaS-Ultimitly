import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// M-2 ÜYELİK — DİLİM 1 (kurucu / Codex 11-06 K-2; tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §6.1–6.2).
// ① migration 93'ün GERÇEK doldurma SQL'i DOLU veritabanında (boş veritabanı "updatedAt NOT NULL" hatasını göstermezdi — Opus M10)
// ② tek yazıcı: kullanıcı + üyelik aynı işlemde; demo sınırı; rol zorunlu ③ bütün yaratma yolları üyelik yazar ④ geçici tek-üyelik bekçisi.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { createUserWithMembership, setHomeMembershipRole, MembershipInvariantError } from "@/lib/membership/write";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as createCustomer } from "@/app/api/admin/customers/route";
import { buildDemoDataset } from "@/lib/demo-tenant/dataset";
import { applyDemoTenant } from "@/lib/demo-tenant/apply-core";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

const SQL = readFileSync(join(process.cwd(), "prisma/migrations/93_membership/migration.sql"), "utf8");
const BACKFILL = SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.toUpperCase().startsWith('INSERT INTO "MEMBERSHIP"'));
const runBackfill = async () => {
  for (const s of BACKFILL) await prisma.$executeRawUnsafe(s);
};

async function rawUser(organizationId: string, id: string, role: string, createdAt: Date) {
  return prisma.user.create({ data: { id, organizationId, name: id, email: `${id}@example.test`, passwordHash: "x", role, createdAt } });
}

describe("M-2 dilim 1 — üyelik tablosu, doldurma, tek yazıcı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    session = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("migration dosyasında TEK doldurma cümlesi var ve 'updatedAt'i yazıyor", () => {
    expect(BACKFILL).toHaveLength(1);
    expect(BACKFILL[0]).toContain('"updatedAt"');
  });

  it("🚨 DOLU veritabanında doldurma: her kullanıcıya ana işletmesinde TEK etkin üyelik, rol aynen, kimlik belirlenimli, an = kullanıcının anı", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const t1 = new Date("2026-01-01T10:00:00Z");
    const t2 = new Date("2026-02-01T10:00:00Z");
    await rawUser(a.id, "u_owner", "owner", t1);
    await rawUser(a.id, "u_staff", "staff", t2);
    await rawUser(b.id, "u_mgr", "manager", t2);
    await runBackfill();
    const rows = await prisma.membership.findMany({ orderBy: { userId: "asc" } });
    expect(rows.map((r) => [r.userId, r.organizationId, r.role, r.status, r.epoch, r.origin, r.singleMembershipGuard])).toEqual([
      ["u_mgr", b.id, "manager", "active", 0, "backfill", "u_mgr"],
      ["u_owner", a.id, "owner", "active", 0, "backfill", "u_owner"],
      ["u_staff", a.id, "staff", "active", 0, "backfill", "u_staff"],
    ]);
    const owner = rows.find((r) => r.userId === "u_owner")!;
    expect(owner.id).toBe(`mem_${createHash("md5").update(`u_owner:${a.id}`).digest("hex")}`);
    expect(owner.createdAt.toISOString()).toBe(t1.toISOString());
  });

  it("doldurma tekrar koşulabilir: ikinci koşu ve yazıcının açtığı üyelik ÇİFT satır üretmez", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    await prisma.$transaction((tx) =>
      createUserWithMembership(tx, { organizationId: a.id, name: "Yeni", email: "yeni@example.test", passwordHash: "x", role: "owner" }, "signup"),
    );
    await rawUser(a.id, "u_eski", "staff", new Date("2026-01-01T00:00:00Z"));
    await runBackfill();
    await runBackfill();
    expect(await prisma.membership.count()).toBe(2);
    expect(await prisma.membership.count({ where: { origin: "signup" } })).toBe(1);
  });

  it("🚨 GEÇİCİ BEKÇİ: aynı kişiye ikinci işletmede üyelik veritabanında REDDEDİLİR (dilim 6c'ye kadar çok üyelik imkânsız)", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const u = await prisma.$transaction((tx) =>
      createUserWithMembership(tx, { organizationId: a.id, name: "Ayşe", email: "ayse@example.test", passwordHash: "x", role: "staff" }, "signup"),
    );
    await expect(
      prisma.membership.create({ data: { userId: u.id, organizationId: b.id, role: "staff", origin: "signup", singleMembershipGuard: u.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(1);
  });

  it("🚨 yazıcı ATOMİK: üyelik yazılamazsa kullanıcı da yaratılmaz", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const other = await rawUser(a.id, "u_var", "owner", new Date());
    // "u_yeni" kimliğini bekçide önceden işgal eden satır → yeni kullanıcının üyeliği çakışır.
    await prisma.membership.create({ data: { userId: other.id, organizationId: a.id, role: "owner", origin: "seed", singleMembershipGuard: "u_yeni" } });
    await expect(
      prisma.$transaction((tx) =>
        createUserWithMembership(tx, { id: "u_yeni", organizationId: a.id, name: "Y", email: "y@example.test", passwordHash: "x", role: "staff" }, "signup"),
      ),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.user.count({ where: { id: "u_yeni" } })).toBe(0);
  });

  it("🚨 demo sınırı: demo işletmesine demo dışı kimlik, demo kökenle demo dışı işletmeye üyelik YAZILMAZ; tanımsız rol yazılmaz", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
    const base = { name: "X", passwordHash: "x", role: "staff" as const };
    const attempt = (data: Parameters<typeof createUserWithMembership>[1], origin: Parameters<typeof createUserWithMembership>[2]) =>
      prisma.$transaction((tx) => createUserWithMembership(tx, data, origin));
    await expect(attempt({ ...base, organizationId: DEMO_ORG_ID, email: "d1@example.test" }, "signup")).rejects.toBeInstanceOf(MembershipInvariantError);
    await expect(attempt({ ...base, organizationId: a.id, email: "d2@example.test" }, "demo")).rejects.toBeInstanceOf(MembershipInvariantError);
    await expect(
      attempt({ ...base, role: "admin" as never, organizationId: a.id, email: "d3@example.test" }, "signup"),
    ).rejects.toMatchObject({ reason: "bad_role" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("🚨 kayıt rotası: sahip kullanıcı + ana işletme üyeliği (köken 'signup') aynı anda", async () => {
    vi.stubEnv("REGISTRATION_OPEN", "1");
    const res = await register(
      new NextRequest("https://www.lixusai.com/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", host: "www.lixusai.com" },
        body: JSON.stringify({ organizationName: "Lale Konaklama", name: "Lale Sahibi", email: "lale@example.com", password: "sifre12345", consent: true }),
      }),
    );
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "lale@example.com" } });
    expect(await prisma.membership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true, origin: true, status: true } })).toEqual([
      { organizationId: user.organizationId, role: "owner", origin: "signup", status: "active" },
    ]);
  });

  it("🚨 operatörün müşteri açması: sahip + üyelik (köken 'operator')", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@lixusai.com");
    const opOrg = await prisma.organization.create({ data: { name: "Operatör org" } });
    const op = await rawUser(opOrg.id, "u_op", "owner", new Date());
    await prisma.user.update({ where: { id: op.id }, data: { email: "operator@lixusai.com" } });
    session = { userId: op.id, organizationId: opOrg.id, role: "owner", email: "operator@lixusai.com", name: "Op", sessionEpoch: 0, mfa: true };
    const res = await createCustomer(
      new NextRequest("http://localhost/api/admin/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationName: "Lale Konaklama", name: "Lale Sahibi", email: "lale2@example.com", password: "uzun-bir-sifre-123" }),
      }),
    );
    expect(res.status).toBeLessThan(300);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "lale2@example.com" } });
    expect(await prisma.membership.findMany({ where: { userId: user.id }, select: { role: true, origin: true } })).toEqual([{ role: "owner", origin: "operator" }]);
  });

  it("🚨 demo kiracı: kullanıcılar demo üyeliğiyle açılır; yeniden kurulumda rol değişirse ayna + üyelik birlikte, kuşak artar; aynı rolde artmaz", async () => {
    const hash = bcrypt.hashSync("demo-sifre-uzun-ve-rastgele-xyz", 4);
    const ds = buildDemoDataset({ now: new Date() });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: hash, staffPasswordHash: hash });
    const members = await prisma.membership.findMany({ where: { organizationId: DEMO_ORG_ID }, orderBy: { userId: "asc" } });
    expect(members.map((m) => [m.userId, m.role, m.origin])).toEqual(
      [...ds.users].sort((x, y) => (x.id < y.id ? -1 : 1)).map((u) => [u.id, u.role, "demo"]),
    );
    // Aynı veri kümesiyle yeniden kurulum → kuşak değişmez.
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: hash });
    expect((await prisma.membership.findMany({ where: { organizationId: DEMO_ORG_ID } })).every((m) => m.epoch === 0)).toBe(true);
    // Rolü değişen kullanıcı → ayna + üyelik birlikte, kuşak +1.
    const changed = { ...ds, users: ds.users.map((u, i) => (i === 1 ? { ...u, role: "manager" as const } : u)) };
    await applyDemoTenant(prisma, changed, { reviewerPasswordHash: null, staffPasswordHash: hash });
    const target = ds.users[1]!;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("manager");
    expect(await prisma.membership.findFirstOrThrow({ where: { userId: target.id }, select: { role: true, epoch: true } })).toEqual({ role: "manager", epoch: 1 });
  });

  it("ana işletme rolü yazıcısı: kullanıcı o işletmede değilse HİÇBİR şey yazmaz; üyeliği eksikse (kayan dağıtım) yaratır", async () => {
    const a = await prisma.organization.create({ data: { name: "Lale A" } });
    const b = await prisma.organization.create({ data: { name: "Lale B" } });
    const u = await rawUser(a.id, "u_kayan", "staff", new Date());
    expect(await prisma.$transaction((tx) => setHomeMembershipRole(tx, u.id, b.id, "manager", "seed"))).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("staff");
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.$transaction((tx) => setHomeMembershipRole(tx, u.id, a.id, "manager", "seed"))).toBe(1);
    expect(await prisma.membership.findFirstOrThrow({ where: { userId: u.id }, select: { role: true, organizationId: true, singleMembershipGuard: true } })).toEqual({
      role: "manager",
      organizationId: a.id,
      singleMembershipGuard: u.id,
    });
  });
});
