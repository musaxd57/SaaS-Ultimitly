import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { sweepUnverifiedRegistrations, UNVERIFIED_MAX_AGE_DAYS } from "@/lib/unverified-sweep";

// ---------------------------------------------------------------------------
// U44 (Codex 10-07, 15c8663): DOĞRULANMAMIŞ HESAP SÜPÜRGESİ, ADAY SEÇİLDİKTEN SONRA ETKİNLEŞEN HESABI SİLMEZ — gerçek PostgreSQL.
//
// Süpürge adayı seçer, denetimlerini işlem DIŞINDA uzun bir partide yapar, sonra siler. Arada sahibi e-postasını doğrularsa (ya da
// parolasını sıfırlarsa) eski kod yine siliyordu. Araya girme: süpürgenin silmeden hemen önceki abonelik okumasının içinde kullanıcı
// gerçekten doğrulanır. Doğru sonuç: hesap YERİNDE, gerekçe `state_changed`. (Prisma temsilcisine `spyOn` sonraki testlere sızar →
// AYRI dosya.)
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-06T12:00:00Z");
const OLD = new Date(NOW.getTime() - (UNVERIFIED_MAX_AGE_DAYS + 1) * DAY);

async function seedAbandoned() {
  const org = await prisma.organization.create({ data: { name: "Terk", createdAt: OLD } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Terk", email: "terk@x.com", passwordHash: await hashPassword("secret123"), role: "owner", createdAt: OLD },
  });
  await prisma.subscription.create({ data: { organizationId: org.id, provider: "trial", planCode: "pro", status: "trialing" } });
  return { orgId: org.id, userId: user.id };
}

describe("U44 — süpürge ↔ araya giren doğrulama", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("UNVERIFIED_SWEEP_ENABLED", "1");
    vi.stubEnv("PRIMARY_ORG_ID", "org-baska-bir-sey");
    vi.stubEnv("UNVERIFIED_SWEEP_DRY_RUN", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 aday seçildi → sahibi e-postasını DOĞRULADI → silme işlemi hesabı SİLMEZ (state_changed)", async () => {
    const s = await seedAbandoned();
    const real = prisma.subscription.findUnique.bind(prisma.subscription);
    vi.spyOn(prisma.subscription, "findUnique").mockImplementationOnce((async (args: Parameters<typeof real>[0]) => {
      await prisma.user.update({ where: { id: s.userId }, data: { emailVerifiedAt: new Date() } });
      return real(args);
    }) as never);
    const res = await sweepUnverifiedRegistrations(NOW);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1); // ⬅️ ARIZADA silinmişti
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.state_changed).toBe(1);
  });

  it("🚨 aday seçildi → sahibi parolasını SIFIRLADI (sürüm arttı) → hesap SİLİNMEZ", async () => {
    const s = await seedAbandoned();
    const real = prisma.subscription.findUnique.bind(prisma.subscription);
    vi.spyOn(prisma.subscription, "findUnique").mockImplementationOnce((async (args: Parameters<typeof real>[0]) => {
      await prisma.user.update({ where: { id: s.userId }, data: { sessionEpoch: { increment: 1 } } });
      return real(args);
    }) as never);
    const res = await sweepUnverifiedRegistrations(NOW);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
    expect(res.skippedReasons.state_changed).toBe(1);
  });

  it("KONTROL: araya bir şey girmezse terk edilmiş kayıt silinir", async () => {
    const s = await seedAbandoned();
    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(0);
  });
});
