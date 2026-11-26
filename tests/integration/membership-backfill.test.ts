import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma, resetDb, makeUser } from "../helpers/db";
import {
  applyMembershipBackfill,
  membershipBackfillStatement,
  membershipGap,
  MEMBERSHIP_BACKFILL_MIGRATION,
} from "@/lib/membership/backfill-core";

// ---------------------------------------------------------------------------
// M-2 dilim 2 (Opus S5): strict sağlığın `users_without_membership` alarmının onarım çekirdeği (`scripts/membership-backfill.ts`).
// Salt-okuma önce (yazmaz), yazma yalnız bildirilen sayı BİREBİR verilince; ifade migration 94'ün aynısı (dosyadan, kopya yok);
// çıkarılmış üyelik dirilmez; tekrar koşulabilir.
// ---------------------------------------------------------------------------

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Lale" } });
  const member = await makeUser({ data: { organizationId: org.id, name: "Üye", email: "uye-bf@example.test", passwordHash: "x", role: "manager" } });
  const removed = await makeUser({ data: { organizationId: org.id, name: "Çıkan", email: "cikan-bf@example.test", passwordHash: "x", role: "staff" } });
  await prisma.membership.updateMany({ where: { userId: removed.id }, data: { status: "revoked", epoch: { increment: 1 } } });
  const oldOrg = await prisma.organization.create({ data: { name: "Eski kod" } });
  // Eski kodun açtığı hesaplar: kullanıcı satırı var, üyelik yok (tek yazıcıdan GEÇMEDEN — bilerek).
  const orphanA = await prisma.user.create({
    data: { organizationId: oldOrg.id, name: "A", email: "a-bf@example.test", passwordHash: "x", role: "owner", createdAt: new Date("2026-11-07T09:00:00Z") },
  });
  const orphanB = await prisma.user.create({
    data: { organizationId: oldOrg.id, name: "B", email: "b-bf@example.test", passwordHash: "x", role: "staff", createdAt: new Date("2026-11-07T09:05:00Z") },
  });
  return { org, member, removed, oldOrg, orphanA, orphanB };
}

const memberships = (userId: string) =>
  prisma.membership.findMany({ where: { userId }, select: { organizationId: true, role: true, status: true, origin: true }, orderBy: { createdAt: "asc" } });

describe("üyelik onarımı — salt-okuma önce, sayı onaylı yazma", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("salt-okuma: yalnız HİÇ üyelik satırı olmayanları sayar (çıkarılmış sayılmaz) ve HİÇBİR ŞEY yazmaz", async () => {
    await seed();
    const before = await prisma.membership.count();
    expect(await membershipGap(prisma)).toEqual({
      count: 2,
      oldestCreatedAt: new Date("2026-11-07T09:00:00Z"),
      newestCreatedAt: new Date("2026-11-07T09:05:00Z"),
    });
    expect(await prisma.membership.count()).toBe(before);
  });

  it("🚨 sayı değiştiyse (salt-okumadan sonra yeni hesap) HİÇBİR ŞEY yazmaz", async () => {
    const { orphanA } = await seed();
    const before = await prisma.membership.count();
    expect(await applyMembershipBackfill(prisma, 1)).toEqual({ ok: false, reason: "count_changed", expected: 1, actual: 2 });
    expect(await prisma.membership.count()).toBe(before);
    expect(await memberships(orphanA.id)).toEqual([]);
  });

  it("🚨 yazma: üyeliksizlere ana işletmede ETKİN üyelik (rol hesaptan); çıkarılmış üyelik DİRİLMEZ; tekrar koşmak hiçbir şey yazmaz", async () => {
    const { org, member, removed, oldOrg, orphanA, orphanB } = await seed();
    expect(await applyMembershipBackfill(prisma, 2)).toEqual({ ok: true, inserted: 2, remaining: 0 });
    expect(await memberships(orphanA.id)).toEqual([{ organizationId: oldOrg.id, role: "owner", status: "active", origin: "backfill" }]);
    expect(await memberships(orphanB.id)).toEqual([{ organizationId: oldOrg.id, role: "staff", status: "active", origin: "backfill" }]);
    expect(await memberships(removed.id)).toEqual([{ organizationId: org.id, role: "staff", status: "revoked", origin: "seed" }]);
    expect(await memberships(member.id)).toEqual([{ organizationId: org.id, role: "manager", status: "active", origin: "seed" }]);
    expect(await applyMembershipBackfill(prisma, 0)).toEqual({ ok: true, inserted: 0, remaining: 0 });
  });
});

describe("üyelik onarımı — ifade migration 94'ten (tek kaynak)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("migration dosyasındaki TEK INSERT ifadesi okunur", () => {
    expect(membershipBackfillStatement()).toMatch(/^INSERT INTO "Membership"[\s\S]*NOT EXISTS[\s\S]*ON CONFLICT DO NOTHING$/);
  });

  it("dosyada birden fazla ifade varsa (biri migration'a ikinci bir yazım eklediyse) betik KOŞMAZ — fırlatır", () => {
    dir = mkdtempSync(join(tmpdir(), "m2-backfill-"));
    const file = join(dir, MEMBERSHIP_BACKFILL_MIGRATION);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `-- yorum\nINSERT INTO "Membership" ("id") SELECT 'x';\nUPDATE "Membership" SET "status" = 'active';\n`);
    expect(() => membershipBackfillStatement(dir!)).toThrow(/tek bir INSERT/);
  });
});
