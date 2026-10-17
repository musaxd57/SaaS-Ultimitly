import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// ④ GİRİŞTE PAROLA HASH'İ YÜKSELTME (kurucu onayı 09-23).
//
// Eski hesapların hash'i maliyet-10 (ya da NFC olmayan ham biçim) olabilir; bugün
// yalnız parola DEĞİŞİNCE yenileniyordu. Artık tam başarılı girişte (parola + varsa
// ikinci faktör) arka planda maliyet-12 + NFC biçimine taşınır. Sözleşme:
//   · yalnız TAM başarılı girişte (yanlış parola / yarım 2FA yazamaz),
//   · `sessionEpoch`e DOKUNMAZ (hiçbir oturum, "beni hatırla" ya da tanınan cihaz düşmez),
//   · CAS: hash arada değiştiyse (parola sıfırlandı) YAZMAZ,
//   · kapı doluysa BEKLEMEZ, girişi ASLA bozmaz (bir sonraki girişte yeniden dener).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
    setTrustedDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST } from "@/app/api/auth/login/route";
import { upgradeStoredPasswordHash } from "@/lib/auth/password-upgrade";

const EMAIL = "u@example.com";
const PW = "correct-horse";

function loginReq(body: unknown, ip = "3.3.3.3") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function seedUser(passwordHash: string, extra: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  return prisma.user.create({
    data: {
      organizationId: org.id,
      name: "U",
      email: EMAIL,
      passwordHash,
      role: "owner",
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });
}

async function storedHash(id: string): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;
}

describe("④ girişte parola hash'i yükseltme", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maliyet-10 hash: başarılı girişte maliyet-12'ye yükseltilir, parola aynen çalışır, epoch DEĞİŞMEZ", async () => {
    const legacy = await bcrypt.hash(PW, 10);
    const u = await seedUser(legacy, { sessionEpoch: 3 });
    const res = await POST(loginReq({ email: EMAIL, password: PW }));
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.passwordHash).not.toBe(legacy);
    expect(bcrypt.getRounds(after.passwordHash)).toBe(12);
    expect(await verifyPassword(PW, after.passwordHash)).toBe(true);
    expect(after.sessionEpoch).toBe(3);
  });

  it("KONTROL: güncel hash'e (maliyet-12, NFC) dokunulmaz", async () => {
    const current = await hashPassword(PW);
    const u = await seedUser(current);
    expect((await POST(loginReq({ email: EMAIL, password: PW }))).status).toBe(200);
    expect(await storedHash(u.id)).toBe(current);
  });

  it("yanlış parolada eski hash'e dokunulmaz", async () => {
    const legacy = await bcrypt.hash(PW, 10);
    const u = await seedUser(legacy);
    expect((await POST(loginReq({ email: EMAIL, password: "yanlis-parola" }))).status).toBe(401);
    expect(await storedHash(u.id)).toBe(legacy);
  });

  it("2FA hesabı: yalnız parola doğruyken (kod YOK) yazılmaz; kodla giriş TAMAMLANINCA yükseltilir", async () => {
    const legacy = await bcrypt.hash(PW, 10);
    const secret = generateSecret();
    const u = await seedUser(legacy, { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() });

    const half = await POST(loginReq({ email: EMAIL, password: PW }));
    expect(half.status).toBe(200);
    expect((await half.json()).twoFactorRequired).toBe(true);
    expect(await storedHash(u.id)).toBe(legacy);

    const full = await POST(loginReq({ email: EMAIL, password: PW, code: totp(secret) }));
    expect(full.status).toBe(200);
    expect((await full.json()).ok).toBe(true);
    expect(bcrypt.getRounds(await storedHash(u.id))).toBe(12);
  });

  it("eski ham-NFD hash: NFD yazımla giriş başarılı ve NFC'ye taşınır → artık NFC yazımla da girilir", async () => {
    const nfc = "Kuş-şifre-2026".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    const legacy = await bcrypt.hash(nfd, 12); // maliyet ZATEN 12 — tetik yalnız biçim
    const u = await seedUser(legacy);
    expect((await POST(loginReq({ email: EMAIL, password: nfd }))).status).toBe(200);
    const upgraded = await storedHash(u.id);
    expect(upgraded).not.toBe(legacy);
    expect(await verifyPassword(nfc, upgraded)).toBe(true);
  });

  it("CAS: hash arada değiştiyse (ör. parola sıfırlandı) yükseltme YAZMAZ", async () => {
    const legacy = await bcrypt.hash(PW, 10);
    const u = await seedUser(legacy);
    const fresh = await hashPassword("yeni-parola-2026");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: fresh } });
    expect(await upgradeStoredPasswordHash(u.id, legacy, PW)).toBe("raced");
    expect(await storedHash(u.id)).toBe(fresh);
  });

  it("kapı doluyken yükseltme KUYRUĞA GİRMEZ ('busy') ve hash'e dokunmaz", async () => {
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    const legacy = await bcrypt.hash(PW, 10);
    const u = await seedUser(legacy);
    // Tek yuvayı tut (çağrı anında yuva alınır; beklemeden devam ediyoruz).
    const holder = verifyPassword("baska-bir-deneme", legacy);
    // Kuyruğa girseydi, tutan iş bitince yuvayı alıp "upgraded" dönerdi.
    expect(await upgradeStoredPasswordHash(u.id, legacy, PW)).toBe("busy");
    await holder;
    expect(await storedHash(u.id)).toBe(legacy);
  });
});
