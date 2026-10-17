import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword, verifyPasswordForLogin, dummyVerifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";
import { regenerateRecoveryCodes } from "@/lib/auth/recovery-codes";

// Avoid touching the real cookie store on the success path (not exercised here).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});

// Keep the REAL bcrypt behaviour, but make the two verify paths observable so we
// can pin the constant-time branch (dummy compare runs for an unknown email).
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    // Giriş rotası artık doğrulama + yükseltme sinyalini tek çağrıda alır (09-23, ④).
    verifyPasswordForLogin: vi.fn(actual.verifyPasswordForLogin),
    dummyVerifyPassword: vi.fn(actual.dummyVerifyPassword),
  };
});

import { setSessionCookie, setKnownDeviceCookie } from "@/lib/auth";
import { verifyPasswordForLogin as mockedVerify, dummyVerifyPassword as mockedDummy } from "@/lib/auth/password";
import { KNOWN_DEVICE_COOKIE, signKnownDeviceToken } from "@/lib/auth/known-device";
import { POST } from "@/app/api/auth/login/route";

const mockSetSession = vi.mocked(setSessionCookie);
const mockSetKnown = vi.mocked(setKnownDeviceCookie);
/** Son basılan oturum payload'ı (mock üzerinden). */
const lastSession = () => mockSetSession.mock.calls.at(-1)?.[0];

function loginReq(body: unknown, ip = "1.1.1.1", cookie?: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(cookie ? { cookie } : {}),
    },
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

  it("🚨 PAROLA KAPISI DOYGUNSA 503 + Retry-After (09-23, F4) — 500 DEĞİL, 'yanlış parola' DEĞİL", async () => {
    const { PasswordHashBusyError } = await import("@/lib/auth/password");
    vi.mocked(mockedVerify).mockRejectedValueOnce(new PasswordHashBusyError());
    const res = await POST(loginReq({ email: "musa@example.com", password: "correct-horse" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3");
    expect(mockSetSession).not.toHaveBeenCalled();
    // Bilinmeyen hesap yolu da AYNI kapıdan geçer → aynı yanıt (numaralandırma kâhini yok).
    vi.mocked(mockedDummy).mockRejectedValueOnce(new PasswordHashBusyError());
    const unknown = await POST(loginReq({ email: "yok@example.com", password: "correct-horse" }, "1.1.1.2"));
    expect(unknown.status).toBe(503);
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
    expect(vi.mocked(verifyPasswordForLogin)).not.toHaveBeenCalled();
  });

  it("known email runs the REAL verify, never the dummy", async () => {
    const res = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "7.0.0.2"));
    expect(res.status).toBe(401);
    expect(vi.mocked(verifyPasswordForLogin)).toHaveBeenCalledTimes(1);
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

  // 🚨 F8 (09-23): JSON kontrolü IP kovasından SONRA idi → başka bir site ziyaretçinin
  // tarayıcısından CORS'suz `text/plain` POST'larla kurbanın (ya da bir ofis/mobil NAT'ının)
  // IP kovasını yakıp onu 5 dk girişten dışarıda bırakabiliyordu.
  it("JSON olmayan istek 415 alır ve IP kovasını TÜKETMEZ (başkası kurbanın kovasını yakamaz)", async () => {
    for (let i = 0; i < 12; i++) {
      const r = await POST(
        new NextRequest("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "text/plain", "x-forwarded-for": "5.5.5.5" },
          body: '{"email":"musa@example.com","password":"x"}',
        }),
      );
      expect(r.status).toBe(415);
    }
    const res = await POST(loginReq({ email: "musa@example.com", password: "nope" }, "5.5.5.5"));
    expect(res.status, "text/plain istekleri kurbanın IP kovasını yaktı").toBe(401);
  });

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

  // 🚨 HESAP BAŞINA İKİNCİ-FAKTÖR KOTASI (denetim 08-09).
  //
  // `login-acct:{email}` kovası YALNIZ yanlış-PAROLA dalında tüketiliyordu;
  // ikinci faktör dalına parola DOĞRU olduğu için hiç girmiyordu. Yani 6 haneli
  // TOTP'ye karşı hesap-bazlı hiçbir sınır yoktu: parolayı ele geçiren biri
  // proxy havuzuyla per-IP limitini dolaşıp kodu kaba kuvvetle deneyebiliyordu.
  // Bahis maksimum, çünkü `mfa` iddiası artık operatör yetkisinin TEK kapısı.
  //
  // ⚠️ KURBAN KİLİTLEME RİSKİ YOK: bu dala ulaşmak DOĞRU PAROLA gerektiriyor,
  // yani kovayı yakabilen kişi zaten parolayı biliyor. (`forgot-req:{email}`
  // kovasındaki tuzak burada YOK — orası saldırganın YAZDIĞI adrese bağlı.)
  it("hesap başına ikinci-faktör denemeleri SINIRLI (farklı IP'ler dolaşamaz)", async () => {
    // Her istek FARKLI IP → per-IP kovası devre dışı; yalnız hesap kovası kalır.
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await POST(
        loginReq({ email, password: "correct-horse", code: "000000" }, `9.9.9.${i}`),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
    // ⚠️ AÇIK TIMEOUT: bu test 12 gerçek bcrypt (~350 ms) koşuyor. Tek başına
    // 5 sn'lik varsayılana sığıyor, TAM SUITE yükünde sığmıyordu (ölçüldü).
  }, 60_000);

  // 🚨 KOTA KURTARMA KODU DALINI DA KAPSAR (savunmacı denetim 08-09).
  // Ölçüldü: kotayı TOTP dalının içine taşımak testleri YEŞİL bırakıyordu —
  // yeni test yalnız `code` gönderiyordu. Kurtarma kodu da ikinci faktördür ve
  // aynı bütçeden harcanmalı; ayrıksa kaba kuvvet oradan devam eder.
  it("kurtarma kodu denemeleri AYNI kotadan harcanır", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await POST(
        loginReq({ email, password: "correct-horse", recoveryCode: "AAAA-BBBB-CCCC" }, `9.6.6.${i}`),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  }, 60_000);

  it("429 metni SÜREYİ söyler ve kurtarma kodu YAKILMAZ", async () => {
    // Depo kuralı (08-07): genel "kısa bir süre" metni kullanıcıyı boşuna
    // tekrar denemeye itiyor. Pencere 10 dk ve kişi KENDİ hesabına giremiyor.
    let body: { error?: string } = {};
    for (let i = 0; i < 12; i++) {
      const res = await POST(loginReq({ email, password: "correct-horse", code: "000000" }, `9.7.7.${i}`));
      if (res.status === 429) body = await res.json();
    }
    expect(body.error).toMatch(/dakika/);
  }, 60_000);

  it("KONTROL: kota dolmadan DOĞRU kod hâlâ kabul edilir", async () => {
    // Bu olmadan "her ikinci faktörü 429'la" mutasyonu da yeşil geçerdi.
    const res = await POST(loginReq({ email, password: "correct-horse", code: totp(secret) }, "9.8.0.1"));
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRequired).toBeUndefined();
  });

  // 🚨 GÜNLÜK BAŞARISIZ-TOTP TAVANI (09-23, login ajanı F3). 10/10 dk kovasının TOPLAM
  // tavanı yoktu: günde 1.440 deneme → parolayı bilen için kodu bulma olasılığı 30 günde
  // ~%12, bir yılda ~%79. 10 dk kovasının geçmesini sayaç satırını silerek taklit ediyoruz.
  it("🚨 10 dk kovası sıfırlansa da 20 HATALI koddan sonra DOĞRU kod bile 429 alır", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    for (let i = 0; i < 20; i++) {
      if (i % 10 === 0) await prisma.rateLimitCounter.deleteMany({ where: { key: `login-2fa:${u.id}` } });
      const r = await POST(loginReq({ email, password: "correct-horse", code: "000000" }, `9.3.0.${i}`));
      expect(r.status, `deneme ${i + 1}`).toBe(401);
    }
    await prisma.rateLimitCounter.deleteMany({ where: { key: `login-2fa:${u.id}` } }); // "10 dk geçti"
    const res = await POST(loginReq({ email, password: "correct-horse", code: totp(secret) }, "9.4.0.1"));
    expect(res.status, "günlük tavan yok — TOTP sınırsız kaba kuvvete açık").toBe(429);
    expect((await res.json()).error).toMatch(/kurtarma kodu/);
  }, 120_000);

  it("günlük tavan BAŞARILI kodu saymaz (çok giriş yapan meşru kullanıcı kilitlenmez)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    for (let i = 0; i < 3; i++) {
      // Her girişte yeni bir zaman adımı gerekir; adım yakımını sıfırlayarak aynı kodu yeniden geçerli kılıyoruz.
      await prisma.user.update({ where: { id: u.id }, data: { twoFactorLastStep: null } });
      const r = await POST(loginReq({ email, password: "correct-horse", code: totp(secret) }, `9.4.1.${i}`));
      expect(r.status).toBe(200);
    }
    const row = await prisma.rateLimitCounter.findUnique({ where: { key: `login-2fa-fail-day:${u.id}` } });
    expect(row, "başarılı kod günlük BAŞARISIZLIK sayacına yazıldı").toBeNull();
  }, 60_000);

  it("günlük tavan KURTARMA KODUNU engellemez (telefonunu kaybeden kullanıcı 24 saat kilitlenmez)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const codes = await regenerateRecoveryCodes(u.id);
    // Günlük TOTP tavanını doğrudan doldur (20 hata = tavan).
    await prisma.rateLimitCounter.create({
      data: { key: `login-2fa-fail-day:${u.id}`, count: 20, resetAt: new Date(Date.now() + 86_400_000) },
    });
    const totpTry = await POST(loginReq({ email, password: "correct-horse", code: totp(secret) }, "9.4.2.1"));
    expect(totpTry.status, "anti-vakumluk: tavan gerçekten dolu").toBe(429);
    const rec = await POST(loginReq({ email, password: "correct-horse", recoveryCode: codes[0] }, "9.4.2.2"));
    expect(rec.status).toBe(200);
  });

  it("hatalı ikinci-adım denemesi İZ bırakır: auth.2fa_failed (eskiden sessizdi)", async () => {
    await POST(loginReq({ email, password: "correct-horse", code: "000000" }, "9.5.0.1"));
    await POST(loginReq({ email, password: "correct-horse", recoveryCode: "AAAA-BBBB-CCCC" }, "9.5.0.2"));
    const rows = await prisma.auditLog.findMany({ where: { action: "auth.2fa_failed" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => JSON.parse(r.metadataJson ?? "{}").method)).toEqual(["totp", "recovery"]);
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
//   1. DOĞRU parola sahibi hesap kovası yüzünden kendi CİHAZINDA kilitlenmez.
//   2. IP limiti aynen korunur (her istekte tüketilir).
//   3. BAŞARISIZ hesap denemeleri yine sınırlandırılır (tavanı aşınca 429).
//
// 🚨 09-23 GÜNCELLEMESİ (login ajanı F1, ölçüldü): 1. madde eskiden "doğru parola
// HER YERDEN girer" idi ve bu, IP döndüren saldırgan için kovayı İŞLEVSİZ bırakıyordu
// (tek fren bcrypt hızı: günde ~270 bin tahmin; modelde doğru parola 4.322. denemede
// kabul edildi). Artık kova DOLUYKEN parola denemesine yalnız o hesaba daha önce
// BAŞARIYLA girmiş tarayıcı (tanınan cihaz çerezi) devam eder. 08-01'in özü korunur —
// saldırgan sahibi kendi cihazından kilitleyemez; bedeli: saldırı sürerken sahibin
// YENİ bir cihazı pencere dolana kadar bekler (aşağıda iki yönlü pinli).
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

  /** Kurbanın daha önce başarıyla girdiği tarayıcının çerezi (gerçek imzalı token). */
  async function victimKnownDeviceCookie() {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: VICTIM } });
    return `${KNOWN_DEVICE_COOKIE}=${await signKnownDeviceToken(u.id, u.sessionEpoch)}`;
  }

  it("saldırgan kovayı doldursa bile DOĞRU parola sahibi KENDİ CİHAZINDAN GİRER", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "9.9.9"); // tavan 20 → kova taşmış durumda

    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.2", await victimKnownDeviceCookie()));
    expect(res.status).toBe(200); // ⬅️ 08-01 ARIZASINDA 429 idi (kurban kilitliydi)
  });

  it("🚨 kova doluyken TANINMAYAN cihaz DOĞRU parolayla bile 429 alır ve bcrypt'e ULAŞMAZ (F1)", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "9.9.8");
    vi.mocked(mockedVerify).mockClear();
    vi.mocked(mockedDummy).mockClear();

    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.3"));
    expect(res.status, "doğru parola tanınmayan cihazdan kabul edildi — kaba kuvvet kovası işlevsiz").toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    // Kapı bcrypt'ten ÖNCE: IP döndüren saldırgan sunucunun CPU'sunu da yakamaz.
    expect(mockedVerify).not.toHaveBeenCalled();
    expect(mockedDummy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it("SINIR: 19 hatada kapı AÇIK, 20. hatadan sonra KAPALI (peek = tüketimle aynı eşik)", { timeout: 90_000 }, async () => {
    // Eski davranışta 20 hataya 401, 21.'ye 429 verilir; kapı da tam oradan kapanmalı —
    // `<` yerine `<=` bir fazla denemeye, `<`in bir eksiği erken kilitlemeye yol açar.
    await attackerFailures(19, "9.9.4");
    const open = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.3.1"));
    expect(open.status, "19 hatada kapı ERKEN kapandı").toBe(200);
    await POST(loginReq({ email: VICTIM, password: "wrong-20" }, "9.9.4.200")); // 20. hata
    const closed = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.3.2"));
    expect(closed.status, "20 hatadan sonra kapı AÇIK kaldı").toBe(429);
  });

  it("BAŞKA kullanıcının tanınan-cihaz çerezi işe yaramaz", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "9.9.7");
    const other = await prisma.user.create({
      data: {
        organizationId: (await prisma.organization.findFirstOrThrow()).id,
        name: "Saldırgan",
        email: "attacker@example.com",
        passwordHash: await hashPassword("x-pass-123"),
        role: "owner",
        emailVerifiedAt: new Date(),
      },
    });
    const foreign = `${KNOWN_DEVICE_COOKIE}=${await signKnownDeviceToken(other.id, other.sessionEpoch)}`;
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.4", foreign));
    expect(res.status).toBe(429);
  });

  it("şifre değişimi/sıfırlama (sessionEpoch) eski tanınan-cihaz çerezini düşürür", { timeout: 60_000 }, async () => {
    const stale = await victimKnownDeviceCookie();
    await prisma.user.update({ where: { email: VICTIM }, data: { sessionEpoch: { increment: 1 } } });
    await attackerFailures(21, "9.9.6");
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.5", stale));
    expect(res.status).toBe(429);
  });

  it("kova doluyken BİLİNMEYEN e-posta da AYNI hızlı 429'u alır (sayım sızıntısı yok)", { timeout: 60_000 }, async () => {
    const GHOST = "ghost-fill@example.com";
    for (let i = 0; i < 21; i++) await POST(loginReq({ email: GHOST, password: `w${i}` }, `9.9.5.${i % 250}`));
    vi.mocked(mockedDummy).mockClear();
    const res = await POST(loginReq({ email: GHOST, password: "whatever" }, "2.2.2.6"));
    expect(res.status).toBe(429);
    expect(mockedDummy).not.toHaveBeenCalled(); // var olan hesapla AYNI yol: bcrypt yok
  });

  it("kova DOLU DEĞİLKEN tanınmayan cihaz normal girer (olağan giriş etkilenmez)", async () => {
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.7"));
    expect(res.status).toBe(200);
  });

  it("başarılı giriş TANINAN CİHAZ çerezini yazar (kullanıcı + güncel oturum epoch'u)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: VICTIM } });
    const res = await POST(loginReq({ email: VICTIM, password: GOOD }, "2.2.2.8"));
    expect(res.status).toBe(200);
    expect(mockSetKnown).toHaveBeenCalledTimes(1);
    expect(mockSetKnown).toHaveBeenCalledWith(u.id, u.sessionEpoch);
  });

  it("yanlış parola TANINAN CİHAZ çerezi YAZMAZ", async () => {
    await POST(loginReq({ email: VICTIM, password: "nope" }, "2.2.2.9"));
    expect(mockSetKnown).not.toHaveBeenCalled();
  });

  it("BAŞARISIZ denemeler yine sınırlandırılır (koruma kaybolmadı)", { timeout: 60_000 }, async () => {
    await attackerFailures(21, "8.8.8");

    // Aynı hesaba yeni bir hatalı deneme: artık 401 değil 429.
    const res = await POST(loginReq({ email: VICTIM, password: "still-wrong" }, "3.3.3.3"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  // 11 ardışık maliyet-12 bcrypt (~320 ms) tek başına ~3,8 sn — tam koşu yükünde 5 sn'yi aştı (09-24 kapısı); kardeşi gibi 30 sn.
  it("IP limiti KORUNUR (aynı IP'den 11. istek 429)", { timeout: 30_000 }, async () => {
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
