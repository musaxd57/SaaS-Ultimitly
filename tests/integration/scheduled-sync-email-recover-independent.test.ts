import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// K27-K7 (Codex 11-25): SENKRON GEÇİŞİNDE KURTARMA HATASI NORMAL GÖNDERİMİ ATLATMAZ.
//
// `runScheduledSync` kimlik e-postası kurtarmasını ve gönderimini AYNI try içinde çağırıyordu: kurtarma fırlarsa o tur bekleyen şifre
// sıfırlama / doğrulama e-postası da gönderilmiyordu (yalnız harici cron'la çalışan kurulumda tek gönderim yolu budur). Artık ikisi bağımsız;
// alarm anahtarı ve konusu aynı kalır.
// `vi.mock` dosya geneline taşınır → AYRI dosya.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => null),
  isPrimaryOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
const recoverFault = vi.hoisted(() => ({ on: false, calls: 0 }));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return {
    ...actual,
    recoverEmailOutbox: vi.fn(async (now?: Date) => {
      recoverFault.calls += 1;
      if (recoverFault.on) throw new Error("recover read failed");
      return actual.recoverEmailOutbox(now);
    }),
  };
});

import { emailService } from "@/lib/email";
import { enqueueIdentityEmail } from "@/lib/email-outbox";
import { runScheduledSync } from "@/lib/scheduled-sync";

async function pendingResetMail() {
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
}

describe("scheduled-sync — kimlik e-postası kurtarması ile gönderimi bağımsız", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    recoverFault.on = false;
    recoverFault.calls = 0;
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it("🚨 kurtarma fırlar → bekleyen e-posta YİNE o geçişte gönderilir", async () => {
    await pendingResetMail();
    recoverFault.on = true;

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);
    expect(recoverFault.calls, "kurtarma gerçekten çağrıldı ve fırladı").toBeGreaterThan(0);

    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status, "kurtarma hatası normal gönderimi atlattı").toBe("sent");
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledOnce();
  });

  it("KONTROL: kurtarma sağlamken de gönderilir", async () => {
    await pendingResetMail();
    await runScheduledSync();
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("sent");
  });
});
