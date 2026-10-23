import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// "BENİ HATIRLA" ÇIKIŞI AŞAR — UÇTAN UCA (kullanıcı kararı, 09-07)
//
// Gerçek login + logout rotaları, gerçek DB, gerçek TOTP; yalnız tarayıcının
// çerez kavanozu sahte (next/headers `cookies()` → Map). Ölçülen davranış:
//   1) 2FA'lı hesap parola+kod+"hatırla" ile girer → güven çerezi yazılır,
//   2) çıkış yapar → oturum çerezi düşer, güven çerezi DURUR,
//   3) yalnız parolayla yeniden girer → KOD İSTENMEZ (`ok:true`),
//   4) KONTROL: şifre değişimi (`sessionEpoch` artışı) sonrası güven ÖLÜR →
//      kod yine istenir (S2 korunuyor; "asla kod isteme" aşırı-uygulaması kırmızı).
// ---------------------------------------------------------------------------
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { TRUSTED_DEVICE_COOKIE } from "@/lib/auth/trusted-device";
import { SESSION_COOKIE } from "@/lib/auth/session";

const EMAIL = "remember@example.com";
const PW = "correct-horse-9";
let secret = "";
let userId = "";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.9" },
    body: JSON.stringify(body),
  });
}

describe("beni hatırla → çıkış → yeniden giriş", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    jar.clear();
    secret = generateSecret();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "R",
        email: EMAIL,
        passwordHash: await hashPassword(PW),
        role: "owner",
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date("2026-01-01T00:00:00Z"),
        emailVerifiedAt: new Date(),
        sessionEpoch: 3,
      },
    });
    userId = user.id;
  });

  it("🚨 hatırlanan cihaz çıkıştan sonra da kod istemez; şifre değişimi güveni düşürür (kontrol)", async () => {
    // 1) parola → kod istenir
    expect(await (await login(req({ email: EMAIL, password: PW }))).json()).toMatchObject({ twoFactorRequired: true });
    // 2) parola + kod + hatırla → giriş + güven çerezi
    const r2 = await login(req({ email: EMAIL, password: PW, code: totp(secret), rememberDevice: true }));
    expect(await r2.json()).toMatchObject({ ok: true });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(jar.has(TRUSTED_DEVICE_COOKIE)).toBe(true);

    // 3) çıkış → oturum düşer, güven DURUR
    await logout();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(TRUSTED_DEVICE_COOKIE)).toBe(true); // ⬅️ 08-09 hâlinde siliniyordu

    // 4) yalnız parola → KOD İSTENMEZ
    const r4 = await (await login(req({ email: EMAIL, password: PW }))).json();
    expect(r4).toMatchObject({ ok: true }); // ⬅️ ARIZADA: { twoFactorRequired: true }
    expect(jar.has(SESSION_COOKIE)).toBe(true);

    // 5) KONTROL — şifre değişimi (epoch artışı) güveni ÖLDÜRÜR: kod yine istenir.
    await logout();
    await prisma.user.update({ where: { id: userId }, data: { sessionEpoch: { increment: 1 } } });
    const r5 = await (await login(req({ email: EMAIL, password: PW }))).json();
    expect(r5).toMatchObject({ twoFactorRequired: true });
  });

  it("KONTROL: kutu İŞARETLENMEDİYSE çıkış sonrası kod yine istenir (normal 2FA)", async () => {
    await login(req({ email: EMAIL, password: PW, code: totp(secret) })); // rememberDevice yok
    expect(jar.has(TRUSTED_DEVICE_COOKIE)).toBe(false);
    await logout();
    const r = await (await login(req({ email: EMAIL, password: PW }))).json();
    expect(r).toMatchObject({ twoFactorRequired: true });
  });
});
