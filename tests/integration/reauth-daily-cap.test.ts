import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import bcrypt from "bcryptjs";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// OTURUM İÇİ YENİDEN KİMLİK DOĞRULAMADA GÜNLÜK HATA TAVANI (09-23 saldırgan turu).
//
// Çalınmış bir oturum (parolasız) iki ekranı PAROLA TAHMİN ARACI olarak kullanabiliyordu:
//   · 2FA kurulumu (`setup`): 10 deneme / 10 dk = günde 1.440 tahmin; doğru tahmin düz metin
//     TOTP sırrını verir → saldırgan kendi uygulamasıyla 2FA'yı açıp sahibi dışarıda bırakır.
//   · hesap silme: 5 / 15 dk = günde 480 tahmin; doğru tahmin HESABI SİLER (sabotaj).
// Artık oturum başına ORTAK bir günlük tavan (20 hata) var: parola ve 2FA kodu hataları aynı
// sayaca yazılır; tavan dolunca doğru parola da o gün reddedilir. Meşru kullanıcı bu sınıra
// yaklaşmaz; bedeli yalnız oturumu ele geçirilmiş hesabın o günlük yönetim işlemleridir.
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

import { POST as twoFactor } from "@/app/api/account/2fa/route";
import { POST as deleteAccount } from "@/app/api/account/delete/route";

const PW = "dogru-parola-42";
// Maliyet 4: `verifyPassword` (giriş dışı yollar) bekletme yapmaz, yani 20 yanlış deneme
// milisaniyeler sürer. Maliyet 12 ile test zaman aşımına düşüyordu (~350 ms × 20).

function req(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Rota başına kısa pencereli kovaları boşalt (günlük sayaç KALIR). */
async function nextShortWindow() {
  await prisma.rateLimitCounter.deleteMany({
    where: { key: { in: [`2fa:${session.userId}`, `account-delete:${session.userId}`] } },
  });
  __resetRateLimit();
}

async function wrongSetupPasswords(n: number) {
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 5 === 0) await nextShortWindow();
    const res = await twoFactor(req("http://localhost/api/account/2fa", { action: "setup", password: "yanlis-parola" }));
    expect(res.status).toBe(400);
  }
  await nextShortWindow();
}

describe("oturum içi yeniden kimlik doğrulama — günlük hata tavanı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await bcrypt.hash(PW, 4), role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("2FA kurulumu: 20 hatalı paroladan sonra DOĞRU parola da sır DÖNDÜRMEZ (429)", async () => {
    await wrongSetupPasswords(20);
    const res = await twoFactor(req("http://localhost/api/account/2fa", { action: "setup", password: PW }));
    expect(res.status).toBe(429);
    expect((await res.json()).secret).toBeUndefined();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorSecret).toBeNull();
  });

  it("tavan ORTAK: kurulumda yakılan hak hesap silmeyi de kapatır (hesap SİLİNMEZ)", async () => {
    await wrongSetupPasswords(20);
    const res = await deleteAccount(req("http://localhost/api/account/delete", { password: PW }));
    expect(res.status).toBe(429);
    expect(await prisma.user.count({ where: { id: session.userId } })).toBe(1);
  });

  it("hesap silme: hatalı parolalar tavana sayılır", async () => {
    for (let i = 0; i < 20; i++) {
      if (i > 0 && i % 5 === 0) await nextShortWindow();
      const res = await deleteAccount(req("http://localhost/api/account/delete", { password: "yanlis-parola" }));
      expect(res.status).not.toBe(200);
    }
    await nextShortWindow();
    const res = await twoFactor(req("http://localhost/api/account/2fa", { action: "setup", password: PW }));
    expect(res.status).toBe(429);
  });

  it("KONTROL: 19 hatadan sonra doğru parola HÂLÂ çalışır (meşru kullanıcı erken kesilmez)", async () => {
    await wrongSetupPasswords(19);
    const res = await twoFactor(req("http://localhost/api/account/2fa", { action: "setup", password: PW }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).secret).toBe("string");
  });

  it("müşteriye giden metin sade: teknik terim yok", async () => {
    await wrongSetupPasswords(20);
    const res = await twoFactor(req("http://localhost/api/account/2fa", { action: "setup", password: PW }));
    expect(JSON.stringify(await res.json())).not.toMatch(/TOTP|kova|bucket|rate|limit/i);
  });
});
