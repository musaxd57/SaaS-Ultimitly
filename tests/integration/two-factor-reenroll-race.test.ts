import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { totp } from "@/lib/auth/totp";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// CODEX 09-30 (C1): 2FA KAPATMA / KURTARMA KODU — ESKİ SIRRIN KODU YENİ KURULUMA DOKUNAMAZ. Rota kodu başta okuduğu sırra
// göre doğruluyor, sonra KOŞULSUZ yazıyordu: arada 2FA yeni bir sırla yeniden kurulduysa (başka oturum) eski sırrın koduna
// dayanan istek YENİ kurulumu siliyor ya da yeni kurulum için 10 kalıcı kurtarma kodu üretiyordu. Yarış, kod yakma adımının
// hemen ardından eşzamanlı yeniden kurulumu enjekte eden bir casusla deterministik kurulur (casus bu dosyada kalır — Prisma
// temsilcisine vi.spyOn sonraki dosyalara sızmasın).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined), setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined) };
});

import { POST } from "@/app/api/account/2fa/route";

const OLD = "ABCDEFGHIJKLMNOP";
const NEW = "QRSTUVWXYZ234567";
const newEnc = encryptSecret(NEW);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Kod yakma yazmasının hemen ardından BAŞKA bir oturum 2FA'yı yeni sırla yeniden kurar. Casus dosya başında BİR KEZ kurulur ve
 * hiç geri alınmaz (Prisma temsilcisinde geri alma yöntemi siliyor); davranış `armed` bayrağıyla açılır, dosya sonunda casus
 * aynen geçirir.
 */
let armed = false;
const originalUpdateMany = prisma.user.updateMany.bind(prisma.user);
vi.spyOn(prisma.user, "updateMany").mockImplementation((async (args: Parameters<typeof originalUpdateMany>[0]) => {
  const result = await originalUpdateMany(args);
  const where = (args?.where ?? {}) as Record<string, unknown>;
  if (armed && "OR" in where && (args?.data as Record<string, unknown>)?.twoFactorLastStep !== undefined) {
    armed = false;
    await originalUpdateMany({
      where: { id: session.userId },
      data: { twoFactorSecret: newEnc, twoFactorEnabledAt: new Date(Date.now() + 1_000), twoFactorLastStep: null },
    });
    await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: session.userId } });
  }
  return result;
}) as never);
function reenrollRightAfterBurn() {
  armed = true;
}

describe("2FA yeniden kurulum yarışı (Codex 09-30 C1)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email: "u@example.com",
        passwordHash: await hashPassword("dogru-sifre-42"),
        role: "owner",
        twoFactorSecret: encryptSecret(OLD),
        twoFactorEnabledAt: new Date(),
      },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });
  afterEach(() => {
    armed = false;
  });

  it("🚨 disable: ESKİ sırrın kodu, arada yeniden kurulan YENİ 2FA'yı silemez", async () => {
    reenrollRightAfterBurn();
    const res = await POST(req({ action: "disable", code: totp(OLD) }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorSecret).toBe(newEnc);
    expect(u.twoFactorEnabledAt).not.toBeNull();
  });

  it("🚨 recovery_codes: ESKİ sırrın koduyla YENİ 2FA için kurtarma kodu ÜRETİLEMEZ", async () => {
    reenrollRightAfterBurn();
    const res = await POST(req({ action: "recovery_codes", code: totp(OLD) }));
    expect(res.status).toBe(400);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("KONTROL — yarış yokken disable ve kurtarma kodu üretimi çalışır", async () => {
    const codes = await POST(req({ action: "recovery_codes", code: totp(OLD) }));
    expect(codes.status).toBe(200);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(10);
    await prisma.user.update({ where: { id: session.userId }, data: { twoFactorLastStep: null } });
    const off = await POST(req({ action: "disable", code: totp(OLD) }));
    expect(off.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.twoFactorSecret).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId } })).toBe(0);
  });
});
