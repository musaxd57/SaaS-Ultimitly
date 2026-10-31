import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { issueChallenge } from "@/lib/auth/password-reset-challenge";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// YENİ EPOCH İŞLEMİN İÇİNDEN OKUNUR (09-23 inceleme turu).
//
// Şifre değiştirme ve sıfırlama `sessionEpoch`i artırıp BU cihazın çerezlerini yeni epoch ile
// yeniden imzalıyor. Epoch işlem BİTTİKTEN sonra ayrıca okunuyordu: araya başka bir artış
// (eşzamanlı bir sıfırlama, 2FA açma) girerse okunan değer O artışın epoch'u olur ve bu cihazın
// çerezi, düşmesi gereken ikinci geçersiz kılmadan SAĞ ÇIKARDI. Test, "işlem sonrası okuma"nın
// tam o anına bir artış yerleştirir (global istemcinin `findUnique`'i üzerinden): doğru kod o
// okumayı hiç yapmaz ve çereze KENDİ epoch'unu yazar.
//
// ⚠️ Ayrı dosya: Prisma temsilcisine `vi.spyOn` aynı dosyadaki sonraki testlere sızıyor.
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
  };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { setSessionCookie, setKnownDeviceCookie } from "@/lib/auth";
import { POST as changePassword } from "@/app/api/account/password/route";
import { POST as forgotPassword } from "@/app/api/account/forgot-password/route";

const START_EPOCH = 5;
let userId = "";
/** Açıkken: global istemciden yapılan İLK epoch okumasından hemen önce eşzamanlı bir artış olur. */
let injectConcurrentBump = false;
let injected = 0;

beforeAll(() => {
  const realFindUnique = prisma.user.findUnique.bind(prisma.user);
  vi.spyOn(prisma.user, "findUnique").mockImplementation((async (args: { where: { id?: string }; select?: Record<string, unknown> }) => {
    if (injectConcurrentBump && args?.select?.sessionEpoch && args.where.id) {
      injectConcurrentBump = false;
      injected++;
      await prisma.user.update({ where: { id: args.where.id }, data: { sessionEpoch: { increment: 1 } } });
    }
    return realFindUnique(args as Parameters<typeof realFindUnique>[0]);
  }) as unknown as typeof prisma.user.findUnique);
});

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.8" },
    body: JSON.stringify(body),
  });
}

describe("şifre akışları — yeni epoch işlem içinden", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.mocked(setSessionCookie).mockClear();
    vi.mocked(setKnownDeviceCookie).mockClear();
    injectConcurrentBump = false;
    injected = 0;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email: "u@example.com",
        passwordHash: await hashPassword("eski-parola-1"),
        role: "owner",
        sessionEpoch: START_EPOCH,
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    session = { userId, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: START_EPOCH };
  });

  it("değiştirme: araya giren artış olsa bile çereze BU değişikliğin epoch'u yazılır", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pwChangeCodeHash: await hashPassword("12345678"),
        pwChangeCodeExpiresAt: new Date(Date.now() + 5 * 60_000),
        pwChangeCodeAttempts: 0,
      },
    });
    injectConcurrentBump = true;
    const res = await changePassword(
      jsonReq("http://localhost/api/account/password", { action: "confirm", code: "12345678", newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(setSessionCookie).mock.calls[0][0]).toMatchObject({ sessionEpoch: START_EPOCH + 1 });
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(userId, START_EPOCH + 1);
  });

  it("sıfırlama: tanınan-cihaz çerezine BU sıfırlamanın epoch'u yazılır", async () => {
    const { token, code } = await issueChallenge(prisma, userId);
    injectConcurrentBump = true;
    const res = await forgotPassword(
      jsonReq("http://localhost/api/account/forgot-password", { action: "confirm", token, code, newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(userId, START_EPOCH + 1);
  });

  it("KONTROL (anti-vakum): enjeksiyon gerçekten çalışıyor — global okuma artışı görür", async () => {
    injectConcurrentBump = true;
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionEpoch: true } });
    expect(injected).toBe(1);
    expect(row?.sessionEpoch).toBe(START_EPOCH + 1);
  });
});
