import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  EMAIL_VERIFY_REQUIRED_FROM,
  needsEmailVerification,
  makeVerifyToken,
  hashVerifyToken,
  appBaseUrl,
  baseUrlFromHost,
  verifyUrl,
} from "@/lib/auth/email-verify";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";

// setSessionCookie touches next/headers cookies() — unavailable outside a request
// scope in tests. Mock it (the existing login-route test does the same).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined) };
});

// Don't actually send mail; capture the HTML so we can pull the verify link.
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
import { emailService } from "@/lib/email";

// Outbox (Tur-4): the inline kick is mocked so its fire-and-forget drain can't
// race the assertions — the flag-ON tests drain EXPLICITLY.
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
import { drainEmailOutboxOnce } from "@/lib/email-outbox";

import { LEGAL_VERSION } from "@/lib/legal-entity";
import { LEGAL_TEXT_HASH } from "@/lib/legal-text-hash";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as verifyEmail, GET as verifyEmailGet } from "@/app/api/auth/verify-email/route";

// ⚠️ 08-05: rota GET+query'den POST+gövdeye taşındı. Token artık e-postadaki
// bağlantının FRAGMENT'inde (`#t=`) geliyor ve istemci onu buraya POST ediyor;
// query'de taşımak Railway edge log'una / Next istek log'una yazmak demekti ve
// bu token TEK BAŞINA OTURUM BASIYOR (m47'deki şifre sıfırlama token'ının
// aksine yanında ikinci faktör YOK).
//
// 🚨 08-06: gövde artık PAROLA da taşıyor. Doğrulama tek sırla tamamlanamaz —
// hesap ön-ele-geçirme kapısı (saldırgan kurbanın adresiyle kaydolur, kurban
// linke tıklar, hesap doğrulanır, saldırgan KENDİ parolasıyla girerdi).
const verifyReq = (token: string, password = "secret123") =>
  new NextRequest("http://www.lixusai.com/api/auth/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });

// register + resend-verification now go through sendReporting (checked result — not
// fire-and-forget), so the verification link + "was it sent" assertions read it.
const mockSendReporting = vi.mocked(emailService.sendReporting);

function postReq(url: string, body: unknown, extraHeaders?: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

const BEFORE = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() - 86_400_000); // pre-cutoff
const AFTER = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() + 86_400_000); // post-cutoff

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  process.env.REGISTRATION_OPEN = "1";
});
// DOSYA GENELİNDE env temizliği. Bazı testler APP_URL/NODE_ENV stub'lıyor ve
// temizliği kendi son satırlarında yapıyordu — bir assertion patlayınca o satıra
// hiç gelinmiyor ve stub SONRAKİ testlere sızıyordu (tek gerçek hata, ardından
// alâkasız 4 test daha kırmızı). Buradan temizlenince hata nerede ise orada kalır.
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  delete process.env.REGISTRATION_OPEN;
  await prisma.$disconnect();
});

describe("email-verify helpers", () => {
  it("hash is deterministic; makeVerifyToken matches its hash", () => {
    const { raw, hash } = makeVerifyToken();
    expect(raw).toHaveLength(64);
    expect(hash).toBe(hashVerifyToken(raw));
  });

  it("appBaseUrl is a FIXED trusted base — canonical-pinned (Codex 07-23 #2)", () => {
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // canonical default (APP_URL unset)
    // Trusted values pass through:
    vi.stubEnv("APP_URL", "https://www.lixusai.com/");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // trailing slash normalized
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(appBaseUrl()).toBe("http://localhost:3000"); // dev/test localhost carve-out
    // UNTRUSTED values fail CLOSED to canonical — verification tokens ride these
    // links, so a foreign/http origin must never become the link base:
    vi.stubEnv("APP_URL", "https://app.example.com");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // foreign https → canonical
    // .eu ARTIK kabul ediliyor: APP_URL bu deployment'ın KİMLİĞİ ve .eu de bizim
    // origin'imiz (DEPLOYABLE_ORIGINS). Eskiden .com'a düşüyordu — yani .eu'da
    // doğrulama linki müşteriyi hesabının OLMADIĞI deployment'a yolluyordu.
    vi.stubEnv("APP_URL", "https://www.lixusai.eu");
    expect(appBaseUrl()).toBe("https://www.lixusai.eu");
    vi.stubEnv("APP_URL", "not-a-url");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // invalid → canonical
  });

  it("PRODUCTION: appBaseUrl accepts ONLY the exact canonical origin (localhost dahil hiçbir şey)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://www.lixusai.com");
    expect(appBaseUrl()).toBe("https://www.lixusai.com");
    for (const bad of [
      "http://www.lixusai.com", // http'li canonical bile RED
      "https://evil.example",
      "https://www.lixusai.com.evil.com", // sonek hilesi
      "http://localhost:3000", // prod'da localhost carve-out YOK
    ]) {
      vi.stubEnv("APP_URL", bad);
      expect(appBaseUrl(), `${bad} kabul edilmemeli`).toBe("https://www.lixusai.com");
    }
    // isAllowedHost'un APP_URL dalı da güvenilmeyen host'u AÇMAZ:
    vi.stubEnv("APP_URL", "https://evil.example");
    expect(baseUrlFromHost("evil.example")).toBe("https://www.lixusai.com");
    // TERS YÖN: .eu deployment'ında .com ARTIK yabancıdır. Tek yönlü düşünmek
    // yeterli değil — iki deployment birbirinin tabanını kabul etmemeli.
    vi.stubEnv("APP_URL", "https://www.lixusai.eu");
    expect(appBaseUrl()).toBe("https://www.lixusai.eu");
    expect(baseUrlFromHost("www.lixusai.com")).toBe("https://www.lixusai.eu");
  });

  it("verifyUrl ignores the Host entirely — the emailed link is host-injection-proof", () => {
    const url = verifyUrl("a".repeat(64));
    // Token FRAGMENT'te; sunucuya HİÇ gitmez. `new URL()` ile ayrıştırılır ki
    // biçim geri taşınırsa (query'ye) test kırmızıya dönsün.
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/e-posta-dogrula");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#t=${"a".repeat(64)}`);
  });

  it("baseUrlFromHost ALLOWLISTS: real/localhost hosts pass, a forged host falls back to the fixed base", () => {
    expect(baseUrlFromHost("www.lixusai.com")).toBe("https://www.lixusai.com");
    expect(baseUrlFromHost("lixusai.com")).toBe("https://lixusai.com");
    expect(baseUrlFromHost("localhost:3000")).toBe("http://localhost:3000"); // dev
    expect(baseUrlFromHost("attacker.com")).toBe("https://www.lixusai.com"); // injection → trusted base
    expect(baseUrlFromHost("www.lixusai.com.evil.com")).toBe("https://www.lixusai.com"); // suffix trick blocked
    expect(baseUrlFromHost(null)).toBe("https://www.lixusai.com");
  });

  it("gates ONLY post-cutoff unverified accounts (existing users exempt)", () => {
    expect(needsEmailVerification({ createdAt: BEFORE, emailVerifiedAt: null })).toBe(false);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: null })).toBe(true);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: new Date() })).toBe(false);
  });
});

describe("registration → verification → login", () => {
  it("registration creates an UNVERIFIED account, mails a link, returns verifyEmail (no auto-login)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ verifyEmail: true });
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).toBeTruthy();
    expect(u?.acceptedTermsAt).not.toBeNull(); // KVKK consent recorded
    expect(mockSendReporting).toHaveBeenCalledOnce();
  });

  it("verification-email failure → 503 (NOT a false 201), account KEPT and resend-able", async () => {
    // Fail-open fix: the mailer reports a failure — the caller must NOT pretend the
    // account is ready. It returns a secret-free 503, keeps the account (its verify
    // token is intact so the user can resend), and never deletes it or wraps the send
    // in the DB transaction.
    mockSendReporting.mockResolvedValueOnce({ ok: false, error: "Resend HTTP 500 — upstream down" });
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "mailfail@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.accountCreated).toBe(true);
    expect(json).not.toMatchObject({ verifyEmail: true }); // never the success shape
    expect(String(json.error ?? "")).not.toContain("Resend HTTP 500"); // no provider detail leaked
    // Account KEPT with a live verify token → resend works later.
    const u = await prisma.user.findUnique({ where: { email: "mailfail@x.com" } });
    expect(u).not.toBeNull();
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).toBeTruthy();
  });

  it("records KVKK consent EVIDENCE: privacy timestamp, legal version, IP (rightmost XFF), User-Agent", async () => {
    const res = await register(
      postReq(
        "http://localhost/api/auth/register",
        { organizationName: "Acme", name: "Ada", email: "ev@x.com", password: "secret123", consent: true },
        // leftmost XFF is the client-spoofable hop; rightmost (5.6.7.8) is what the
        // platform proxy actually observed and the value we must record.
        { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "TestBrowser/1.0" },
      ),
    );
    expect(res.status).toBe(201);
    const u = await prisma.user.findUnique({ where: { email: "ev@x.com" } });
    expect(u?.acceptedTermsAt).not.toBeNull();
    expect(u?.privacyAcceptedAt).not.toBeNull();
    // one checkbox → both acceptances share the same instant
    expect(u?.privacyAcceptedAt?.getTime()).toBe(u?.acceptedTermsAt?.getTime());
    expect(u?.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(u?.acceptedLegalTextHash).toBe(LEGAL_TEXT_HASH); // tamper-evident companion
    expect(u?.acceptedIp).toBe("5.6.7.8"); // rightmost hop, spoofed leftmost discarded
    expect(u?.acceptedUserAgent).toBe("TestBrowser/1.0");
  });

  it("consent evidence is null-safe when IP/UA headers are absent (no crash)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "noua@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    const u = await prisma.user.findUnique({ where: { email: "noua@x.com" } });
    expect(u?.acceptedLegalVersion).toBe(LEGAL_VERSION); // version always stamped
    expect(u?.acceptedLegalTextHash).toBe(LEGAL_TEXT_HASH); // hash always stamped too
    expect(u?.acceptedIp).toBe("unknown"); // clientIp fallback when no XFF/x-real-ip
    expect(u?.acceptedUserAgent).toBeNull(); // header absent → null (not "")
  });

  it("rejects registration without KVKK consent (400, no account created)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "noconsent@x.com",
        password: "secret123",
        // consent intentionally omitted
      }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: "noconsent@x.com" } })).toBeNull();
    expect(mockSendReporting).not.toHaveBeenCalled();
  });

  it("clicking the e-mailed link verifies the account + clears the token", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    const html = String(mockSendReporting.mock.calls[0][2]);
    const token = html.match(/#t=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();

    const res = await verifyEmail(verifyReq(token!));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.emailVerifyTokenHash).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 🚨 HESAP ÖN-ELE-GEÇİRME KAPISI (08-06). Bu blok GEVŞETİLMEZ.
  //
  // Zincir: saldırgan KURBANIN adresiyle kaydolur (register mevcut e-postada
  // enumeration'a karşı sessiz 201 döner) → kimliksiz `resend-verification` ile
  // kurbanın kutusuna taze token yollatır → KURBAN tıklar → hesap doğrulanırdı →
  // saldırgan KENDİ parolasıyla girerdi. Kapatma: doğrulama artık token VE
  // parola ister; saldırıda o iki sır iki farklı kişidedir.
  // -------------------------------------------------------------------------
  it("ÖN-ELE-GEÇİRME: kurban linke tıklasa da PAROLASIZ doğrulama olmaz; saldırganın girişi 403 kalır", async () => {
    // Saldırgan kurbanın adresiyle kaydoluyor, parolayı KENDİ seçiyor.
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Kurban Apart",
        name: "Kurban",
        email: "kurban@x.com",
        password: "saldirgan-parolasi",
        consent: true,
      }),
    );
    const token = String(mockSendReporting.mock.calls[0][2]).match(/#t=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();

    // Kurban linke tıklıyor ama parolayı BİLMİYOR — tahmin ediyor.
    const clicked = await verifyEmail(verifyReq(token!, "kurbanin-tahmini"));
    expect(clicked.status).toBe(400);
    expect((await clicked.json()).reason).toBe("password");

    // Hesap doğrulanMADI ve token TÜKENMEDİ (yazım hatası bağlantıyı yakmamalı).
    const after = await prisma.user.findUnique({ where: { email: "kurban@x.com" } });
    expect(after?.emailVerifiedAt).toBeNull();
    expect(after?.emailVerifyTokenHash).not.toBeNull();

    // Saldırgan KENDİ parolasıyla girmeyi deniyor → doğrulama kapısı KAPALI.
    const attacker = await login(
      postReq("http://localhost/api/auth/login", {
        email: "kurban@x.com",
        password: "saldirgan-parolasi",
      }),
    );
    expect(attacker.status).toBe(403);
    expect((await attacker.json()).needsVerification).toBe(true);
  });

  it("yanlış parola token'ı TÜKETMEZ — aynı bağlantı doğru parolayla hâlâ çalışır", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "retry@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    const token = String(mockSendReporting.mock.calls[0][2]).match(/#t=([a-f0-9]{64})/)?.[1];

    const wrong = await verifyEmail(verifyReq(token!, "yanlis-parola"));
    expect(wrong.status).toBe(400);

    // ⚠️ Ters yön: koruma "hep reddet"e dönerse bu satır yakalar.
    const right = await verifyEmail(verifyReq(token!, "secret123"));
    expect(right.status).toBe(200);
    const u = await prisma.user.findUnique({ where: { email: "retry@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
  });

  it("SIRA: geçersiz token, parola YOKKEN de 'expired' döner (e2e sebep-kodu sözleşmesi)", async () => {
    // `tests/e2e/security-controls.spec.ts` tarayıcı-botnet Content-Type kapısını
    // BU rota üzerinden ölçüyor: gövde okundu → `expired`, gövde düşürüldü →
    // `missing`. Boş-parola kontrolü token aramasının ÖNÜNE alınırsa iki dal da
    // ayrışamaz hale gelir ve o kapının tek davranışsal pini anlamsızlaşır.
    const res = await verifyEmail(
      new NextRequest("http://www.lixusai.com/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "gecersiz" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("expired");
  });

  it("2FA açık hesapta oturum BASILMAZ — kullanıcı normal girişe yollanır", async () => {
    // Bugün bu duruma ULAŞILAMAZ (doğrulanmamış hesap 2FA kuramaz) — guard,
    // ileride o değişmezi bozacak bir değişikliğe karşı buranın sessizce bir
    // 2FA atlatma kapısına dönüşmesini engeller.
    const org = await prisma.organization.create({ data: { name: "TwoFa" } });
    const { raw, hash } = makeVerifyToken();
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "twofa@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        emailVerifyTokenHash: hash,
        emailVerifyExpiresAt: new Date(Date.now() + 60_000),
        twoFactorEnabledAt: new Date(),
      },
    });

    const res = await verifyEmail(verifyReq(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).requiresLogin).toBe(true);
    // Hesap yine de doğrulandı — yalnız oturum çerezi basılmadı.
    const u = await prisma.user.findUnique({ where: { email: "twofa@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(res.cookies.get("session")).toBeUndefined();
  });

  it("PAROLA SIFIRLAMA canlı doğrulama token'ını da öldürür (İKİ yol da)", () => {
    // ⚠️ KAYNAK TARAMASI, davranış testi değil: iki sıfırlama yolunu da uçtan
    // uca koşturmak challenge/kod harness'ı ister ve buradaki değişmez tek bir
    // şey — `passwordHash`'i yazan her update `emailVerify*`'i de temizlemeli.
    //
    // Neden gerekli: `sessionEpoch` artışı doğrulama token'ını ÖLDÜRMEZ, çünkü
    // doğrulama rotası oturumu TAZE epoch'la basar. Yani sızmış bir doğrulama
    // bağlantısı, sahibi parolasını sıfırlasa bile çalışmaya devam ederdi —
    // üstelik hesap doğrulanmadığı için MEŞRU sahip yeni parolasıyla bile
    // giremezken (login 403), link sahibi girebilirdi.
    // ⚠️ FAZ 3 (08-09): liste İKİ dosyadan BİRE indi ve bu bir GEVŞETME DEĞİL.
    // Eski kod yolu kalkınca `forgot-password/route.ts` `passwordHash` yazan
    // dalını kaybetti; sıfırlamayı artık TEK bir yer yazıyor
    // (`consumeChallengeAndResetPassword`). Listeyi kırmızı diye kısaltmak
    // tehlikeli olurdu, o yüzden ALTINA bir kapı eklendi: rota `passwordHash`
    // yazmaya BAŞLARSA test kırmızıya döner ve "token temizliğini de ekle"
    // sorusu yeniden sorulur.
    const paths = ["src/lib/auth/password-reset-challenge.ts"];
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // `passwordHash` yazan update bloğu ile aynı yerde token temizliği olmalı.
      expect(src, `${rel}: passwordHash yazmıyor mu?`).toMatch(/passwordHash[,:]/);
      expect(src, `${rel}: emailVerifyTokenHash temizlenmiyor`).toContain(
        "emailVerifyTokenHash: null",
      );
      expect(src, `${rel}: emailVerifyExpiresAt temizlenmiyor`).toContain(
        "emailVerifyExpiresAt: null",
      );
    }

    // KAPI: rota parolayı KENDİ yazmıyor, tek yazıcıya DEVREDİYOR. Bu iddia
    // olmadan "listeyi kısalt" hamlesi, rotaya token temizliği OLMADAN yeni bir
    // `passwordHash` yazması eklenmesini sessizce mümkün kılardı.
    const routeSrc = readFileSync(
      join(process.cwd(), "src/app/api/account/forgot-password/route.ts"),
      "utf8",
    );
    expect(routeSrc, "rota passwordHash yazıyor — token temizliğini de eklemeli").not.toMatch(
      /passwordHash[,:]/,
    );
    expect(routeSrc).toContain("consumeChallengeAndResetPassword");
  });

  it("verify-email ASLA `mfa: true` yazmaz — operatör kapısı bu yoldan açılamaz", () => {
    // `admin-core.ts isSuperAdmin` `session.mfa === true` istiyor. Bu rota
    // parolayı doğruluyor ama İKİNCİ FAKTÖRÜ doğrulamıyor; login'deki
    // `mfa: Boolean(user.twoFactorEnabledAt)` deseni buraya "tutarlılık" adına
    // kopyalanırsa operatör yetkisi ikinci faktör görmemiş bir oturuma açılır.
    // Bu bir KAYNAK taraması çünkü tehlike gelecekteki bir düzenlemede.
    const src = readFileSync(
      join(process.cwd(), "src/app/api/auth/verify-email/route.ts"),
      "utf8",
    );
    expect(src).toContain("mfa: false");
    expect(src).not.toMatch(/mfa:\s*true/);
    expect(src).not.toMatch(/mfa:\s*Boolean/);
  });

  it("BAŞKA hesabın oturumu açıkken doğrulama REDDEDİLİR (sessiz hesap değişimi yok)", async () => {
    // `/e-posta-dogrula` `AUTH_PATHS`'te ama `SIGNED_IN_REDIRECT_PATHS`'te DEĞİL
    // → oturumu açık kullanıcı sayfaya ulaşır ve `setSessionCookie` mevcut çerezi
    // KOŞULSUZ ezer. Yabancı bir token'la gelinirse kullanıcı sessizce başka bir
    // org'a taşınırdı (login-CSRF); operatörse aktif impersonation bağlamı düşerdi.
    const org = await prisma.organization.create({ data: { name: "Other" } });
    const { raw, hash } = makeVerifyToken();
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Hedef",
        email: "hedef@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        emailVerifyTokenHash: hash,
        emailVerifyExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const req = verifyReq(raw);
    // Başka bir kullanıcının oturum çerezi taşınıyor.
    req.cookies.set(SESSION_COOKIE, await signSession({
      userId: "baska-kullanici",
      organizationId: org.id,
      role: "owner",
      email: "baska@x.com",
      name: "Başka",
      sessionEpoch: 0,
      mfa: false,
    }));

    const res = await verifyEmail(req);
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("session_mismatch");
    // Hesap doğrulanMADI, token TÜKENMEDİ.
    const u = await prisma.user.findUnique({ where: { email: "hedef@x.com" } });
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).not.toBeNull();
  });

  it("RACE: concurrent clicks on the same verify link mint EXACTLY ONE session (atomic consume)", async () => {
    // Codex #11: findFirst→update let two concurrent requests both pass the
    // lookup before either update landed — two sessions from one token. The
    // consume must be conditionally atomic (updateMany WHERE hash still set).
    const org = await prisma.organization.create({ data: { name: "X" } });
    const { raw, hash } = makeVerifyToken();
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "race@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
        emailVerifyTokenHash: hash,
        emailVerifyExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => verifyEmail(verifyReq(raw))),
    );
    const winners = responses.filter((r: Response) => r.status === 200);
    const losers = responses.filter((r: Response) => r.status === 400);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);

    const u = await prisma.user.findUnique({ where: { email: "race@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.emailVerifyTokenHash).toBeNull();
  });

  it("HOST-INJECTION: a forged Host on register does NOT poison the emailed verify link", async () => {
    await register(
      postReq(
        "http://localhost/api/auth/register",
        { organizationName: "Acme", name: "Ada", email: "vic@x.com", password: "secret123", consent: true },
        { host: "attacker.evil.com" }, // attacker-controlled Host header
      ),
    );
    const html = String(mockSendReporting.mock.calls[0][2]);
    expect(html).not.toContain("attacker.evil.com"); // token never leaves for the attacker's domain
    expect(html).toContain("https://www.lixusai.com/e-posta-dogrula#t=");
  });

  it("HOST-INJECTION: a forged Host on RESEND does NOT poison the emailed verify link", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "resend@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
      },
    });
    const res = await resendVerification(
      postReq("http://localhost/api/auth/resend-verification", { email: "resend@x.com" }, { host: "attacker.evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockSendReporting).toHaveBeenCalledOnce();
    const html = String(mockSendReporting.mock.calls[0][2]);
    expect(html).not.toContain("attacker.evil.com");
    expect(html).toContain("https://www.lixusai.com/e-posta-dogrula#t=");
  });

  it("🚨 PAROLA KAPISI DOYGUNSA doğrulama 503 döner (çıplak 500 DEĞİL) ve token TÜKETİLMEZ (09-23, F4)", async () => {
    const { verifyPassword: realVerify } = await import("@/lib/auth/password");
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    vi.stubEnv("PASSWORD_HASH_MAX_QUEUE", "0");
    const { raw, hash } = makeVerifyToken();
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "busy@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifyTokenHash: hash,
        emailVerifyExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    // Tek yuvayı başka bir parola işi tutuyor (gerçek bcrypt, ~300 ms).
    const holder = realVerify("x", "$2a$12$pW7aCpH9gDjLDJgWwMZS9e4XetljqUVeM6688s259LuXEGh42XYii");
    const res = await verifyEmail(verifyReq(raw));
    await holder;
    expect(res.status).toBe(503);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "busy@x.com" } });
    expect(u.emailVerifyTokenHash, "yoğunluk yüzünden token yanmamalı").toBe(hash);
    expect(u.emailVerifiedAt).toBeNull();
  });

  it("🚨 İÇERİK ENJEKSİYONU (09-23): doğrulama e-postası kayıtta yazılan ADI taşımaz", async () => {
    // Kimliksiz yol: saldırgan kurbanın adresiyle kayıt olur, ad alanına kendi metnini yazar;
    // eskiden o metin `noreply@lixusai.com`dan, gerçek bir doğrulama bağlantısının yanında
    // kalın puntoyla kurbana gidiyordu.
    const bait = "Hesabiniz askiya alindi 0850 000 00 00 arayin";
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: bait,
        email: "victim@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
      },
    });
    const res = await resendVerification(postReq("http://localhost/api/auth/resend-verification", { email: "victim@x.com" }));
    expect(res.status).toBe(200);
    expect(mockSendReporting).toHaveBeenCalledOnce();
    const html = String(mockSendReporting.mock.calls[0][2]);
    expect(html).toContain("https://www.lixusai.com/e-posta-dogrula#t="); // anti-vakum: gerçek doğrulama e-postası
    expect(html).not.toContain("askiya");
    expect(html).not.toContain("0850");
  });

  it("🚨 E-POSTA BOMBASI (09-23): aynı adrese 24 saatte en fazla 6 doğrulama e-postası (15 dk'lık kovalar dolsa da)", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "bomb@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
      },
    });
    for (let i = 0; i < 10; i++) {
      await resendVerification(postReq("http://localhost/api/auth/resend-verification", { email: "bomb@x.com" }));
      // Zamanın geçmesini taklit et: YALNIZ 15 dakikalık kovalar (IP + hesap) boşalır;
      // saldırganın IP döndürmesi de tam olarak IP kovasını boşaltır.
      await prisma.$executeRaw`
        UPDATE "RateLimitCounter" SET "resetAt" = (now() AT TIME ZONE 'utc') - interval '1 minute'
        WHERE "key" LIKE 'verify-resend:%' OR "key" LIKE 'verify-resend-acct:%'`;
    }
    expect(mockSendReporting).toHaveBeenCalledTimes(6);
  });

  it("a NEW (post-cutoff) unverified account is BLOCKED from login (403), then allowed once verified", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "ada@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
      },
    });
    const blocked = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ needsVerification: true });

    await prisma.user.update({ where: { email: "ada@x.com" }, data: { emailVerifiedAt: new Date() } });
    const ok = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(ok.status).toBe(200);
  });

  it("an EXISTING (pre-cutoff) user logs in fine even if unverified — founder NOT locked out", async () => {
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Founder",
        email: "founder@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: BEFORE,
        emailVerifiedAt: null,
      },
    });
    const res = await login(postReq("http://localhost/api/auth/login", { email: "founder@x.com", password: "secret123" }));
    expect(res.status).toBe(200);
  });
});

// ── Tur-4: EMAIL_OUTBOX_ENABLED=1 — register/resend queue the verification
// link instead of sending synchronously. 201 ⟺ hesap+hash+outbox TEK commit.
describe("register + resend — durable outbox (flag ON)", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** E-postadaki bağlantının FRAGMENT'inden ham token'ı çıkarır.
   *  ⚠️ `new URL()` ile ayrıştırılır ve `search` boş olmalı: token bir gün
   *  query'ye geri taşınırsa bu yardımcı patlar ve onu kullanan TÜM testler
   *  kırmızıya döner (biçim buradan da pinli). */
  function tokenFromLastMail(): string {
    const html = String(mockSendReporting.mock.calls.at(-1)?.[2] ?? "");
    const m = html.match(/href="([^"]+)"/);
    if (!m) throw new Error("no link in e-mail");
    const u = new URL(m[1]);
    expect(u.search).toBe("");
    const t = u.hash.match(/^#t=(.+)$/);
    if (!t) throw new Error(`no #t= fragment in link: ${m[1]}`);
    return decodeURIComponent(t[1]);
  }

  it("ATOMİK 201 (Codex kapanış 2): kayıt tek TX'te hesap+hash+outbox yazar; SENKRON e-posta yok; drain sonrası link doğrular", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendReporting).not.toHaveBeenCalled(); // eski writer devre dışı

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } });
    expect(user.emailVerifyTokenHash).toBeTruthy();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.kind).toBe("verify_email");
    expect(row.status).toBe("pending");
    expect(row.userId).toBe(user.id); // aynı commit'in parçası

    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][0]).toBe("ada@x.com");
    const verify = await verifyEmail(verifyReq(tokenFromLastMail()));
    expect(verify.status).toBe(200); // link works end-to-end
    const after = await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } });
    expect(after.emailVerifiedAt).toBeTruthy();
  });

  it("RESEND: yeni token eski teslim-edilmemiş linki süperseder; yalnız YENİ link gönderilir ve doğrular", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    // İlk link HİÇ teslim edilmeden kullanıcı "yeniden gönder" der.
    const res = await resendVerification(
      postReq("http://localhost/api/auth/resend-verification", { email: "ada@x.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockSendReporting).not.toHaveBeenCalled(); // resend de senkron göndermez

    const rows = await prisma.emailOutbox.findMany({ orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "canceled"], // superseded — eski token'ın maili ASLA gitmez
      [2, "pending"],
    ]);

    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1); // tek mail: yenisi
    const verify = await verifyEmail(verifyReq(tokenFromLastMail()));
    expect(verify.status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } })).emailVerifiedAt,
    ).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESKİ DOĞRULAMA BAĞLANTILARI — ÇIPLAK 405 YERİNE AÇIKLAMALI SAYFA (08-09)
//
// 08-05'ten ÖNCE gönderilmiş her mail `GET /api/auth/verify-email?token=…`
// adresine işaret ediyor; rota o gün POST-only yapılınca bu bağlantılar
// tarayıcıda "HTTP ERROR 405 — Bu sayfa çalışmıyor" veriyordu (kullanıcı canlıda
// gördü). Gelen kutusundaki maili geri çağıramayız, o yüzden uç nokta kurtarır.
//
// 🚨 KURAL İHLALİ DEĞİL: "GET'i geri getirme" YAN ETKİYİ yasaklar. Bu GET
// token'ı okumaz/doğrulamaz/tüketmez ve oturum basmaz — yalnız yönlendirir.
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/auth/verify-email — eski bağlantı kurtarma", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
  });

  function get(url: string) {
    return new NextRequest(url, { headers: { host: "www.lixusai.com" } });
  }

  it("token'ı FRAGMENT'e taşıyarak sayfaya yönlendirir (query'de bırakmaz)", async () => {
    const res = await verifyEmailGet(get("http://localhost/api/auth/verify-email?token=abc123"));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toBe("https://www.lixusai.com/e-posta-dogrula#t=abc123");
    // Token istek satırından ÇIKTI: hedefte query yok.
    expect(new URL(loc).search).toBe("");
  });

  it("token YOKKEN fragmentsiz yönlendirir (sayfa kendi hata durumunu gösterir)", async () => {
    const res = await verifyEmailGet(get("http://localhost/api/auth/verify-email"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.lixusai.com/e-posta-dogrula");
  });

  it("🚨 YAN ETKİSİZ: token TÜKETİLMEZ, hesap doğrulanmaz, oturum BASILMAZ", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const raw = "canli-token-abc";
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email: "eski@example.com",
        passwordHash: await hashPassword("sifre12345"),
        role: "owner",
        emailVerifyTokenHash: hashVerifyToken(raw),
        emailVerifyExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const res = await verifyEmailGet(get(`http://localhost/api/auth/verify-email?token=${raw}`));
    expect(res.status).toBe(302);
    // Oturum çerezi BASILMADI (e-posta tarayıcılarının ön-ısıtma isteği için kritik).
    expect(res.headers.get("set-cookie")).toBeNull();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).toBeNull(); // doğrulanmadı
    expect(after.emailVerifyTokenHash).not.toBeNull(); // token HÂLÂ canlı
    expect(after.sessionEpoch).toBe(user.sessionEpoch);
  });
});
