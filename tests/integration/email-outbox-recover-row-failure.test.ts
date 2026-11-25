import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// K27-K7 (Codex 11-25): KİMLİK E-POSTASI KURTARMASINDA TEK SATIRIN HATASI SONRAKİLERİ KESMEZ.
//
// `recoverEmailOutbox` askıdaki (`claimed` / `sending`, kira süresi dolmuş) satırları sırayla kendi işlemlerinde geri alır. Eskiden döngüde
// satır başına yakalama yoktu: İLK satırın geçici işlem hatası (kilit zaman aşımı, bağlantı kopması) fırlayıp sağlıklı ikinci satırın
// kurtarılmasını kesiyordu — 10 dk ömürlü şifre kodu kullanıcıya hiç ulaşmadan ölebilirdi. Ayrıca okuma SIRASIZDI.
//
// Prisma istemcisine casus → AYRI dosya, dosya düzeyinde TEK casus, GERİ ALINMAZ (CLAUDE.md: geri alınan casus istemciyi bozuk bırakıyor).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const fault = vi.hoisted(() => ({ failNextTx: false, failed: 0 }));

import { reportError } from "@/lib/report-error";
import { enqueueIdentityEmail, recoverEmailOutbox } from "@/lib/email-outbox";

const realTransaction = prisma.$transaction.bind(prisma);
vi.spyOn(prisma, "$transaction").mockImplementation(((...args: Parameters<typeof realTransaction>) => {
  if (fault.failNextTx) {
    fault.failNextTx = false;
    fault.failed += 1;
    return Promise.reject(new Error("transient tx failure"));
  }
  return realTransaction(...args);
}) as never);

async function stuckRow(email: string) {
  const org = await prisma.organization.create({ data: { name: `Org ${email}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "U", email, passwordHash: "x", role: "owner" },
  });
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { pwChangeCodeHash: "hash-of-code", pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 },
    });
    await enqueueIdentityEmail(tx, { userId: user.id, kind: "pw_change_code", secret: "12345678", recipient: email, expiresAt });
  });
  // Sahiplenen işçi gönderimden ÖNCE öldü: satır `claimed`, kira süresi dolmuş.
  await prisma.emailOutbox.updateMany({
    where: { userId: user.id },
    data: { status: "claimed", claimedBy: "dead-worker", claimExpiresAt: new Date(Date.now() - 1000) },
  });
  return user.id;
}

describe("recoverEmailOutbox — satır hatası satırda kalır, sıra belirli", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(reportError).mockClear();
    fault.failNextTx = false;
    fault.failed = 0;
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 en eski satırın işlemi geçici hata verir → sonraki sağlıklı satır YİNE kurtarılır, hata raporlanır, hatalı satır yerinde kalır", async () => {
    const newer = await stuckRow("a@x.com");
    const older = await stuckRow("b@x.com");
    // `older` satır eklendiği sırada SONRA geldi ama daha eski: kurtarma sırası ekleme / fiziksel sıraya değil yaşa (+ kimlik) bakmalı.
    await prisma.emailOutbox.updateMany({ where: { userId: older }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

    fault.failNextTx = true;
    const out = await recoverEmailOutbox();

    expect(fault.failed, "hata enjeksiyonu gerçekten çalıştı").toBe(1);
    expect(out.recovered, "ilk satırın hatası ikinci satırın kurtarılmasını kesti").toBe(1);
    const olderRow = await prisma.emailOutbox.findFirstOrThrow({ where: { userId: older } });
    const newerRow = await prisma.emailOutbox.findFirstOrThrow({ where: { userId: newer } });
    expect(olderRow.status, "sıra yaşa göre: ilk işlenen (ve hata alan) en eski satır").toBe("claimed");
    expect(newerRow.status).toBe("pending");
    expect(newerRow.attemptCount, "gönderimden önce ölen sahiplenme deneme harcamaz").toBe(0);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith("email-outbox.recover-row", expect.any(Error));

    // Sonraki geçiş hatalı satırı da geri alır (kalıcı kayıp yok).
    const again = await recoverEmailOutbox();
    expect(again.recovered).toBe(1);
    expect((await prisma.emailOutbox.findFirstOrThrow({ where: { userId: older } })).status).toBe("pending");
  });

  it("KONTROL: hata yokken iki satır da kurtarılır, rapor yok", async () => {
    await stuckRow("a@x.com");
    await stuckRow("b@x.com");
    const out = await recoverEmailOutbox();
    expect(out.recovered).toBe(2);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });
});
