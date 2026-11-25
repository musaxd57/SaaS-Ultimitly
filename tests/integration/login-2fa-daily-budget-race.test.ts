import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// GÜNLÜK HATALI-TOTP TAVANI EŞZAMANLI İSTEKTE DE KESİN (Codex 11-25, kurucu talimatı 2026-11-25). Gerçek PostgreSQL.
//
// Tavan eskiden doğrulamadan ÖNCE yalnız OKUNUYOR (sayaç < 20 mi), sayaç yalnız hatalı koddan SONRA artıyordu: "oku → doğrula → artır"
// arasında gelen istekler kapıyı aynı eski sayaçla geçiyordu (günlük tavan kesin değil; 10 dk kovası aşımı sınırlıyordu). Şimdi hak
// doğrulamadan ÖNCE atomik ayrılır (giriş hesap kovasının F1 emsali, `login-account-budget-race.test.ts`); doğru kodda ve doğrulama hiç
// yapılamadıysa iade edilir, tavan doluyken reddedilen istek sayılmaz.
//
// Araya girme ZAMANLA değil SÖZLE kurulur: günlük tavan denetimi (okuma ya da ayırma — hangisi kullanılıyorsa) gerçek sonucu aldıktan sonra
// bir engel sözünü bekler; bütün istekler denetimden geçene kadar hiçbiri sayaca hata yazamaz. Eski kodda bu, yarışı kesin kılar; atomik
// ayırmada etkisizdir (karar ayırma anında verilmiş olur). ⚠️ Ayrı dosya: taklitler başka dosyalara sızmasın.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});

const DAY_PREFIX = "login-2fa-fail-day:";
let arrived = 0;
let gated = false;
let openGate: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

vi.mock("@/lib/rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/lib/rate-limit")>();
  const atDayCheck = <A extends [string, ...unknown[]], R>(fn: (...a: A) => Promise<R>) =>
    vi.fn(async (...a: A): Promise<R> => {
      const r = await fn(...a);
      if (String(a[0]).startsWith(DAY_PREFIX)) {
        arrived++;
        if (gated) await gate;
      }
      return r;
    });
  return {
    ...actual,
    rateLimitPeek: atDayCheck(actual.rateLimitPeek),
    rateLimitReserve: atDayCheck(actual.rateLimitReserve),
  };
});

import { POST } from "@/app/api/auth/login/route";
import { __resetRateLimit } from "@/lib/rate-limit";

const EMAIL = "tf-race@example.com";
const PASSWORD = "correct-horse";
const DAY_MS = 24 * 60 * 60 * 1000;
let secret: string;
let dayKey: string;

const loginReq = (body: unknown, ip: string) =>
  new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
const dayCount = async () => (await prisma.rateLimitCounter.findUnique({ where: { key: dayKey } }))?.count ?? 0;
/** Kesin YANLIŞ 6 haneli kod: kabul penceresindeki (±1 adım) ve adım dönümüne karşı ±2 adımdaki bütün geçerli kodlardan ayrık seçilir. */
function wrongCode(): string {
  const valid = new Set([-60_000, -30_000, 0, 30_000, 60_000].map((d) => totp(secret, Date.now() + d)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
}

describe("login — günlük hatalı-TOTP tavanı eşzamanlı istekte de kesin", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    arrived = 0;
    gated = false;
    secret = generateSecret();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const u = await makeUser({
      data: {
        organizationId: org.id,
        name: "TF",
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        role: "owner",
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    dayKey = `${DAY_PREFIX}${u.id}`;
  });

  it("🚨 sayaç 18 iken AYNI ANDA 5 yanlış kod (farklı IP'ler): yalnız 2'si doğrulanır (401), kalanı 429; sayaç tam 20", { timeout: 60_000 }, async () => {
    await prisma.rateLimitCounter.create({ data: { key: dayKey, count: 18, resetAt: new Date(Date.now() + DAY_MS) } });
    gated = true;
    gate = new Promise<void>((r) => (openGate = r));
    const code = wrongCode();
    let done = 0;
    const reqs = Array.from({ length: 5 }, (_, i) =>
      POST(loginReq({ email: EMAIL, password: PASSWORD, code }, `9.7.5.${i}`)).then((r) => {
        done++;
        return r;
      }),
    );
    // Herkes günlük tavan denetimine ulaşana kadar bekle (eski kodda hiçbiri henüz hata yazmadı → hepsi 18 görür).
    await vi.waitFor(() => expect(arrived).toBe(5), { timeout: 30_000 });
    expect(done).toBe(0);
    openGate();
    const statuses = (await Promise.all(reqs)).map((r) => r.status).sort();
    expect(statuses, "eşzamanlı istekler günlük tavanı aynı eski sayaçla geçti").toEqual([401, 401, 429, 429, 429]);
    expect(await dayCount()).toBe(20);
  });

  it("KONTROL: DOĞRU kod günlük bütçeyi harcamaz (hak iade edilir) ve tavan dolmadan kabul edilir", { timeout: 30_000 }, async () => {
    await prisma.rateLimitCounter.create({ data: { key: dayKey, count: 19, resetAt: new Date(Date.now() + DAY_MS) } });
    const res = await POST(loginReq({ email: EMAIL, password: PASSWORD, code: totp(secret) }, "9.7.6.1"));
    expect(res.status).toBe(200);
    expect(await dayCount()).toBe(19);
  });

  it("KONTROL: tavan doluyken reddedilen istek (doğrulama YOK) sayaca yazılmaz; hatalı kod tam bir hata sayar", { timeout: 30_000 }, async () => {
    await prisma.rateLimitCounter.create({ data: { key: dayKey, count: 19, resetAt: new Date(Date.now() + DAY_MS) } });
    expect((await POST(loginReq({ email: EMAIL, password: PASSWORD, code: wrongCode() }, "9.7.7.1"))).status).toBe(401);
    expect(await dayCount()).toBe(20);
    expect((await POST(loginReq({ email: EMAIL, password: PASSWORD, code: totp(secret) }, "9.7.7.2"))).status).toBe(429);
    expect(await dayCount()).toBe(20);
  });
  it("aynı geçerli kodun İKİNCİ kullanımı (tekrar oynatma) hatalı denemedir: 401 ve günlük sayaç tam bir artar", { timeout: 30_000 }, async () => {
    // Aynı kod dizesi iki kez: adım dönümüne denk gelse de ikinci istek AYNI adımı yakmaya çalışır (kabul penceresi ±1 adım).
    const code = totp(secret);
    const first = await POST(loginReq({ email: EMAIL, password: PASSWORD, code }, "9.7.9.1"));
    expect(first.status).toBe(200);
    expect(await dayCount()).toBe(0); // doğru kod hakkı iade etti
    const replay = await POST(loginReq({ email: EMAIL, password: PASSWORD, code }, "9.7.9.2"));
    expect(replay.status).toBe(401);
    expect(await dayCount()).toBe(1); // tekrar oynatma hakkı HARCAR (iade edilmez)
  });
  it("KONTROL: doğrulama TAMAMLANAMAZSA (adım yakımı veritabanı hatası) hak iade edilir — hata sayılmaz", { timeout: 30_000 }, async () => {
    await prisma.rateLimitCounter.create({ data: { key: dayKey, count: 5, resetAt: new Date(Date.now() + DAY_MS) } });
    const spy = vi.spyOn(prisma.user, "updateMany").mockRejectedValueOnce(new Error("connection lost (test)"));
    try {
      const res = await POST(loginReq({ email: EMAIL, password: PASSWORD, code: totp(secret) }, "9.7.8.1"));
      expect(spy).toHaveBeenCalledTimes(1); // casus boşa kurulmadı: istek adım yakımına ulaştı
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await dayCount()).toBe(5);
  });
});
