import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİMLİK YARIŞLARI (Codex 10-07, 15c8663: U43 · U40 · U41 · U42-silme tarafı) — GERÇEK POSTGRESQL.
//
// Ortak kök: `requireSession` oturum sürümünü isteğin BAŞINDA denetler; son yazma ya hiçbir şeyi ya da sonradan okunan sürümü
// koşul alıyordu. Her testte rotanın doğrulama adımı (parola / kod / TOTP) GERÇEKTEN koşar, hemen ardından araya gerçek bir yazma
// girer (parola sıfırlama = `consumeChallengeAndResetPassword`, ya da sürüm artışı), sonra istek devam eder. Doğru sonuç: bayat
// istek REDDEDİLİR — parola / 2FA / hesap değişmez, yeni çerez verilmez. Her yarışın yanında normal akış kontrolü.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
    clearSessionCookie: vi.fn().mockResolvedValue(undefined),
  };
});
let lastEmailHtml = "";
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _subject: string, html: string) => {
      lastEmailHtml = html;
      return { ok: true };
    }),
  },
}));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
/** Doğrulamanın HEMEN ardından koşan araya-girme kancası (bir kez). */
let afterVerify: (() => Promise<void>) | null = null;
async function interleave(): Promise<void> {
  const hook = afterVerify;
  afterVerify = null;
  if (hook) await hook();
}
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    verifyPassword: vi.fn(async (...a: Parameters<typeof actual.verifyPassword>) => {
      const r = await actual.verifyPassword(...a);
      await interleave();
      return r;
    }),
  };
});

import { setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { totp } from "@/lib/auth/totp";
import { issueChallenge, consumeChallengeAndResetPassword } from "@/lib/auth/password-reset-challenge";
import { POST as passwordPOST } from "@/app/api/account/password/route";
import { POST as twoFactorPOST } from "@/app/api/account/2fa/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";

const SECRET = "ABCDEFGHIJKLMNOP";
const PW = "dogru-sifre-42";
const RESET_PW = "sifirlanan-sifre-77";

function req(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seed(opts: { pendingTwoFactor?: boolean } = {}) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "U",
      email: `u${Math.random()}@example.com`,
      passwordHash: await hashPassword(PW),
      role: "owner",
      sessionEpoch: 3,
      ...(opts.pendingTwoFactor ? { twoFactorSecret: encryptSecret(SECRET), twoFactorEnabledAt: null } : {}),
    },
  });
  session = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: "U", sessionEpoch: 3 };
  return { orgId: org.id, userId: user.id };
}

/** Gerçek parola sıfırlama (e-posta bağlantısının tamamlandığı an): parola + sürüm artışı + bekleyen yollar ölür. */
async function realReset(userId: string, orgId: string): Promise<void> {
  await issueChallenge(prisma, userId);
  const ch = await prisma.passwordResetChallenge.findFirstOrThrow({ where: { userId, consumedAt: null } });
  const epoch = await consumeChallengeAndResetPassword({
    challengeId: ch.id,
    userId,
    organizationId: orgId,
    newPasswordHash: await hashPassword(RESET_PW),
  });
  expect(epoch).not.toBeNull();
}
const bumpEpoch = (userId: string) => prisma.user.update({ where: { id: userId }, data: { sessionEpoch: { increment: 1 } } });
const passwordIs = async (userId: string, pw: string) =>
  (await import("bcryptjs")).compare(pw, (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash);

describe("U43 — parola değiştirme, araya giren sıfırlamayı EZMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    afterVerify = null;
    lastEmailHtml = "";
  });

  async function codeRequested(): Promise<string> {
    expect((await passwordPOST(req("/api/account/password", { action: "request" }))).status).toBe(200);
    const m = lastEmailHtml.match(/(\d{8})/);
    if (!m) throw new Error("kod e-postada yok");
    return m[1];
  }

  it("🚨 kod doğrulandı → GERÇEK sıfırlama tamamlandı → bayat istek devam: reddedilir, parola sıfırlamanınki, çerez yok", async () => {
    const s = await seed();
    const code = await codeRequested();
    afterVerify = () => realReset(s.userId, s.orgId);
    const res = await passwordPOST(req("/api/account/password", { action: "confirm", code, newPassword: "saldirgan-sifre-1" }));
    // Sıfırlama bekleyen kodu da sildi → "kod kullanıldı" (400; çift tıklamanın kaybedeniyle aynı sözleşme).
    expect(res.status).toBe(400); // ⬅️ ARIZADA 200 + parola saldırganınki
    expect(await passwordIs(s.userId, RESET_PW)).toBe(true);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  it("🚨 kod doğrulandı → (kod temizlenmeden) oturum sürümü arttı → bayat istek reddedilir (sürüm koşulu tek başına)", async () => {
    const s = await seed();
    const code = await codeRequested();
    afterVerify = async () => void (await bumpEpoch(s.userId));
    const res = await passwordPOST(req("/api/account/password", { action: "confirm", code, newPassword: "saldirgan-sifre-1" }));
    expect(res.status).toBe(401);
    expect(await passwordIs(s.userId, PW)).toBe(true);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  it("sıfırlama bekleyen parola değiştirme kodunu da öldürür", async () => {
    const s = await seed();
    await codeRequested();
    await realReset(s.userId, s.orgId);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(u.pwChangeCodeHash).toBeNull();
    expect(u.pwChangeCodeExpiresAt).toBeNull();
  });

  it("KONTROL: araya bir şey girmezse parola değişir, bu cihaz yeni sürümle girişli kalır", async () => {
    const s = await seed();
    const code = await codeRequested();
    const res = await passwordPOST(req("/api/account/password", { action: "confirm", code, newPassword: "yeni-sifre-2026" }));
    expect(res.status).toBe(200);
    expect(await passwordIs(s.userId, "yeni-sifre-2026")).toBe(true);
    expect(vi.mocked(setSessionCookie).mock.calls[0][0]).toMatchObject({ sessionEpoch: 4 });
  });
});

describe("U40 — 2FA açma / kapatma, araya giren sıfırlamadan sonra oturum VERMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    afterVerify = null;
  });

  it("🚨 oturum sıfırlamadan ÖNCE denetlendi → GERÇEK sıfırlama → bayat açma isteği: 2FA kapalı kalır, çerez yok", async () => {
    // `requireSession` sürümü isteğin başında denetler (taklit: sıfırlamadan önceki oturum); TOTP senkron olduğundan araya girmenin
    // belirlenimci eşdeğeri sıfırlamayı istekten hemen önce tamamlamaktır — rotanın kendi denetimleri yine GERÇEKTEN koşar.
    const s = await seed({ pendingTwoFactor: true });
    await realReset(s.userId, s.orgId);
    const res = await twoFactorPOST(req("/api/account/2fa", { action: "enable", code: totp(SECRET) }));
    expect(res.status).toBeGreaterThanOrEqual(400); // ⬅️ ARIZADA 200 + saldırganın sırrıyla 2FA açık
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(u.twoFactorEnabledAt).toBeNull();
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  async function seedEnabled() {
    const s = await seed();
    await prisma.user.update({
      where: { id: s.userId },
      data: { twoFactorSecret: encryptSecret(SECRET), twoFactorEnabledAt: new Date(Date.now() - 86_400_000), twoFactorLastStep: null },
    });
    return s;
  }

  it("🚨 KAPATMA: oturum sıfırlamadan önce denetlendi → bayat istek 2FA'yı KAPATAMAZ", async () => {
    const s = await seedEnabled();
    await realReset(s.userId, s.orgId);
    const res = await twoFactorPOST(req("/api/account/2fa", { action: "disable", code: totp(SECRET), password: PW }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).twoFactorEnabledAt).not.toBeNull();
  });

  it("🚨 KURTARMA KODU: oturum sıfırlamadan önce denetlendi → bayat istek kod ÜRETEMEZ", async () => {
    const s = await seedEnabled();
    await realReset(s.userId, s.orgId);
    const res = await twoFactorPOST(req("/api/account/2fa", { action: "recovery_codes", code: totp(SECRET) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: s.userId } })).toBe(0);
  });

  it("KONTROL: kapatma ve kurtarma kodu taze oturumla çalışır", async () => {
    const s = await seedEnabled();
    expect((await twoFactorPOST(req("/api/account/2fa", { action: "recovery_codes", code: totp(SECRET) }))).status).toBe(200);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: s.userId } })).toBeGreaterThan(0);
  });

  it("KONTROL: araya bir şey girmezse 2FA açılır ve bu cihaz yeni sürümle imzalanır", async () => {
    const s = await seed({ pendingTwoFactor: true });
    const res = await twoFactorPOST(req("/api/account/2fa", { action: "enable", code: totp(SECRET) }));
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).twoFactorEnabledAt).not.toBeNull();
    expect(vi.mocked(setSessionCookie).mock.calls[0][0]).toMatchObject({ sessionEpoch: 4 });
  });
});

describe("U41 / U42 — hesap silme, araya giren sıfırlama ya da aktifleşen abonelikten sonra SİLMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    afterVerify = null;
  });

  it("🚨 U41: parola doğrulandı → GERÇEK sıfırlama → silme sürmez (401, org yerinde)", async () => {
    const s = await seed();
    afterVerify = () => realReset(s.userId, s.orgId);
    const res = await deletePOST(req("/api/account/delete", { password: PW }));
    expect(res.status).toBe(401); // ⬅️ ARIZADA 200 + org silinmiş
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("🚨 U42 (silme tarafı): parola doğrulandı → ödeme olayı AKTİF abonelik yazdı → 409, org yerinde", async () => {
    const s = await seed();
    afterVerify = async () => {
      await prisma.subscription.create({
        data: { organizationId: s.orgId, provider: "paddle", status: "active", planCode: "pro", providerRef: "sub_live_1" },
      });
    };
    const res = await deletePOST(req("/api/account/delete", { password: PW }));
    expect(res.status).toBe(409);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("KONTROL: araya bir şey girmezse hesap silinir", async () => {
    const s = await seed();
    const res = await deletePOST(req("/api/account/delete", { password: PW }));
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(0);
  });
});
