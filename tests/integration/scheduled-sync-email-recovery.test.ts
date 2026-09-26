import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KİMLİK E-POSTASI KURTARMASI HER GEÇİŞTE (09-23, yapısal ajan — kodda doğrulandı)
//
// `sweepEmailOutbox` (süresi dolmuş sahiplenmeyi kurtarır) YALNIZ saatlik derin blokta
// koşuyordu; 15 sn'lik poller yalnız drain eder. Gönderim ortasında süreç düşerse
// (Railway deploy'u tam budur) `claimed` satır bir saate kadar askıda kalıyor, 10 dk
// ömürlü parola kodu kullanıcıya hiç ulaşmadan ölüyordu. Bu dosya DAR (derin olmayan)
// bir geçişte kurtarma + teslimi ölçer.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => null), // senkron erken döner; ölçülen şey e-posta bacağı
  isPrimaryOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { emailService } from "@/lib/email";
import { enqueueIdentityEmail } from "@/lib/email-outbox";
import { runScheduledSync } from "@/lib/scheduled-sync";

async function crashedClaim() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "U", email: "u@x.com", passwordHash: "x", role: "owner" },
  });
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { pwChangeCodeHash: "hash-of-code", pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 },
    });
    await enqueueIdentityEmail(tx, { userId: user.id, kind: "pw_change_code", secret: "12345678", recipient: user.email, expiresAt });
  });
  // Sahiplenen işçi gönderimden ÖNCE öldü: satır `claimed`, kira süresi dolmuş.
  await prisma.emailOutbox.updateMany({
    data: { status: "claimed", claimedBy: "dead-worker", claimExpiresAt: new Date(Date.now() - 1000) },
  });
}

describe("scheduled-sync — kimlik e-postası kurtarması derin pencere BEKLEMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it("🚨 DAR geçiş (derin pencere HENÜZ dolmadı) askıdaki sahiplenmeyi kurtarır ve e-postayı TESLİM eder", async () => {
    await crashedClaim();
    // Derin pencere bir saat sonra: bu geçiş DAR olmak zorunda.
    await prisma.systemLock.create({
      data: { name: "deep-sync-cadence", lockedUntil: new Date(Date.now() + 60 * 60_000) },
    });

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);

    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status, "askıdaki satır dar geçişte kurtarılmadı (eski davranış: bir saate kadar bekler)").toBe("sent");
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledOnce();
  });

  it("saklama SİLMESİ ise derin pencereye bağlı kalır (dar geçiş eski terminal satırı silmez)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u2@x.com", passwordHash: "x", role: "owner" },
    });
    await prisma.emailOutbox.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        userId: user.id,
        kind: "pw_change_code",
        version: 1,
        status: "sent",
        sentAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
        expiresAt: new Date(Date.now() - 29 * 24 * 60 * 60_000),
        nextAttemptAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
      },
    });
    await prisma.systemLock.create({
      data: { name: "deep-sync-cadence", lockedUntil: new Date(Date.now() + 60 * 60_000) },
    });
    await runScheduledSync();
    expect(await prisma.emailOutbox.count()).toBe(1); // dar geçiş silmedi

    await prisma.systemLock.update({ where: { name: "deep-sync-cadence" }, data: { lockedUntil: new Date(0) } });
    await runScheduledSync(); // derin geçiş
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});
