import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword, verifyPassword, dummyVerifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// Avoid touching the real cookie store on the success path (not exercised here).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined) };
});

// Keep the REAL bcrypt behaviour, but make the two verify paths observable so we
// can pin the constant-time branch (dummy compare runs for an unknown email).
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    verifyPassword: vi.fn(actual.verifyPassword),
    dummyVerifyPassword: vi.fn(actual.dummyVerifyPassword),
  };
});

import { setSessionCookie } from "@/lib/auth";
import { POST } from "@/app/api/auth/login/route";

const mockSetSession = vi.mocked(setSessionCookie);
/** Son basılan oturum payload'ı (mock üzerinden). */
const lastSession = () => mockSetSession.mock.calls.at(-1)?.[0];

function loginReq(body: unknown, ip = "1.1.1.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Musa",
        email: "musa@example.com",
        passwordHash: await hashPassword("correct-horse"),
        role: "owner",
        emailVerifiedAt: new Date(), // not testing the verify gate here
      },
    });
  });

  it("rejects wrong credentials with 401", async () => {
    const res = await POST(loginReq({ email: "musa@example.com", password: "nope" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await POST(loginReq({ email: "not-an-email", password: "" }));
    expect(res.status).toBe(400);
  });

  it("unknown email still runs a bcrypt comparison (constant-time; blocks user enumeration)", async () => {
    const res = await POST(loginReq({ email: "ghost@example.com", password: "whatever" }, "7.0.0.1"));
    expect(res.status).toBe(401);
    // The dummy compare ran (equal work to a real verify); the real verify did NOT.
    expect(vi.mocked(dummyVerifyPassword)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
  });

  it("known email runs the REAL verify, never the dummy", async () => {
    const res = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "7.0.0.2"));
    expect(res.status).toBe(401);
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dummyVerifyPassword)).not.toHaveBeenCalled();
  });

  it("rate-limits after 10 attempts from the same IP (429 + Retry-After)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "9.9.9.9"));
      expect(r.status).toBe(401);
    }
    const blocked = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "9.9.9.9"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    // 20s: 10 sequential REAL bcrypt verifies (deliberate — the timing-equalization
    // fix means every attempt costs a hash) ≈ 5-10s on a loaded box; the 5s default
    // made this compute-bound test flake under load.
  }, 20_000);

  it("limits each IP independently", async () => {
    for (let i = 0; i < 11; i++) {
      await POST(loginReq({ email: "musa@example.com", password: "nope" }, "2.2.2.2"));
    }
    // A fresh IP is still allowed (gets 401, not 429).
    const other = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "3.3.3.3"));
    expect(other.status).toBe(401);
    // 20s: 12 sequential bcrypt verifies — same compute-bound margin as above.
  }, 20_000);
});

// 2FA verification + replay protection at the ROUTE level (not just the totp lib).
// Guards the documented Round-1 fix: a used TOTP step can't be replayed.
describe("POST /api/auth/login — 2FA + TOTP replay", () => {
  const email = "tf@example.com";
  let secret: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    secret = generateSecret();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "TF",
        email,
        passwordHash: await hashPassword("correct-horse"),
        role: "owner",
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date(),
        emailVerifiedAt: new Date(), // not testing the verify gate here
      },
    });
  });

  it("withholds the session and asks for a code when 2FA is on and no code is given", async () => {
    const res = await POST(loginReq({ email, password: "correct-horse" }, "5.0.0.1"));
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRequired).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const res = await POST(loginReq({ email, password: "correct-horse", code: "000000" }, "5.0.0.2"));
    expect(res.status).toBe(401);
  });

  it("accepts a valid code, records the step, and REJECTS replay of the same code", async () => {
    const code = totp(secret);
    const ok = await POST(loginReq({ email, password: "correct-horse", code }, "5.0.0.3"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    const u = await prisma.user.findUnique({ where: { email }, select: { twoFactorLastStep: true } });
    expect(u?.twoFactorLastStep).not.toBeNull();

    // Same code again → replay blocked (step <= twoFactorLastStep).
    const replay = await POST(loginReq({ email, password: "correct-horse", code }, "5.0.0.4"));
    expect(replay.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 🚨 HESAP KOVASI KURBANI KİLİTLEMEZ (Codex denetimi, 08-01 — madde 1).
//
// `login-acct:{email}` kovası doğrulamadan ÖNCE kapı olarak kullanılıyordu.
// Sonuç: kurbanın e-postasını bilen biri YALNIZCA HATALI parolalarla kovayı
// doldurup hesabı KİLİTLİYORDU — kurban DOĞRU parolasıyla bile 429 alıyordu.
// Bu, kaba kuvvet korumasını bir HİZMET ENGELLEME silahına çeviriyordu.
//
// Doğru sözleşme (üçü birden):
//   1. DOĞRU parola sahibi hesap kovası yüzünden ASLA kilitlenmez.
//   2. IP limiti aynen korunur (her istekte tüketilir).
//   3. BAŞARISIZ hesap denemeleri yine sınırlandırılır (tavanı aşınca 429).
//
// ⚠️ Bilinçli taviz: kapı doğrulama SONRASINA taşındığı için tavanı aşmış bir
// saldırgan artık istek başına bir bcrypt maliyeti doğuruyor. IP kovası
// (10/5dk) tek-IP senaryosunu zaten kapatıyor; IP döndüren saldırgan bu
// maliyeti ödüyor ama kurbanı kilitleyemiyor — doğru takas budur.
// ---------------------------------------------------------------------------
describe("login — hesap kovası kilitleme silahı DEĞİLDİR", () => {
  const VICTIM = "musa@example.com";
  const GOOD = "correct-horse";

  // ⚠️ KENDİ beforeEach'i: bu KARDEŞ bir describe, üstteki kurulumu MİRAS ALMAZ.
  // (İlk yazımda almadığı fark edilmemişti; testler önceki bloğun sayaçlarını
  // görüp yanlış nedenle kırmızıya düşüyordu — vacuous kırmızı da bir tuzaktır.)
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Musa",
        email: VICTIM,
        passwordHash: await hashPassword(GOOD),
        role: "owner",
        emailVerifiedAt: new Date(),
      },
    });
  });

  async function attackerFailures(n: number, ip: string) {
    for (let i = 0; i < n; i++) {
      // Saldırgan HER SEFERİNDE farklı IP kullanıyor (IP kovasını atlatmak için).
      await POST(loginReq({ email: VICTIM, password: `wrong-${i}` }, `${ip}.${i % 250}`));
    }
  }

  it("saldırgan kovayı doldursa bile DOĞRU parola sahibi GİRER", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "9.9.9"); // tavan 20 → kova taşmış durumda

    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.2"));
    expect(res.status).toBe(200); // ⬅️ ARIZADA 429 idi (kurban kilitliydi)
  });

  it("BAŞARISIZ denemeler yine sınırlandırılır (koruma kaybolmadı)", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "8.8.8");

    // Aynı hesaba yeni bir hatalı deneme: artık 401 değil 429.
    const res = await POST(loginReq({ email: VICTIM, password: "still-wrong" }, "3.3.3.3"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("IP limiti KORUNUR (aynı IP'den 11. istek 429)", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(loginReq({ email: VICTIM, password: `w${i}` }, "7.7.7.7"));
    }
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "7.7.7.7"));
    expect(res.status).toBe(429);
  });

  it("BAŞARILI giriş hesap kovasını TÜKETMEZ", { timeout: 30_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await POST(loginReq({ email: VICTIM, password: GOOD }, `4.4.4.${i}`));
      expect(ok.status).toBe(200);
    }
    const row = await prisma.rateLimitCounter.findFirst({
      where: { key: { startsWith: "login-acct:" } },
    });
    expect(row).toBeNull(); // hiç sayaç satırı bile yaratılmadı
  });

  it("BİLİNMEYEN e-posta da sayılır (sayaç hesabın varlığını sızdırmaz)", async () => {
    await POST(loginReq({ email: "yok@example.com", password: "x" }, "5.5.5.5"));
    const row = await prisma.rateLimitCounter.findFirstOrThrow({
      where: { key: "login-acct:yok@example.com" },
    });
    expect(row.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 🚨 `mfa` İDDİASI: "BU OTURUM İKİNCİ FAKTÖRDEN GEÇTİ" (08-05).
//
// `admin.ts isSuperAdmin` operatör yetkisini bu iddiaya bağlıyor. İddia yanlış
// üretilirse kapı KURGUSAL olur — ve mutasyonla ölçtüm: login'i koşulsuz
// `mfa: true` yapan değişiklik, o an mevcut 24 testin HİÇBİRİNİ kırmıyordu.
// Yani bu dosya olmadan kontrolün sessizce yok olması mümkündü.
//
// İddia hesabın 2FA yapılandırmasından türetilir çünkü buraya ulaşmanın tek
// yolu `twoFactorEnabledAt` dalıdır: oraya girildiyse TOTP, kurtarma kodu ya da
// (2FA epoch'una bağlı) güvenilen cihazdan biri sağlanmıştır.
// ---------------------------------------------------------------------------
describe("login — mfa iddiası", () => {
  const email = "mfa-claim@example.com";
  let secret: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    secret = generateSecret();
  });

  async function seed(with2fa: boolean) {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email,
        passwordHash: await hashPassword("correct-horse"),
        role: "owner",
        emailVerifiedAt: new Date(),
        ...(with2fa
          ? { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() }
          : {}),
      },
    });
  }

  it("2FA KAPALI hesapta iddia FALSE — şifre tek başına operatör yetkisi vermez", async () => {
    await seed(false);
    const res = await POST(loginReq({ email, password: "correct-horse" }, "6.0.0.1"));
    expect(res.status).toBe(200);
    expect(lastSession()?.mfa).toBe(false);
  });

  it("2FA AÇIK + geçerli kodla girişte iddia TRUE", async () => {
    await seed(true);
    const res = await POST(loginReq({ email, password: "correct-horse", code: totp(secret) }, "6.0.0.2"));
    expect(res.status).toBe(200);
    expect(lastSession()?.mfa).toBe(true);
  });

  it("2FA açıkken KOD VERİLMEDEN oturum HİÇ basılmaz (iddia sızmaz)", async () => {
    await seed(true);
    const res = await POST(loginReq({ email, password: "correct-horse" }, "6.0.0.3"));
    expect((await res.json()).twoFactorRequired).toBe(true);
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});
