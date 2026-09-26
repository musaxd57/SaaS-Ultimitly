import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { issueChallenge } from "@/lib/auth/password-reset-challenge";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// PAROLA DEĞİŞTİRME / SIFIRLAMA SONRASI BU CİHAZ (09-23 saldırgan turu).
//
// ① SÜREKLİ KİLİTLEME (kaba kuvvet ajanı ölçtü): saldırgan hesap kovasını IP döndürerek dolu
// tutarsa, "tanınan cihaz" çerezi olmayan her tarayıcı girişte 429 alır. Kurban ürünün
// söylediğini yapıp parolasını SIFIRLAYINCA `sessionEpoch` artar ve tanınan-cihaz çerezleri
// (epoch'a bağlı) DE ölür → kurban saldırı sürdükçe HİÇBİR cihazdan giremez. Sıfırlamayı
// tamamlayan tarayıcı e-posta kutusunu kanıtlamıştır → artık o tarayıcı tanınan cihaz olur.
// ② DEĞİŞTİRME: yorum "yalnız DİĞER oturumlar düşer" diyordu ama çerez yeniden
// imzalanmadığı için işlemi yapan cihaz da bir sonraki tıklamada sessizce çıkışa düşüyordu.
// Artık bu cihaz girişli kalır (2FA açmadaki desenin aynısı); başka her oturum düşer.
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

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
    body: JSON.stringify(body),
  });
}

const START_EPOCH = 2;

describe("parola akışları — bu cihaz", () => {
  let userId = "";
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
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

  it("değiştirme: epoch artar, BU cihazın oturumu yeni epoch ile yeniden imzalanır, tanınan-cihaz yenilenir", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pwChangeCodeHash: await hashPassword("12345678"),
        pwChangeCodeExpiresAt: new Date(Date.now() + 5 * 60_000),
        pwChangeCodeAttempts: 0,
      },
    });
    const res = await changePassword(
      jsonReq("http://localhost/api/account/password", { action: "confirm", code: "12345678", newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionEpoch).toBe(START_EPOCH + 1);
    expect(vi.mocked(setSessionCookie)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setSessionCookie).mock.calls[0][0]).toMatchObject({ userId, sessionEpoch: START_EPOCH + 1 });
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(userId, START_EPOCH + 1);
  });

  it("KONTROL: hatalı kodla değiştirme çerez basmaz, epoch değişmez", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pwChangeCodeHash: await hashPassword("12345678"),
        pwChangeCodeExpiresAt: new Date(Date.now() + 5 * 60_000),
        pwChangeCodeAttempts: 0,
      },
    });
    const res = await changePassword(
      jsonReq("http://localhost/api/account/password", { action: "confirm", code: "87654321", newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
    expect(vi.mocked(setKnownDeviceCookie)).not.toHaveBeenCalled();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionEpoch).toBe(START_EPOCH);
  });

  it("sıfırlama: tamamlayan tarayıcı YENİ epoch ile tanınan cihaz olur; oturum AÇILMAZ", async () => {
    const { token, code } = await issueChallenge(prisma, userId);
    const res = await forgotPassword(
      jsonReq("http://localhost/api/account/forgot-password", { action: "confirm", token, code, newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(200);
    const epoch = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionEpoch;
    expect(epoch).toBe(START_EPOCH + 1);
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(userId, epoch);
    // Sıfırlama bir GİRİŞ değildir: kullanıcı yeni parolayla (ve varsa 2FA ile) girer.
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  it("KONTROL: hatalı kodla sıfırlama tanınan cihaz YAPMAZ", async () => {
    const { token } = await issueChallenge(prisma, userId);
    const res = await forgotPassword(
      jsonReq("http://localhost/api/account/forgot-password", { action: "confirm", token, code: "00000000", newPassword: "yeni-parola-2" }),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(setKnownDeviceCookie)).not.toHaveBeenCalled();
  });
});
