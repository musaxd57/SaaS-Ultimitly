import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// 2FA YÖNETİMİNDE GÜNLÜK HATALI-KOD TAVANI (saldırgan gözüyle giriş turu, 09-23).
//
// Giriş rotası 09-23'te günlük TOTP tavanı aldı (20 hata/gün). 2FA YÖNETİM rotası
// (`/api/account/2fa`) almamıştı: tek fren 10 deneme / 10 dk = günde 1.440 tahmin.
// ±1 adım penceresiyle ayda ~%12 isabet (ajan ölçtü). Bahis büyük: `recovery_codes`
// 10 KALICI kurtarma kodu basar ve bunlar parola değişiminden SAĞ ÇIKAR. Yani çalınmış
// bir oturum çerezi (parolasız) → bir ay tahmin → kalıcı ikinci-faktör atlaması.
// Artık kod doğrulayan üç eylem (enable · disable · recovery_codes) günde en fazla 20
// HATALI kod kabul eder; tavan GİRİŞİN tavanından AYRIDIR (oturum sahibi saldırgan
// kurbanın giriş kodu hakkını yakamasın).
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

import { totp } from "@/lib/auth/totp";
import { POST } from "@/app/api/account/2fa/route";

const SECRET = "ABCDEFGHIJKLMNOP";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function wrongCode(): string {
  return String((Number(totp(SECRET)) + 1) % 1_000_000).padStart(6, "0");
}

/** 10 dk'lık genel kovayı boşalt (günlük sayaç KALIR) — testte 2 pencereyi simüle eder. */
async function nextTenMinuteWindow() {
  await prisma.rateLimitCounter.deleteMany({ where: { key: `2fa:${session.userId}` } });
  __resetRateLimit();
}

async function burnWrongCodes(action: "recovery_codes" | "disable", n: number) {
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 10 === 0) await nextTenMinuteWindow();
    const res = await POST(req({ action, code: wrongCode() }));
    expect(res.status).toBe(400);
  }
  await nextTenMinuteWindow();
}

describe("2FA yönetimi — günlük hatalı kod tavanı", () => {
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
        passwordHash: "x",
        role: "owner",
        twoFactorSecret: encryptSecret(SECRET),
        twoFactorEnabledAt: new Date(),
      },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("20 hatalı koddan sonra GEÇERLİ kod bile kurtarma kodu BASAMAZ (429)", async () => {
    await burnWrongCodes("recovery_codes", 20);
    const res = await POST(req({ action: "recovery_codes", code: totp(SECRET) }));
    expect(res.status).toBe(429);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("tavan eylemler arasında ORTAK: recovery_codes'ta yakılan hak disable'ı da kapatır", async () => {
    await burnWrongCodes("recovery_codes", 20);
    const res = await POST(req({ action: "disable", code: totp(SECRET) }));
    expect(res.status).toBe(429);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).twoFactorEnabledAt).not.toBeNull();
  });

  it("KONTROL: 19 hatadan sonra geçerli kod HÂLÂ çalışır (tavan meşru kullanıcıyı erken kesmez)", async () => {
    await burnWrongCodes("recovery_codes", 19);
    const res = await POST(req({ action: "recovery_codes", code: totp(SECRET) }));
    expect(res.status).toBe(200);
    expect((await res.json()).codes).toHaveLength(10);
  });

  it("KONTROL: başarılı işlem hak YAKMAZ (yalnız hatalar sayılır)", async () => {
    const ok = await POST(req({ action: "recovery_codes", code: totp(SECRET) }));
    expect(ok.status).toBe(200);
    const day = await prisma.rateLimitCounter.findFirst({ where: { key: { startsWith: "reauth-fail-day:" } } });
    expect(day).toBeNull();
    // Anti-vakum: aynı anahtar bir HATADAN sonra gerçekten yazılıyor (yoksa yukarıdaki `null`
    // yanlış anahtara bakan bir iddia olurdu).
    const bad = await POST(req({ action: "recovery_codes", code: wrongCode() }));
    expect(bad.status).toBe(400);
    const after = await prisma.rateLimitCounter.findFirst({ where: { key: { startsWith: "reauth-fail-day:" } } });
    expect(after?.count).toBe(1);
  });

  it("müşteriye giden metin sade: teknik terim yok", async () => {
    await burnWrongCodes("recovery_codes", 20);
    const res = await POST(req({ action: "recovery_codes", code: totp(SECRET) }));
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/TOTP|bucket|kova|rate|limit/i);
  });
});
