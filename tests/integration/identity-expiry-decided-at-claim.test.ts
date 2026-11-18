import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { prisma } from "@/lib/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// F4 (Codex 11-17) — SÜRE KARARI HAK ALMA ANINDA VERİLİR; SON YAZMA ÖZET / TÜKETİM KOŞULLUDUR (bilinçli sözleşme, kod değişikliği YOK).
//
// Parola değiştirme onayında ve şifre sıfırlamada süre sonu hak alınırken sınanır; son yazma (kod özeti + oturum sürümü / `consumedAt`)
// süreyi yeniden sınamaz. Arada iki bcrypt var (parola kapısının kuyruğunda saniyeler): süresi dolmadan hakkını almış ve doğru kodla
// gelmiş istek kuyruk gecikmesi yüzünden reddedilmemeli. Bu dosya sözleşmeyi pinler: biri son yazmaya süre koşulu eklerse (ya da hak
// almadaki süre sınamasını kaldırırsa) kırmızı. Süre geçişi ZAMANLA değil, hak alındıktan sonra satırın süresi geçmişe çekilerek kurulur.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined), setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

/** Açıkken: kod doğrulaması (bcrypt) döndükten HEMEN sonra kodun süresi geçmişe çekilir (= hak alındı, sonra süre doldu). */
let expireAfterVerify: (() => Promise<void>) | null = null;
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    verifyPassword: vi.fn(async (pw: string, hash: string) => {
      const out = await actual.verifyPassword(pw, hash);
      if (expireAfterVerify) {
        const hook = expireAfterVerify;
        expireAfterVerify = null;
        await hook();
      }
      return out;
    }),
  };
});

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { issueChallenge, verifyChallenge, consumeChallengeAndResetPassword, hashChallengeToken } from "@/lib/auth/password-reset-challenge";
import { POST as changePassword } from "@/app/api/account/password/route";

let userId = "";
const PAST = () => new Date(Date.now() - 1_000);

describe("kimlik akışları — süre kararı hak alma anında (F4)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    expireAfterVerify = null;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword("eski-parola-1"), role: "owner", sessionEpoch: 1, emailVerifiedAt: new Date() },
    });
    userId = user.id;
    session = { userId, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 1 };
  });

  it("parola değiştirme: hak süresi içinde alındı, son yazmadan önce süre doldu → yine 200 (son yazma süreyi yeniden sınamaz)", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() + 10 * 60_000), pwChangeCodeAttempts: 0 },
    });
    let fired = false;
    expireAfterVerify = async () => {
      fired = true;
      await prisma.user.update({ where: { id: userId }, data: { pwChangeCodeExpiresAt: PAST() } });
    };
    const res = await changePassword(
      new NextRequest("http://localhost/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.11" },
        body: JSON.stringify({ action: "confirm", code: "12345678", newPassword: "yeni-parola-2" }),
      }),
    );
    expect(fired).toBe(true);
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, pwChangeCodeHash: true } });
    expect(await verifyPassword("yeni-parola-2", row.passwordHash)).toBe(true);
    expect(row.pwChangeCodeHash).toBeNull(); // kod tüketildi (tek kullanım)
  });

  it("KONTROL — parola değiştirme: süresi HAK ALMADAN önce dolmuşsa reddedilir (süre kararı hak almada)", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: PAST(), pwChangeCodeAttempts: 0 },
    });
    const res = await changePassword(
      new NextRequest("http://localhost/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.12" },
        body: JSON.stringify({ action: "confirm", code: "12345678", newPassword: "yeni-parola-2" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("şifre sıfırlama: challenge süresi içinde doğrulandı, tüketimden önce süre doldu → tüketim yine başarılı", async () => {
    const { token, code } = await issueChallenge(prisma, userId);
    const verdict = await verifyChallenge(token, code);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    await prisma.passwordResetChallenge.update({ where: { tokenHash: hashChallengeToken(token) }, data: { expiresAt: PAST() } });
    const epoch = await consumeChallengeAndResetPassword({
      challengeId: verdict.challengeId,
      userId: verdict.userId,
      organizationId: verdict.organizationId,
      newPasswordHash: await hashPassword("yeni-parola-3"),
    });
    expect(epoch).toBe(2);
  });

  it("KONTROL — şifre sıfırlama: süresi DOĞRULAMADAN önce dolmuş challenge doğrulanamaz", async () => {
    const { token, code } = await issueChallenge(prisma, userId);
    await prisma.passwordResetChallenge.update({ where: { tokenHash: hashChallengeToken(token) }, data: { expiresAt: PAST() } });
    expect((await verifyChallenge(token, code)).ok).toBe(false);
  });
});
