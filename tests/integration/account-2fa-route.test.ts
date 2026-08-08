import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// requireSession reads the cookie in production; mock it to our seeded user so we
// can drive the route handler directly.
let session: SessionPayload;
/** `setup` yeniden kimlik doğrulama istiyor — tüm testler bu şifreyi kullanır. */
const SETUP_PW = "dogru-sifre-42";
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/account/2fa/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/2fa", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      // 🚨 GERÇEK HASH ŞART: `setup` artık yeniden kimlik doğrulama istiyor
      // (denetim 08-09) ve `verifyPassword` sahte bir hash'te DAİMA false döner.
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword(SETUP_PW), role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  // -------------------------------------------------------------------------
  // IMPERSONATION KAPISI (derin denetim, 2026-08-01).
  //
  // Impersonation'da oturum MÜŞTERİNİN kullanıcısıyla imzalanır. Kapı olmadan
  // operatör, 2FA'sı kapalı bir müşteri hesabında `setup` ile gizli anahtarı
  // DÜZ METİN olarak alıp `enable` ile etkinleştirebiliyordu; kurtarma kodları
  // da `enable` içinde silindiği için müşteri kendi hesabına bir daha giremez
  // ve erişimi tamamen operatöre bağlı hâle gelirdi. Oturum bittikten sonra da
  // yaşayan KALICI bir kimlik bilgisi yaratmak impersonation modelinin dışıdır;
  // aynı kapı `account/delete` rotasında zaten vardı (emsal).
  // -------------------------------------------------------------------------
  const IMPERSONATED_ACTIONS = ["setup", "enable", "disable", "recovery_codes"] as const;
  for (const action of IMPERSONATED_ACTIONS) {
    it(`impersonation altında '${action}' REDDEDİLİR (403)`, async () => {
      session = { ...session, actorUserId: "operator-1", actorEmail: "op@lixusai.com" };
      const res = await POST(req({ action, code: "123456" }));
      expect(res.status).toBe(403);
      // Hiçbir kimlik bilgisi yaratılmadı.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
      expect(after.twoFactorSecret).toBeNull();
      expect(after.twoFactorEnabledAt).toBeNull();
    });
  }

  it("impersonation yokken 'setup' NORMAL çalışır (regresyon pini)", async () => {
    const res = await POST(req({ action: "setup", password: SETUP_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe("string");
  });

  it("rejects 'setup' when 2FA is already active — never silently disables it", async () => {
    // 2FA is live on this account.
    await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: encryptSecret("ABCDEFGHIJKLMNOP"), twoFactorEnabledAt: new Date() },
    });

    const res = await POST(req({ action: "setup", password: SETUP_PW }));
    expect(res.status).toBe(400);

    // The enabled flag MUST survive: a session-only attacker can't re-key to disable 2FA.
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabledAt: true },
    });
    expect(u?.twoFactorEnabledAt).not.toBeNull();
  });

  it("recovery_codes: SAĞLAM secret + geçerli kod → 10 kod üretir", async () => {
    const { totp } = await import("@/lib/auth/totp");
    const secret = "ABCDEFGHIJKLMNOP";
    await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() },
    });
    const res = await POST(req({ action: "recovery_codes", code: totp(secret) }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.codes).toHaveLength(10);
  });

  it("ÇÖZÜLEMEYEN secret 'yanlış kod' maskesine saklanmaz: recovery_codes ayrı sistem-hatası mesajı döner", async () => {
    // Kurcalanmış/yabancı-anahtarla şifrelenmiş secret — decryptSecret fırlatır.
    await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: "v1.bozuk.bozuk.bozuk", twoFactorEnabledAt: new Date() },
    });
    const res = await POST(req({ action: "recovery_codes", code: "123456" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields?.code).toContain("çözemiyor");
    expect(data.fields?.code).not.toContain("Geçerli bir doğrulama kodu");
    // Fail-closed: kod ASLA üretilmedi.
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("ÇÖZÜLEMEYEN secret'ta disable da ayrı mesaj döner ve 2FA AÇIK KALIR (fail-closed)", async () => {
    await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: "v1.bozuk.bozuk.bozuk", twoFactorEnabledAt: new Date() },
    });
    const res = await POST(req({ action: "disable", code: "123456" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields?.code).toContain("çözemiyor");
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabledAt: true },
    });
    expect(u?.twoFactorEnabledAt).not.toBeNull();
  });

  it("allows 'setup' when 2FA is not yet active", async () => {
    const res = await POST(req({ action: "setup", password: SETUP_PW }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.secret).toBe("string");
    // Setup must not flip it on — only 'enable' (with a valid code) does that.
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabledAt: true },
    });
    expect(u?.twoFactorEnabledAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🚨 2FA KURULUMU YENİDEN KİMLİK DOĞRULAMA İSTER (denetim 08-08/09).
//
// Ölçülen zincir: `setup` DÜZ METİN TOTP sırrını şifre sormadan, e-posta kodu
// istemeden, mevcut faktör aramadan döndürüyordu; `enable` onu etkinleştirip
// AYNI transaction'da tüm kurtarma kodlarını siliyordu. Ele geçirilmiş bir
// oturumla iki istek yeterliydi ve oluşan kilitlenme kurbanın ŞİFRE
// SIFIRLAMASINDAN SAĞ ÇIKIYOR (reset `twoFactorEnabledAt`'a dokunmuyor).
// Kurban kurucuysa kurtarma kapısı da kapalı: `admin/reset-2fa` süper-admin
// istiyor, o da artık kontrol edemediği faktörden geçmeyi gerektiriyor.
//
// Asimetri: hesap SİLME şifre istiyor, 2FA KAPATMA geçerli TOTP istiyor —
// yalnız en kalıcı kimlik bilgisini KURMAK hiçbir şey istemiyordu.
// Emsal birebir `account/delete` rotasından alındı.
// ---------------------------------------------------------------------------
describe("POST /api/account/2fa — kurulum yeniden kimlik doğrulama ister", () => {
  // ⚠️ AYRI describe → dış `beforeEach` MİRAS ALINMAZ. Kendi kurulumu olmadan
  // DB önceki testten kalan sırrı taşıyor ve "sır üretilmedi" iddiası vacuous olur.
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email: "u@example.com",
        passwordHash: await hashPassword(SETUP_PW),
        role: "owner",
      },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("şifre YOKKEN setup REDDEDİLİR ve sır ÜRETİLMEZ", async () => {
    const res = await POST(req({ action: "setup" }));
    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(after.twoFactorSecret).toBeNull();
  });

  it("şifre YANLIŞKEN setup REDDEDİLİR ve sır ÜRETİLMEZ", async () => {
    const res = await POST(req({ action: "setup", password: "yanlis-sifre" }));
    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(after.twoFactorSecret).toBeNull();
  });

  // 🚨 TERS YÖN — bu olmadan "her setup'ı reddet" mutasyonu da yeşil geçerdi.
  // ⚠️ KAYNAK PİNİ — ve NEDEN davranışsal olmadığı burada yazılı.
  // Yarış şu: "zaten etkin mi" okuması ile yazma arasında artık bir bcrypt
  // karşılaştırması var (~350 ms). Sekme A kapıdan geçer → bcrypt → sekme B
  // `enable` ile 2FA'yı AÇAR → sekme A koşulsuz yazsaydı
  // `twoFactorEnabledAt: null` ile CANLI 2FA'yı sessizce KAPATIRDI.
  // Bu pencereyi tek bir HTTP çağrısının içinde deterministik olarak vurmak
  // mümkün değil (araya girecek yer yok), o yüzden koşulun VARLIĞI pinleniyor.
  // Mutasyonla ölçüldü: koşulu kaldırmak hiçbir davranışsal testi kırmıyor —
  // yani bu pin olmasa koruma sessizce silinebilirdi.
  it("setup yazması KOŞULLU (yarış penceresi kapalı)", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("src/app/api/account/2fa/route.ts", "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    // Koşulsuz `update` ile yazılmamalı; WHERE'de "henüz etkin değil" olmalı.
    expect(code).toMatch(/updateMany\(\{\s*where: \{ id: session\.userId, twoFactorEnabledAt: null \}/);
    // 🚨 SONUCUN İŞLENMESİ DE PİNLİ. Savunmacı ajan ölçtü: `armed.count === 0`
    // bloğunu tamamen silmek 33 testi YEŞİL bırakıyordu. O blok olmadan rota,
    // ASLA SAKLAMADIĞI bir düz metin sırrı kullanıcıya geri verir ve kullanıcı
    // çalışmayan bir QR tarar.
    // ⚠️ BU NEDEN DAVRANIŞSAL DEĞİL: dala ulaşmak için okuma ile yazma ARASINDA
    // satırın değişmesi gerekiyor; tek bir HTTP çağrısının içine girilemiyor.
    // "2FA zaten etkin" senaryosu bu dalı sınamaz — daha önceki okuma kapısı
    // devreye girer (denendi, test yanlış sebeple yeşil geçiyordu, kaldırıldı).
    expect(code).toMatch(/if \(armed\.count === 0\)/);
  });

  it("KONTROL: doğru şifreyle setup ÇALIŞIR ve sır üretilir", async () => {
    const res = await POST(req({ action: "setup", password: SETUP_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe("string");
    expect(body.secret.length).toBeGreaterThan(10);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(after.twoFactorSecret).not.toBeNull();
    // Kurulum ETKİNLEŞTİRMEZ — yarım kalan kurulum kimseyi kilitlemez.
    expect(after.twoFactorEnabledAt).toBeNull();
  });
});
