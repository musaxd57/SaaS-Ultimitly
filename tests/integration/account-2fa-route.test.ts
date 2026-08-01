import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// requireSession reads the cookie in production; mock it to our seeded user so we
// can drive the route handler directly.
let session: SessionPayload;
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
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "x", role: "owner" },
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
    const res = await POST(req({ action: "setup" }));
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

    const res = await POST(req({ action: "setup" }));
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
    const res = await POST(req({ action: "setup" }));
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
