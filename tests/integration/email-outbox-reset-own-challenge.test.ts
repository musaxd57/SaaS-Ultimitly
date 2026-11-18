import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { enqueueIdentityEmail, drainEmailOutboxOnce } from "@/lib/email-outbox";
import { issueChallenge, hashChallengeToken } from "@/lib/auth/password-reset-challenge";

// ---------------------------------------------------------------------------
// F3 (Codex 11-17) — SIFIRLAMA E-POSTASININ CANLILIK KAPISI SATIRIN KENDİ CHALLENGE'INA BAKAR. Gerçek PostgreSQL.
//
// Kapı kullanıcının HERHANGİ bir canlı challenge'ını yeterli sayıyordu. Yeni sıfırlama isteğinin challenge'ı kuyruk satırından ÖNCE ve
// ayrı yazıldığı için, o aradaki milisaniyelerde iptal edilmiş ESKİ satırın kapısı YENİ challenge'ı görüp ölü bağlantılı bir e-posta
// gönderiyordu. Test o ara durumu doğrudan kurar: A satırı kuyrukta, A'nın challenge'ı iptal, B'nin challenge'ı canlı ama B satırı yok.
// ---------------------------------------------------------------------------

type SendFn = (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;

let userId = "";
const EMAIL = "u@x.com";

async function enqueueChallengeRow(token: string, code: string, expiresAt: Date) {
  await prisma.$transaction((tx) =>
    enqueueIdentityEmail(tx, { userId, kind: "pw_reset_challenge", secret: `${token}.${code}`, recipient: EMAIL, expiresAt }),
  );
}
const invalidate = (token: string) =>
  prisma.passwordResetChallenge.update({ where: { tokenHash: hashChallengeToken(token) }, data: { invalidatedAt: new Date() } });

describe("email-outbox — sıfırlama satırı kendi challenge'ıyla sınanır (F3)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Outbox Org" } });
    userId = (await prisma.user.create({ data: { organizationId: org.id, name: "U", email: EMAIL, passwordHash: "x", role: "owner" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 A'nın challenge'ı iptal, B'nin challenge'ı canlı (B satırı henüz yok): A GÖNDERİLMEZ, iptal edilir", async () => {
    const a = await issueChallenge(prisma, userId);
    await enqueueChallengeRow(a.token, a.code, a.expiresAt);
    await invalidate(a.token);
    await issueChallenge(prisma, userId); // B — kuyruk satırı yazılmadan önceki an
    const send = vi.fn<SendFn>(async () => ({ ok: true }));
    await drainEmailOutboxOnce({ send });
    expect(send, "ölü bağlantılı sıfırlama e-postası gönderildi").not.toHaveBeenCalled();
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("canceled");
  });

  it("🚨 gönderim başarısız olurken A iptal edilip B açıldıysa: A yeniden denemeye (pending) DÖNMEZ, iptal edilir", async () => {
    const a = await issueChallenge(prisma, userId);
    await enqueueChallengeRow(a.token, a.code, a.expiresAt);
    const send = vi.fn<SendFn>(async () => {
      await invalidate(a.token);
      await issueChallenge(prisma, userId);
      return { ok: false, error: "provider down" };
    });
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("canceled");
  });

  it("KONTROL — A'nın challenge'ı canlıyken (başka canlı challenge olsa da) A gönderilir ve bağlantısı A'nın token'ını taşır", async () => {
    const a = await issueChallenge(prisma, userId);
    await enqueueChallengeRow(a.token, a.code, a.expiresAt);
    await issueChallenge(prisma, userId); // canlı ikinci challenge (önceki canlılar iptal edilmez — 08-02 kararı)
    const send = vi.fn<SendFn>(async () => ({ ok: true }));
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toContain(a.token);
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("sent");
  });

  it("KONTROL — yeni satır (B) yazılınca A iptal edilir ve YALNIZ B gönderilir", async () => {
    const a = await issueChallenge(prisma, userId);
    await enqueueChallengeRow(a.token, a.code, a.expiresAt);
    const b = await issueChallenge(prisma, userId);
    await enqueueChallengeRow(b.token, b.code, b.expiresAt);
    const send = vi.fn<SendFn>(async () => ({ ok: true }));
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toContain(b.token);
  });
});
