import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// 🚨 LOGIN, TRUSTED-DEVICE KAPISINA `sessionEpoch`'U GERÇEKTEN GEÇİRİR (S2).
//
// Birim testler token sözleşmesini pinliyor; bu dosya WIRING'i pinliyor. İkisi
// ayrı: sözleşme doğru ama `login` eski epoch'u (ya da sabit bir değeri)
// geçirirse koruma sessizce ÖLÜR ve hiçbir birim testi bunu görmez.
//
// `hasTrustedDevice`/`setTrustedDeviceCookie` çerez deposuna dokunuyor; burada
// mock'lanıp ARGÜMANLARI ölçülüyor.
// ---------------------------------------------------------------------------
// ⚠️ `vi.hoisted` ŞART: `vi.mock` fabrikası dosyanın en üstüne kaldırılıyor ve
// sıradan bir üst-seviye değişkene erişemiyor ("Cannot access before
// initialization"). Deponun kendi deseni (`require-auth-failclosed.test.ts`).
const { hasTrusted, setTrusted } = vi.hoisted(() => ({
  hasTrusted: vi.fn(async () => false),
  setTrusted: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    hasTrustedDevice: hasTrusted,
    setTrustedDeviceCookie: setTrusted,
  };
});

import { POST } from "@/app/api/auth/login/route";

const EMAIL = "wiring@example.com";
const PW = "correct-horse-9";
let secret = "";
let userId = "";
const TWO_FA_AT = new Date("2026-01-01T00:00:00Z");

function req(body: unknown, ip = "7.7.7.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("login → trusted-device wiring", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    secret = generateSecret();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "W",
        email: EMAIL,
        passwordHash: await hashPassword(PW),
        role: "owner",
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: TWO_FA_AT,
        emailVerifiedAt: new Date(),
        sessionEpoch: 7, // ⬅️ VARSAYILAN DEĞİL: sabit 0 geçirilse test kırmızı olsun
      },
    });
    userId = user.id;
  });

  it("kapıya (userId, 2FA-epoch, sessionEpoch) ÜÇLÜSÜ geçirilir", async () => {
    await POST(req({ email: EMAIL, password: PW }));
    expect(hasTrusted).toHaveBeenCalledWith(userId, TWO_FA_AT.getTime(), 7);
  });

  it("çerez basılırken de AYNI üçlü kullanılır", async () => {
    // 🚨 KOŞULSUZ İDDİA — burada bir zamanlar `if (setTrusted.mock.calls.length > 0)`
    // vardı ve o kalıp testi SESSİZCE bozuyordu: yazma yeri hiç çalışmasa (ör.
    // `login/route.ts`teki koşuldan `rememberDevice` düşse) `else` dalı bir üstteki
    // testin iddiasını TEKRARLAYIP yeşil kalıyordu. Yani S2'nin YAZMA tarafı
    // fiilen pinsizdi. "Emin değilim, ihtiyaten sarayım" refleksi tam olarak
    // boş test üretir; doğrusu koşulu ölçüp iddiayı çıplak bırakmaktır.
    await POST(req({ email: EMAIL, password: PW, code: totp(secret), rememberDevice: true }));
    expect(setTrusted).toHaveBeenCalledWith(userId, TWO_FA_AT.getTime(), 7);
  });

  it("KONTROL: epoch DEĞİŞİNCE geçirilen değer de değişir (sabit değil)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { sessionEpoch: 42 } });
    await POST(req({ email: EMAIL, password: PW }, "7.7.7.2"));
    expect(hasTrusted).toHaveBeenCalledWith(userId, TWO_FA_AT.getTime(), 42);
  });
});
