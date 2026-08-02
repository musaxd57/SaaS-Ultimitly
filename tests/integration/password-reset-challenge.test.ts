import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// `PasswordResetChallenge` — ZORUNLU SALDIRI TESTLERİ (Codex, 08-02).
//
// Yapısal düzeltmenin çekirdeği: deneme bütçesi HESABA değil CHALLENGE SATIRINA
// ait ve satırın TEK adresleme yolu `tokenHash`. Token yalnız e-posta kutusuna
// gider → onu bilmeyen biri satırı bulamaz, denemesini harcayamaz.
//
// Eski akışta ölçülen: tek IP'den 9 istek/15 dk ile kurban süresiz olarak
// sıfırlama dışında tutulabiliyordu (4 istek kurtarma yolunu kapatıyor,
// 5 istek eldeki kodu yakıyor).
// ---------------------------------------------------------------------------

// Gerçek e-postayı yakala — token BAĞLANTIDA, kod GÖVDEDE.
let lastEmailHtml = "";
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _s: string, html: string) => {
      lastEmailHtml = html;
      return { ok: true };
    }),
  },
}));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
// Alarm yolunu gözlemle (eşik aşımı testi).
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
  };
});

import { POST } from "@/app/api/account/forgot-password/route";
import { drainEmailOutboxOnce } from "@/lib/email-outbox";
import { reportError } from "@/lib/report-error";
import { sweepPasswordResetChallenges } from "@/lib/auth/password-reset-challenge";

const mockReport = vi.mocked(reportError);
const EMAIL = "host@example.com";
const NEW_PASSWORD = "yepyenisifre1";

function req(body: unknown, ip = "1.1.1.1") {
  return new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Bir challenge iste ve e-postadan token + kodu çıkar. */
async function requestChallenge(ip = "1.1.1.1"): Promise<{ token: string; code: string }> {
  lastEmailHtml = "";
  const res = await POST(req({ action: "request", email: EMAIL }, ip));
  expect(res.status).toBe(200);
  await drainEmailOutboxOnce();
  const t = lastEmailHtml.match(/[?&]t=([0-9a-f]{64})/);
  const c = lastEmailHtml.match(/letter-spacing:4px[^>]*>(\d{8})</);
  if (!t || !c) throw new Error(`e-postada token/kod yok: ${lastEmailHtml.slice(0, 300)}`);
  return { token: t[1], code: c[1] };
}

describe("PasswordResetChallenge — zorunlu saldırı testleri", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    vi.stubEnv("PASSWORD_RESET_CHALLENGE_ENABLED", "1");
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  // ── 1 ────────────────────────────────────────────────────────────────────
  it("1) saldırgan request kotasını doldursa bile ELDEKİ challenge çalışır", async () => {
    const mine = await requestChallenge();

    // Saldırgan kurtarma yolunu (forgot-req, 4/15dk) kapatır.
    for (let i = 0; i < 5; i++) await POST(req({ action: "request", email: EMAIL }, `9.9.9.${i}`));
    const blocked = await POST(req({ action: "request", email: EMAIL }, "9.9.9.9"));
    expect(blocked.status).toBe(429); // kurtarma yolu gerçekten kapalı

    // …ama kurbanın ELİNDEKİ challenge hâlâ çalışır.
    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: mine.token, code: mine.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, u.passwordHash)).toBe(true);
  }, 60_000);

  // ── 2 ────────────────────────────────────────────────────────────────────
  it("2) bir challenge'a 5 yanlış deneme DİĞERİNİ yakmaz", async () => {
    const a = await requestChallenge("2.2.2.1");
    const b = await requestChallenge("2.2.2.2");
    expect(a.token).not.toBe(b.token);

    for (let i = 0; i < 5; i++) {
      await POST(req({ action: "confirm", email: EMAIL, token: a.token, code: "00000000", newPassword: NEW_PASSWORD }));
    }
    // A tükendi…
    const deadA = await POST(
      req({ action: "confirm", email: EMAIL, token: a.token, code: a.code, newPassword: NEW_PASSWORD }),
    );
    expect(deadA.status).toBe(400);

    // …B ETKİLENMEDİ.
    const okB = await POST(
      req({ action: "confirm", email: EMAIL, token: b.token, code: b.code, newPassword: NEW_PASSWORD }),
    );
    expect(okB.status).toBe(200);
  }, 90_000);

  // ── 3 ────────────────────────────────────────────────────────────────────
  it("3) YENİ request önceki geçerli challenge'ı BOZMAZ", async () => {
    const first = await requestChallenge("3.3.3.1");
    await requestChallenge("3.3.3.2"); // ikinci challenge doğar

    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: first.token, code: first.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200); // ⬅️ saldırgan yeni isteklerle eskisini düşüremez
  }, 60_000);

  // ── 4 ────────────────────────────────────────────────────────────────────
  it("4) paralel iki DOĞRU istekte yalnız BİRİ başarılı olur", async () => {
    const c = await requestChallenge();
    const body = { action: "confirm", email: EMAIL, token: c.token, code: c.code, newPassword: NEW_PASSWORD };

    const [r1, r2] = await Promise.all([POST(req(body, "4.4.4.1")), POST(req(body, "4.4.4.2"))]);
    const oks = [r1.status, r2.status].filter((s) => s === 200);
    expect(oks).toHaveLength(1); // tam olarak BİR tane

    const rows = await prisma.passwordResetChallenge.findMany({ where: { consumedAt: { not: null } } });
    expect(rows).toHaveLength(1); // tüketim damgası bir kez yazıldı
  }, 60_000);

  // ── 5 ────────────────────────────────────────────────────────────────────
  it("5) başarılı reset TÜM challenge'ları kapatır ve oturumları düşürür", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const a = await requestChallenge("5.5.5.1");
    const b = await requestChallenge("5.5.5.2");

    const ok = await POST(
      req({ action: "confirm", email: EMAIL, token: a.token, code: a.code, newPassword: NEW_PASSWORD }),
    );
    expect(ok.status).toBe(200);

    // B artık kullanılamaz.
    const dead = await POST(
      req({ action: "confirm", email: EMAIL, token: b.token, code: b.code, newPassword: "baskasifre1" }),
    );
    expect(dead.status).toBe(400);

    const live = await prisma.passwordResetChallenge.count({
      where: { consumedAt: null, invalidatedAt: null },
    });
    expect(live).toBe(0); // hiç canlı challenge kalmadı

    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.sessionEpoch).toBe(before.sessionEpoch + 1); // çalınmış oturumlar öldü
  }, 90_000);

  // ── 6 ────────────────────────────────────────────────────────────────────
  it("6) bilinmeyen ve kayıtlı e-posta DIŞARIDAN ayırt edilemez", async () => {
    const known = await POST(req({ action: "request", email: EMAIL }, "6.6.6.1"));
    const unknown = await POST(req({ action: "request", email: "yok@example.com" }, "6.6.6.2"));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json()); // gövde BİREBİR aynı

    // Bilinmeyen e-posta için HİÇBİR satır yazılmadı.
    expect(await prisma.passwordResetChallenge.count()).toBe(1);
  }, 60_000);

  // ── 7 ────────────────────────────────────────────────────────────────────
  it("7) token/hash HİÇBİR API yanıtında, log'da, Sentry'de veya AuditLog'da görünmez", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = await requestChallenge();
      const row = await prisma.passwordResetChallenge.findFirstOrThrow();

      const res = await POST(
        req({ action: "confirm", email: EMAIL, token: c.token, code: c.code, newPassword: NEW_PASSWORD }),
      );
      const bodyText = JSON.stringify(await res.json());

      const surfaces: string[] = [
        bodyText,
        ...logSpy.mock.calls.flat().map(String),
        ...errSpy.mock.calls.flat().map(String),
        ...warnSpy.mock.calls.flat().map(String),
        ...mockReport.mock.calls.flat().map((a) => (a instanceof Error ? a.message : String(a))),
        JSON.stringify(await prisma.auditLog.findMany({ select: { metadataJson: true, action: true } })),
      ];
      for (const s of surfaces) {
        expect(s).not.toContain(c.token);
        expect(s).not.toContain(c.code);
        expect(s).not.toContain(row.tokenHash);
        expect(s).not.toContain(row.codeHash);
      }
      // Denetim kaydı YAZILDI ama yalnız OPAK id taşıyor.
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "account.password_reset" } });
      expect(String(audit.metadataJson)).toContain(row.id);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  }, 60_000);

  // ── 8 ────────────────────────────────────────────────────────────────────
  it("8) eşik aşımı REDAKTE audit + uyarı üretir — her yanlış denemede DEĞİL", async () => {
    const c = await requestChallenge();

    // İlk 4 yanlış deneme: alarm YOK (log/Sentry DoS'u olmasın).
    for (let i = 0; i < 4; i++) {
      await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    }
    expect(mockReport).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { action: "account.password_reset_blocked" } })).toBe(0);

    // 5. deneme tavana taşır → TAM BİR KEZ uyarı.
    await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    expect(mockReport).toHaveBeenCalledTimes(1);
    const blocked = await prisma.auditLog.findMany({ where: { action: "account.password_reset_blocked" } });
    expect(blocked).toHaveLength(1);
    expect(String(blocked[0].metadataJson)).not.toContain(c.token);
    expect(String(blocked[0].metadataJson)).not.toContain(c.code);

    // Sonraki denemeler ALARM TEKRARLAMAZ (challenge başına bir kez).
    mockReport.mockClear();
    await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    expect(mockReport).not.toHaveBeenCalled();
  }, 90_000);

  // ── 9 ────────────────────────────────────────────────────────────────────
  it("9) süresi dolmuş challenge reddedilir; sweep ölüleri toplar, CANLIYA dokunmaz", async () => {
    const expired = await requestChallenge("9.9.9.1");
    await prisma.passwordResetChallenge.updateMany({
      where: {},
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: expired.token, code: expired.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(400); // süresi dolmuş → reddedildi

    // Canlı bir challenge daha ekle, sonra süpür.
    const live = await requestChallenge("9.9.9.2");
    await prisma.passwordResetChallenge.updateMany({
      where: { expiresAt: { lt: new Date() } },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60_000), expiresAt: new Date(Date.now() - 48 * 60 * 60_000) },
    });

    const removed = await sweepPasswordResetChallenges();
    expect(removed).toBe(1); // yalnız ölü satır gitti

    // CANLI satır duruyor ve HÂLÂ çalışıyor.
    const stillOk = await POST(
      req({ action: "confirm", email: EMAIL, token: live.token, code: live.code, newPassword: NEW_PASSWORD }),
    );
    expect(stillOk.status).toBe(200);
  }, 90_000);

  // ── Ek: bayrak KAPALIYKEN üretim davranışı BİREBİR eskisi ────────────────
  it("BAYRAK KAPALI: hiç challenge yazılmaz, eski akış aynen çalışır", async () => {
    vi.stubEnv("PASSWORD_RESET_CHALLENGE_ENABLED", "0");
    const res = await POST(req({ action: "request", email: EMAIL }, "8.8.8.8"));
    expect(res.status).toBe(200);
    expect(await prisma.passwordResetChallenge.count()).toBe(0);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.pwResetCodeHash).not.toBeNull(); // eski kolon yazıldı
  }, 60_000);
});
