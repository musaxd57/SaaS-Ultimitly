import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ② 2FA AÇILINCA DİĞER OTURUMLAR DÜŞER (kurucu onayı 09-23).
//
// Senaryo: parola bir şekilde sızmış, saldırgan bir oturum açmış. Kullanıcı bunu
// fark edip 2FA'yı AÇIYOR — ama eskiden `sessionEpoch` artmadığı için saldırganın
// 2FA ÖNCESİ açtığı oturum yaşamaya devam ediyordu (middleware çerezi her istekte
// 14 gün ileri ittiği için hiç sona ermiyordu). Artık AÇMA anı bir güvenlik
// sınırıdır: epoch artar → başka her oturum bir sonraki istekte 401/çıkış alır;
// işlemi yapan cihazın çerezi YENİ epoch ile yeniden imzalanır (kullanıcı dışarı
// atılmaz — kurtarma kodu üretimi gibi bir sonraki adım aynı oturumla yapılır).
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

import { setSessionCookie, setKnownDeviceCookie } from "@/lib/auth";
import { totp } from "@/lib/auth/totp";
import { POST } from "@/app/api/account/2fa/route";

const SECRET = "ABCDEFGHIJKLMNOP";
const PW = "dogru-sifre-42";
const START_EPOCH = 4;

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Geçerli kodun bir fazlası — pencerede (±1 adım) tutma olasılığı ~3/1.000.000. */
function wrongCode(): string {
  return String((Number(totp(SECRET)) + 1) % 1_000_000).padStart(6, "0");
}

async function epochNow(): Promise<number> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).sessionEpoch;
}

describe("② 2FA AÇILINCA diğer oturumlar düşer, bu cihaz girişli kalır", () => {
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
        passwordHash: await hashPassword(PW),
        role: "owner",
        sessionEpoch: START_EPOCH,
        // Kurulum hâli: sır yazılmış, 2FA henüz ETKİN DEĞİL.
        twoFactorSecret: encryptSecret(SECRET),
        twoFactorEnabledAt: null,
        twoFactorLastStep: null,
      },
    });
    session = {
      userId: user.id,
      organizationId: org.id,
      role: "owner",
      email: "u@example.com",
      name: "U",
      sessionEpoch: START_EPOCH,
      mfa: false,
    };
  });

  it("enable: sessionEpoch ARTAR → 2FA öncesi açılmış (çalınmış) oturumlar ölür", async () => {
    const res = await POST(req({ action: "enable", code: totp(SECRET) }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorEnabledAt).not.toBeNull();
    expect(u.sessionEpoch).toBe(START_EPOCH + 1);
  });

  it("enable: BU cihazın oturum çerezi YENİ epoch ile yeniden imzalanır (kullanıcı dışarı atılmaz)", async () => {
    await POST(req({ action: "enable", code: totp(SECRET) }));
    expect(vi.mocked(setSessionCookie)).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(setSessionCookie).mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: session.userId,
      organizationId: session.organizationId,
      role: "owner",
      email: "u@example.com",
      name: "U",
      sessionEpoch: START_EPOCH + 1,
    });
    // `mfa` iddiası burada YÜKSELTİLMEZ: operatör yetkisi faktörle yapılan YENİ
    // girişten gelir (davranış eskisiyle aynı; yalnız epoch değişir).
    expect(payload.mfa).toBe(false);
  });

  it("enable: tanınan-cihaz çerezi de yeni epoch ile yenilenir (bu tarayıcı kova kapısında tanınmaya devam eder)", async () => {
    await POST(req({ action: "enable", code: totp(SECRET) }));
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(session.userId, START_EPOCH + 1);
  });

  it("KONTROL: hatalı kodla enable epoch'a dokunmaz, çerez basmaz", async () => {
    const res = await POST(req({ action: "enable", code: wrongCode() }));
    expect(res.status).toBe(400);
    expect(await epochNow()).toBe(START_EPOCH);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
    expect(vi.mocked(setKnownDeviceCookie)).not.toHaveBeenCalled();
  });

  it("KONTROL: zaten AÇIK hesapta enable (400) epoch'a dokunmaz", async () => {
    await prisma.user.update({ where: { id: session.userId }, data: { twoFactorEnabledAt: new Date() } });
    const res = await POST(req({ action: "enable", code: totp(SECRET) }));
    expect(res.status).toBe(400);
    expect(await epochNow()).toBe(START_EPOCH);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  it("KAPSAM: kurtarma kodu üretimi epoch'a DOKUNMAZ", async () => {
    await prisma.user.update({ where: { id: session.userId }, data: { twoFactorEnabledAt: new Date() } });
    const rc = await POST(req({ action: "recovery_codes", code: totp(SECRET) }));
    expect(rc.status).toBe(200);
    expect(await epochNow()).toBe(START_EPOCH);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G5 (kurucu kararı 10-13 "Diğerleri düşsün"; ACIK-ISLER 08-08 §7f): AÇIK 2FA KAPATILINCA diğer oturumlar düşer.
// Eskiden epoch artmıyordu → faktörle açılmış (`mfa:true`) başka bir tarayıcı, faktör YOKKEN operatör yetkisini taşıyordu
// (`isSuperAdmin` = allowlist + `mfa === true`). Bu tarayıcı girişli kalır ama `mfa:false` ile yeniden imzalanır.
// ---------------------------------------------------------------------------
describe("G5: 2FA KAPATILINCA diğer oturumlar düşer, bu cihaz girişli kalır ama mfa düşer", () => {
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
        passwordHash: await hashPassword(PW),
        role: "owner",
        sessionEpoch: START_EPOCH,
        twoFactorSecret: encryptSecret(SECRET),
        twoFactorEnabledAt: new Date(Date.now() - 86_400_000), // ETKİN
        twoFactorLastStep: null,
      },
    });
    // Faktörle girmiş bir oturum (operatör senaryosunun ön koşulu: mfa:true).
    session = {
      userId: user.id,
      organizationId: org.id,
      role: "owner",
      email: "u@example.com",
      name: "U",
      sessionEpoch: START_EPOCH,
      mfa: true,
    };
  });

  it("disable: sessionEpoch ARTAR → faktörle açılmış diğer oturumlar ölür; sır + kurtarma kodları gider", async () => {
    await prisma.twoFactorRecoveryCode.create({ data: { userId: session.userId, codeHash: "h1" } });
    const res = await POST(req({ action: "disable", code: totp(SECRET) }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorEnabledAt).toBeNull();
    expect(u.twoFactorSecret).toBeNull();
    expect(u.sessionEpoch).toBe(START_EPOCH + 1);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("disable: BU cihaz yeni epoch + mfa:false ile yeniden imzalanır (girişli kalır, operatör yetkisi düşer)", async () => {
    await POST(req({ action: "disable", code: totp(SECRET) }));
    expect(vi.mocked(setSessionCookie)).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(setSessionCookie).mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: session.userId,
      organizationId: session.organizationId,
      role: "owner",
      email: "u@example.com",
      sessionEpoch: START_EPOCH + 1,
      mfa: false,
    });
    expect(vi.mocked(setKnownDeviceCookie)).toHaveBeenCalledWith(session.userId, START_EPOCH + 1);
  });

  it("KONTROL: hatalı kodla disable epoch'a ve çereze dokunmaz, 2FA açık kalır", async () => {
    const res = await POST(req({ action: "disable", code: wrongCode() }));
    expect(res.status).toBe(400);
    expect(await epochNow()).toBe(START_EPOCH);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).twoFactorEnabledAt).not.toBeNull();
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
    expect(vi.mocked(setKnownDeviceCookie)).not.toHaveBeenCalled();
  });

  it("KONTROL: arada iptal edilmiş (bayat epoch'lu) oturum kapatamaz, epoch'u İKİNCİ kez artırmaz", async () => {
    await prisma.user.update({ where: { id: session.userId }, data: { sessionEpoch: START_EPOCH + 3 } });
    const res = await POST(req({ action: "disable", code: totp(SECRET) }));
    expect(res.status).toBe(400);
    expect(await epochNow()).toBe(START_EPOCH + 3);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).twoFactorEnabledAt).not.toBeNull();
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });

  it("KAPSAM: hiç ETKİNLEŞMEMİŞ kurulumu (yalnız setup) iptal etmek oturumları düşürmez — kaldırılan faktör yok", async () => {
    await prisma.user.update({ where: { id: session.userId }, data: { twoFactorEnabledAt: null } });
    session = { ...session, mfa: false };
    const res = await POST(req({ action: "disable", code: "" }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorSecret).toBeNull();
    expect(u.sessionEpoch).toBe(START_EPOCH);
    expect(vi.mocked(setSessionCookie)).not.toHaveBeenCalled();
  });
});
