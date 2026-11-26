import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { hashPassword, PasswordHashBusyError } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// F1 (Codex 11-17) — HESAP KOVASI EŞZAMANLI İSTEKTE DE BÜTÇEDİR. Gerçek PostgreSQL.
//
// Kova eskiden doğrulamadan ÖNCE yalnız OKUNUYOR (sayaç < 20 mi), sayaç yalnız başarısız bcrypt'ten SONRA artıyordu. "Oku → bcrypt →
// artır" arasındaki süre (bcrypt + parola kapısının kuyruğu, saniyeler) boyunca gelen her istek kapıyı aynı eski sayaçla geçiyordu: IP
// döndüren saldırgan bir dalgada sınırın ~2,7 katı tahmin yapabiliyor, sınır dalgasında DOĞRU parola tanınmayan cihazdan girebiliyordu
// (09-23 kararı "kova doluyken yalnız tanınan cihaz" delinir). Şimdi hak bcrypt'ten ÖNCE atomik ayrılır; doğru parolada (ve doğrulama
// hiç yapılamadıysa) iade edilir — iade yalnız ayrıldığı pencereye.
//
// Araya girme ZAMANLA değil SÖZLE kurulur: parola doğrulaması bir engel sözünü bekler; testler istekleri engelde tutup sayacı okur.
// ⚠️ Ayrı dosya: taklitler ve engel durumu başka dosyalara sızmasın.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitReleaseReservation: vi.fn(actual.rateLimitReleaseReservation),
    rateLimitTouch: vi.fn(actual.rateLimitTouch),
  };
});

/** Doğrulamaya (gerçek ya da sahte bcrypt) GİREN istek sayısı. */
let entered = 0;
let gated = false;
let openGate: () => void = () => {};
let gate: Promise<void> = Promise.resolve();
/** Engeldeyken çalıştırılacak bir kez kanca (pencere sıfırlanması gibi araya girmeler için). */
let onEnter: (() => Promise<void>) | null = null;

vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    vi.fn(async (...a: A): Promise<R> => {
      entered++;
      if (onEnter) {
        const hook = onEnter;
        onEnter = null;
        await hook();
      }
      if (gated) await gate;
      return fn(...a);
    });
  return {
    ...actual,
    verifyPasswordForLogin: wrap(actual.verifyPasswordForLogin),
    dummyVerifyPassword: wrap(actual.dummyVerifyPassword),
  };
});

import { setSessionCookie } from "@/lib/auth";
import { verifyPasswordForLogin as mockedVerify } from "@/lib/auth/password";
import { POST } from "@/app/api/auth/login/route";
import { __resetRateLimit, rateLimit, rateLimitReserve, rateLimitReleaseReservation, rateLimitTouch } from "@/lib/rate-limit";
import { KNOWN_DEVICE_COOKIE, signKnownDeviceToken } from "@/lib/auth/known-device";

const VICTIM = "musa@example.com";
const GOOD = "correct-horse";
const KEY = `login-acct:${VICTIM}`;
const WINDOW_MS = 15 * 60 * 1000;
const mockSetSession = vi.mocked(setSessionCookie);

function loginReq(body: unknown, ip: string, cookie?: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function seedCount(count: number) {
  await prisma.rateLimitCounter.create({ data: { key: KEY, count, resetAt: new Date(Date.now() + WINDOW_MS) } });
}
/** Sayaç satırı yoksa 0 (hiç hak ayrılmamış ile ayrılıp iade edilmiş aynı bütçeyi taşır). */
const counter = async () => (await prisma.rateLimitCounter.findUnique({ where: { key: KEY } }))?.count ?? 0;

const row = () => prisma.rateLimitCounter.findUniqueOrThrow({ where: { key: KEY } });
async function knownDeviceCookie() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: VICTIM } });
  return `${KNOWN_DEVICE_COOKIE}=${await signKnownDeviceToken(u.id, u.sessionEpoch)}`;
}

function armGate() {
  gated = true;
  gate = new Promise<void>((r) => (openGate = r));
}

describe("login — hesap kovası eşzamanlı istekte de bütçe (F1)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    entered = 0;
    gated = false;
    onEnter = null;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await makeUser({
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

  it("🚨 sayaç 18 iken AYNI ANDA 6 yanlış parola (farklı IP'ler): yalnız 2'si doğrulamaya girer, kalanı bcrypt'siz 429", { timeout: 30_000 }, async () => {
    await seedCount(18);
    armGate();
    let done = 0;
    const reqs = Array.from({ length: 6 }, (_, i) =>
      POST(loginReq({ email: VICTIM, password: `wrong-${i}` }, `9.8.7.${i}`)).then((r) => {
        done++;
        return r;
      }),
    );
    // Herkes ya engelde ya da cevabını almış olana kadar bekle (eski kodda 6'sı da engelde — sayaç hâlâ 18 göründüğü için).
    await vi.waitFor(() => expect(entered + done).toBe(6), { timeout: 10_000 });
    expect(entered, "eşzamanlı istekler kovayı aynı eski sayaçla geçti — sınır bütçe değil").toBe(2);
    openGate();
    const statuses = (await Promise.all(reqs)).map((r) => r.status).sort();
    expect(statuses).toEqual([401, 401, 429, 429, 429, 429]);
    expect(await counter()).toBeGreaterThanOrEqual(20);
  });

  it("🚨 sayaç 19 + engelde bekleyen bir yanlış deneme varken DOĞRU parola tanınmayan cihazdan 429 alır (09-23 kararı dalga içinde delinmez)", { timeout: 30_000 }, async () => {
    await seedCount(19);
    armGate();
    let done = 0;
    const track = (p: Promise<Response>) =>
      p.then((r) => {
        done++;
        return r;
      });
    const wrong = track(POST(loginReq({ email: VICTIM, password: "wrong-x" }, "9.8.6.1")));
    await vi.waitFor(() => expect(entered).toBe(1), { timeout: 10_000 }); // yanlış deneme engelde (hakkını ayırdı)
    const good = track(POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.6.1")));
    await vi.waitFor(() => expect(entered + done).toBe(2), { timeout: 10_000 });
    openGate();
    const [w, g] = await Promise.all([wrong, good]);
    expect(g.status, "doğru parola, kova o anda dolmuşken tanınmayan cihazdan kabul edildi").toBe(429);
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(w.status).toBe(401);
  });

  it("KONTROL — sahip sırayla 1 yanlış + 1 doğru: 200 ve sayaç 1 (yanlışın hakkı tutulur, doğru deneme iade edilir)", { timeout: 30_000 }, async () => {
    expect((await POST(loginReq({ email: VICTIM, password: "nope" }, "3.3.1.1"))).status).toBe(401);
    expect((await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.1.2"))).status).toBe(200);
    expect(await counter()).toBe(1);
  });

  it("KONTROL — sayaç 0 iken AYNI ANDA iki doğru giriş: ikisi de 200, sayaç 0", { timeout: 30_000 }, async () => {
    const [a, b] = await Promise.all([
      POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.2.1")),
      POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.2.2")),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await counter()).toBe(0);
  });

  it("KONTROL — sayaç 19 iken doğru giriş (tanınmayan cihaz) 200; sayaç 19'da kalır", { timeout: 30_000 }, async () => {
    await seedCount(19);
    expect((await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.3.1"))).status).toBe(200);
    expect(await counter()).toBe(19);
  });

  it("doğrulama YAPILAMAZSA (parola kapısı doygun → 503) ayrılan hak iade edilir: sayaç değişmez", async () => {
    await seedCount(5);
    vi.mocked(mockedVerify).mockRejectedValueOnce(new PasswordHashBusyError());
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.4.1"));
    expect(res.status).toBe(503);
    expect(await counter()).toBe(5);
  });

  it("doğrulama yapılamazsa bilinmeyen e-postada da iade edilir (iki yol aynı davranır)", async () => {
    const { dummyVerifyPassword } = await import("@/lib/auth/password");
    vi.mocked(dummyVerifyPassword).mockRejectedValueOnce(new PasswordHashBusyError());
    const res = await POST(loginReq({ email: "yok@example.com", password: "x-pass-1" }, "3.3.4.2"));
    expect(res.status).toBe(503);
    const row = await prisma.rateLimitCounter.findUnique({ where: { key: "login-acct:yok@example.com" } });
    expect(row?.count ?? 0).toBe(0);
  });

  it("🚨 iade AYRILDIĞI PENCEREYE yapılır: doğrulama sürerken pencere sıfırlanıp yeni pencerede bir hata sayıldıysa, doğru girişin iadesi YENİ sayacı düşürmez", { timeout: 30_000 }, async () => {
    await seedCount(3);
    // Doğru girişin hakkı eski pencerede ayrıldı (sayaç 4). Doğrulama sürerken: eski pencere biter, yeni pencerede bir hata sayılır (1).
    onEnter = async () => {
      await prisma.rateLimitCounter.update({ where: { key: KEY }, data: { resetAt: new Date(Date.now() - 1_000) } });
      await rateLimit(KEY, 20, WINDOW_MS);
    };
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.5.1"));
    expect(res.status).toBe(200);
    expect(await counter(), "iade yeni pencerenin sayacını düşürdü — sınır gevşedi").toBe(1);
  });

  it("🚨 C-2: dolu kovada reddedilen istekler pencereyi UZATMAZ (resetAt aynı); pencere bitince ilk istek yine doğrulamaya girer", { timeout: 30_000 }, async () => {
    await seedCount(20);
    const before = (await row()).resetAt.getTime();
    for (let i = 0; i < 4; i++) {
      expect((await POST(loginReq({ email: VICTIM, password: `w-${i}` }, `9.8.5.${i}`))).status).toBe(429);
    }
    expect(entered).toBe(0); // dolu kovada bcrypt'e ulaşılmadı
    const after = await row();
    expect(after.resetAt.getTime(), "reddedilen istekler pencereyi uzattı — kurban süresiz kilitlenebilir").toBe(before);
    expect(after.count).toBe(24); // sayıldılar (sınırın üstünde), ama pencere sabit
    await prisma.rateLimitCounter.update({ where: { key: KEY }, data: { resetAt: new Date(Date.now() - 1_000) } }); // pencere bitti
    expect((await POST(loginReq({ email: VICTIM, password: "w-new" }, "9.8.5.9"))).status).toBe(401);
    expect((await row()).count).toBe(1);
  });

  it("C-3: tanınan cihaz + dolu kova + DOĞRU parola → girer ve hakkını iade eder (sayaç önceki değerine döner)", { timeout: 30_000 }, async () => {
    await seedCount(25);
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.6.1", await knownDeviceCookie()));
    expect(res.status).toBe(200);
    expect(await counter()).toBe(25);
    expect(vi.mocked(rateLimitReleaseReservation)).toHaveBeenCalledTimes(1); // başarı dalında TEK iade
  });

  it("C-3: tanınan cihaz + dolu kova + YANLIŞ parola → 429, iade YOK (hata sayılır)", { timeout: 30_000 }, async () => {
    await seedCount(25);
    const res = await POST(loginReq({ email: VICTIM, password: "yanlis" }, "3.3.6.2", await knownDeviceCookie()));
    expect(res.status).toBe(429);
    expect(entered).toBe(1); // tanınan cihaz doğrulamaya girdi
    expect(await counter()).toBe(26);
    expect(vi.mocked(rateLimitReleaseReservation)).not.toHaveBeenCalled();
  });

  it("C-3: başarılı girişte iade TAM BİR kez çağrılır; başarısız girişte hiç çağrılmaz", { timeout: 30_000 }, async () => {
    await POST(loginReq({ email: VICTIM, password: "yanlis" }, "3.3.7.1"));
    expect(vi.mocked(rateLimitReleaseReservation)).not.toHaveBeenCalled();
    await POST(loginReq({ email: VICTIM, password: GOOD }, "3.3.7.2"));
    expect(vi.mocked(rateLimitReleaseReservation)).toHaveBeenCalledTimes(1);
    expect(await counter()).toBe(1);
  });

  it("C-1 (c): parite yazması sayacın DEĞERİNİ ve penceresini değiştirmez; başarısız girişte tam bir kez yapılır", { timeout: 30_000 }, async () => {
    await seedCount(5);
    const before = await row();
    await rateLimitTouch(KEY);
    const after = await row();
    expect(after.count).toBe(before.count);
    expect(after.resetAt.getTime()).toBe(before.resetAt.getTime());
    vi.mocked(rateLimitTouch).mockClear();
    expect((await POST(loginReq({ email: VICTIM, password: "yanlis" }, "3.3.8.1"))).status).toBe(401);
    expect(vi.mocked(rateLimitTouch)).toHaveBeenCalledTimes(1);
    expect(await counter()).toBe(6); // yalnız ayırma saydı
  });

  it("iade sayacı sıfırın ALTINA indirmez (aynı pencerede sayaç başka yoldan sıfırlanmışsa)", async () => {
    const r = await rateLimitReserve(KEY, 20, WINDOW_MS);
    expect(r.reservation?.store).toBe("db");
    await prisma.rateLimitCounter.update({ where: { key: KEY }, data: { count: 0 } });
    await rateLimitReleaseReservation(r.reservation);
    expect((await row()).count).toBe(0);
  });
});
