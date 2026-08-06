import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";

// Capture the e-mailed code instead of sending mail.
let lastEmailHtml = "";
let emailOk = true;
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _subject: string, html: string) => {
      lastEmailHtml = html;
      return emailOk ? { ok: true } : { ok: false, error: "no mailer" };
    }),
  },
}));

// Outbox (Tur-4): the inline kick is mocked so the fire-and-forget drain can't
// race the assertions — tests drain EXPLICITLY; the kick call itself is pinned.
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

import { POST } from "@/app/api/account/forgot-password/route";
import { drainEmailOutboxOnce, kickEmailOutboxDrain } from "@/lib/email-outbox";
import { emailService } from "@/lib/email";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function codeFromEmail(): string {
  const m = lastEmailHtml.match(/(\d{8})/);
  if (!m) throw new Error("no code in e-mail");
  return m[1];
}

const EMAIL = "host@example.com";
const mockSendReporting = vi.mocked(emailService.sendReporting);

describe("POST /api/account/forgot-password (public reset)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });

  it("requests a code, mails it, and stores it hashed (never plaintext)", async () => {
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200);
    const code = codeFromEmail();
    expect(code).toMatch(/^\d{8}$/);
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy();
    expect(u?.pwResetCodeHash).not.toBe(code);
  });

  it("confirm with the correct code resets the password and burns the code", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    const res = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "brandnew123" }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeHash: true },
    });
    expect(await verifyPassword("brandnew123", u!.passwordHash)).toBe(true);
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("ENUMERATION: request for an unknown email returns 200 and stores no code anywhere", async () => {
    const res = await POST(req({ action: "request", email: "nobody@example.com" }));
    expect(res.status).toBe(200); // identical to a known-email response
    expect(lastEmailHtml).toBe(""); // no mail sent
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeNull(); // the real account is untouched
  });

  it("ENUMERATION: confirm for an unknown email returns the same generic 400 as a wrong code", async () => {
    const res = await POST(
      req({ action: "confirm", email: "nobody@example.com", code: "12345678", newPassword: "brandnew123" }),
    );
    expect(res.status).toBe(400);
  });

  it("wrong code increments attempts and leaves the password unchanged", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const res = await POST(req({ action: "confirm", email: EMAIL, code: "00000000", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeAttempts: true },
    });
    expect(u?.passwordHash).toBe("old");
    expect(u?.pwResetCodeAttempts).toBe(1);
  });

  it("burns the code after 5 wrong attempts — even the correct code then fails", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    for (let i = 0; i < 5; i++) {
      const r = await POST(req({ action: "confirm", email: EMAIL, code: "00000000", newPassword: "brandnew123" }));
      expect(r.status).toBe(400);
    }
    const res = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeHash: true },
    });
    expect(u?.passwordHash).toBe("old");
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("does not leave a dangling code if the e-mail could not be delivered (still 200)", async () => {
    emailOk = false;
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200); // enumeration-safe: same shape as success
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("YARIŞ (Codex P1): aynı geçerli kodla iki PARALEL confirm — yalnız biri geçer, kod tek yanar", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    const [a, b] = await Promise.all([
      POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yarisSifre111" })),
      POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yarisSifre222" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.sessionEpoch).toBe(1); // tek bump
    expect(u.pwResetCodeHash).toBeNull();
    const winnerPw = a.status === 200 ? "yarisSifre111" : "yarisSifre222";
    const loserPw = a.status === 200 ? "yarisSifre222" : "yarisSifre111";
    expect(await verifyPassword(winnerPw, u.passwordHash)).toBe(true);
    expect(await verifyPassword(loserPw, u.passwordHash)).toBe(false);
  });
});

// ── Tur-4: EMAIL_OUTBOX_ENABLED=1 — the request path no longer touches the
// provider; the code is queued and delivered by the drain. Same generic 200s.
describe("forgot-password — durable outbox (flag ON)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ESKİ WRITER DEVRE DIŞI: request SENKRON e-posta göndermez; hash + outbox satırı atomik, kick tetiklenir", async () => {
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200);
    expect(mockSendReporting).not.toHaveBeenCalled(); // no synchronous provider call
    expect(kickEmailOutboxDrain).toHaveBeenCalledTimes(1); // latency optimizer wired

    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.kind).toBe("pw_reset_code");
    expect(row.status).toBe("pending");

    // Drain delivers through the (mocked) provider; the code from the mail
    // completes the confirm flow end-to-end.
    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][0]).toBe(EMAIL);
    const code = codeFromEmail();
    const conf = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yeniSifre123" }));
    expect(conf.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword("yeniSifre123", after.passwordHash)).toBe(true);
  });

  it("bilinmeyen e-posta: aynı generic 200, hiç satır yok, kick yok", async () => {
    const res = await POST(req({ action: "request", email: "yok@example.com" }));
    expect(res.status).toBe(200);
    expect(await prisma.emailOutbox.count()).toBe(0);
    expect(mockSendReporting).not.toHaveBeenCalled();
    expect(kickEmailOutboxDrain).not.toHaveBeenCalled();
  });

  it("provider hatası kodu GERİ SİLMEZ: satır retry'a düşer, hash yerinde kalır (legacy davranışın aksine)", async () => {
    emailOk = false;
    await POST(req({ action: "request", email: EMAIL }));
    await drainEmailOutboxOnce();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("pending"); // scheduled retry, not lost
    expect(row.attemptCount).toBe(1);
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy(); // code stays valid for the retry
  });
});

// ---------------------------------------------------------------------------
// 🚨 HESAP KOVASI KURBANIN SIFIRLAMASINI ENGELLEYEMEZ (Codex, 08-01 — §4g(a)).
//
// `forgot-confirm:{email}` kovası (8 / 10 dk) KOD KONTROL EDİLMEDEN ÖNCE ve
// KOŞULSUZ tüketiliyordu — giriş rotasında kapatılan sınıfın birebir aynısı.
//
// KURBAN SENARYOSU (kurbanın kod istemesini bile BEKLEMEZ):
//   1. Saldırgan, kurbanın e-postasına 8 uydurma "confirm" atar. Ortada canlı
//      kod olmadığı için hepsi genel hatayla döner — ama kovayı DOLDURUR.
//   2. Kurban ŞİMDİ sıfırlama kodu ister (istek yolunun kendi kovası ayrı).
//   3. Kurban DOĞRU kodunu girer → 429. Şifresini sıfırlayamaz.
//   4. Saldırgan 10 dakikada bir tekrarlayarak bunu SÜRESİZ sürdürür.
//
// DOĞRU SÖZLEŞME (login ile AYNI invaryant):
//   1. DOĞRU kod, hesap kovası yüzünden ASLA reddedilmez.
//   2. IP limiti aynen korunur.
//   3. BAŞARISIZ denemeler yine sınırlandırılır (tavanı aşınca 429).
//   4. Enumeration koruması korunur: bilinmeyen e-posta da kovayı tüketir ve
//      aynı genel hatayı alır.
// ---------------------------------------------------------------------------
describe("forgot-password — hesap kovası kurbanı KİLİTLEYEMEZ", () => {
  // ⚠️ KENDİ beforeEach'i: bu KARDEŞ bir describe, üstteki kurulumu MİRAS ALMAZ
  // (kullanıcı seed'i, rate-limit sıfırlaması, `lastEmailHtml` temizliği).
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });

  function reqFrom(body: unknown, ip: string) {
    return new NextRequest("http://localhost/api/account/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  /** Saldırgan kovayı zehirler: canlı kod YOKKEN uydurma confirm'ler. */
  async function poisonBucket(email: string, n: number) {
    for (let i = 0; i < n; i++) {
      // Her istek FARKLI IP'den — IP kovasını değil, HESAP kovasını hedefliyor.
      await POST(reqFrom({ action: "confirm", email, code: "00000000", newPassword: "yenisifre1" }, `9.9.9.${i}`));
    }
  }

  it("saldırgan kovayı zehirlese bile DOĞRU kod ÇALIŞIR", { timeout: 90_000 }, async () => {
    await poisonBucket(EMAIL, 8); // tavan 8 → kova dolu

    // Kurban ŞİMDİ kod ister (istek yolunun kovası ayrı, etkilenmedi).
    const reqRes = await POST(reqFrom({ action: "request", email: EMAIL }, "2.2.2.2"));
    expect(reqRes.status).toBe(200);
    const code = codeFromEmail();

    const res = await POST(
      reqFrom({ action: "confirm", email: EMAIL, code, newPassword: "yepyenisifre1" }, "2.2.2.2"),
    );
    expect(res.status).toBe(200); // ⬅️ ARIZADA 429 (kurban kilitliydi)

    // Ve şifre GERÇEKTEN değişti.
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword("yepyenisifre1", u.passwordHash)).toBe(true);
  });

  it("BAŞARISIZ denemeler yine sınırlandırılır (koruma kaybolmadı)", { timeout: 90_000 }, async () => {
    await poisonBucket(EMAIL, 8);

    const res = await POST(
      reqFrom({ action: "confirm", email: EMAIL, code: "11111111", newPassword: "yenisifre1" }, "3.3.3.3"),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("DOĞRU kod hesap kovasını TÜKETMEZ", async () => {
    await POST(reqFrom({ action: "request", email: EMAIL }, "4.4.4.1"));
    const code = codeFromEmail();
    await POST(reqFrom({ action: "confirm", email: EMAIL, code, newPassword: "yepyenisifre1" }, "4.4.4.2"));

    const row = await prisma.rateLimitCounter.findFirst({
      where: { key: { startsWith: "forgot-confirm:" } },
    });
    expect(row).toBeNull(); // hiç sayaç satırı bile yaratılmadı
  });

  it("ENUMERATION: bilinmeyen e-posta da kovayı tüketir ve AYNI hatayı alır", async () => {
    const unknown = "yok@example.com";
    const res = await POST(
      reqFrom({ action: "confirm", email: unknown, code: "00000000", newPassword: "yenisifre1" }, "5.5.5.5"),
    );
    expect(res.status).toBe(400); // var olan e-postadaki yanlış kodla AYNI
    const row = await prisma.rateLimitCounter.findFirstOrThrow({
      where: { key: `forgot-confirm:${unknown}` },
    });
    expect(row.count).toBe(1);
  });

  it("IP limiti KORUNUR (aynı IP'den 13. istek 429)", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 12; i++) {
      await POST(reqFrom({ action: "confirm", email: EMAIL, code: "00000000", newPassword: "yenisifre1" }, "7.7.7.7"));
    }
    const res = await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.7"));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// ZAMAN PARİTESİ — HESAP ENUMERATION ORACLE'I (e-posta boru hattı denetimi, 08-06)
//
// 🚨 ÖLÇÜLEN AÇIK (canlıda aktifti): `confirm`'ün "canlı kod yok / bilinmeyen
// e-posta" dalı `verifyPassword(code, await hashPassword(code))` koşuyordu —
// bcrypt HASH + bcrypt COMPARE = İKİ işlem — oysa "yanlış kod" dalı yalnız BİR
// compare koşuyor. Ölçüldü: 713 ms vs 351 ms, yani 362 ms fark. Saldırgan önce
// `action:"request"` ile (her zaman 200) gerçek bir hesapta canlı kod oluşturur,
// sonra `confirm` süresine bakarak hesabın VAR OLUP OLMADIĞINI öğrenir — dosyanın
// kurduğu tüm enumeration korumalarını (genel metin, sabit 200, hız limiti) deler.
//
// Bu test SÜRE ÖLÇMEZ (CI'da flaky olurdu). Onun yerine YAPISAL değişmezi pinler:
// bcrypt maliyeti İKİ dalda da AYNI sayıda olmalı → kaynak, iki-işlemli deseni
// içermemeli ve tek-işlemli `dummyVerifyPassword`'ü kullanmalı.
// ---------------------------------------------------------------------------
describe("forgot-password — zaman paritesi (enumeration oracle'ı)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/app/api/account/forgot-password/route.ts"),
    "utf8",
  );

  it("bilinmeyen-e-posta dalı TEK bcrypt kullanır (dummyVerifyPassword)", () => {
    expect(src).toContain("dummyVerifyPassword(code)");
  });

  it("İKİ işlemli anti-desen kaynakta YOK", () => {
    // `verifyPassword(x, await hashPassword(x))` = hash + compare = 2 bcrypt.
    expect(src).not.toMatch(/verifyPassword\([^)]*await\s+hashPassword/);
  });

  it("yanlış-kod dalı hâlâ GERÇEK karşılaştırma yapıyor (ters yön pini)", () => {
    // Pariteyi "her iki dalı da ucuzlat" diye sağlamak korumayı kaldırırdı:
    // yanlış kod GERÇEK hash'e karşı sabit zamanlı karşılaştırılmalı.
    expect(src).toMatch(/verifyPassword\(code,\s*codeHash\)/);
  });
});
