import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİMLİK A27 (Codex 11-10) — ESKİ DENEME YENİ ŞİFRE KODUNU SİLMEZ. Gerçek PostgreSQL.
//
// Şifre değiştirmede kod onayı önce bir "deneme hakkı" alır; alamazsa (kodun süresi dolmuş ya da hakkı bitmiş) kodu KOŞULSUZ siliyordu.
// Hak alınamadıktan sonra, silmeden önce kullanıcı başka sekmede "Kodu tekrar gönder" derse az önce yazılan YENİ kod da gidiyordu:
// e-postası kutuya düşen kod "artık kullanılamıyor" cevabı alıyordu. Test tam o araya yeni bir kod yazar.
//
// ⚠️ Ayrı dosya: Prisma temsilcisine kurulan casus aynı dosyadaki sonraki testlere sızıyor.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});
const sendReporting = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: (...a: unknown[]) => (sendReporting as (...x: unknown[]) => unknown)(...a) },
}));

import { POST as changePassword } from "@/app/api/account/password/route";

const NEW_CODE = "87654321";
let userId = "";
/** Açıkken: hak alma yazımı (deneme sayacı artışı) döndükten HEMEN sonra, başka sekmenin istediği yeni kod yazılır. */
let injectNewCodeAfterClaim = false;
let injected = 0;

async function writeNewCode() {
  await prisma.user.update({
    where: { id: userId },
    data: { pwChangeCodeHash: await hashPassword(NEW_CODE), pwChangeCodeExpiresAt: new Date(Date.now() + 10 * 60_000), pwChangeCodeAttempts: 0 },
  });
}

beforeAll(() => {
  const realUpdateMany = prisma.user.updateMany.bind(prisma.user);
  vi.spyOn(prisma.user, "updateMany").mockImplementation((async (args: { data?: Record<string, unknown> }) => {
    const out = await realUpdateMany(args as Parameters<typeof realUpdateMany>[0]);
    const isClaim = Boolean(args?.data && "pwChangeCodeAttempts" in args.data && !("pwChangeCodeHash" in args.data));
    if (injectNewCodeAfterClaim && isClaim) {
      injectNewCodeAfterClaim = false;
      injected++;
      await writeNewCode();
    }
    return out;
  }) as unknown as typeof prisma.user.updateMany);
});

function confirmReq(code: string) {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.9" },
    body: JSON.stringify({ action: "confirm", code, newPassword: "yeni-parola-2" }),
  });
}
function requestReq() {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.9" },
    body: JSON.stringify({ action: "request" }),
  });
}
const codeRow = () => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pwChangeCodeHash: true, pwChangeCodeExpiresAt: true, pwChangeCodeAttempts: true, passwordHash: true } });

describe("şifre değiştirme — eski deneme yeni kodu silmez (A27)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.unstubAllEnvs();
    sendReporting.mockReset();
    sendReporting.mockResolvedValue({ ok: true });
    injectNewCodeAfterClaim = false;
    injected = 0;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword("eski-parola-1"), role: "owner", sessionEpoch: 1, emailVerifiedAt: new Date() },
    });
    userId = user.id;
    session = { userId, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 1 };
  });

  it("🚨 SÜRESİ DOLMUŞ kodla onay denemesi sürerken yeni kod istenirse: eski deneme reddedilir, YENİ kod yerinde kalır ve çalışır", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() - 60_000), pwChangeCodeAttempts: 0 },
    });
    injectNewCodeAfterClaim = true;
    const stale = await changePassword(confirmReq("12345678"));
    expect(injected).toBe(1); // araya girme gerçekten kuruldu
    expect(stale.status).toBe(400);

    const row = await codeRow();
    expect(row.pwChangeCodeHash).not.toBeNull(); // ⬅️ ESKİDE null (yeni kod silinmişti)
    expect(await verifyPassword(NEW_CODE, row.pwChangeCodeHash!)).toBe(true);
    expect(row.pwChangeCodeAttempts).toBe(0);

    const ok = await changePassword(confirmReq(NEW_CODE));
    expect(ok.status).toBe(200); // ⬅️ ESKİDE 400 "Bu kod artık kullanılamıyor"
    expect(await verifyPassword("yeni-parola-2", (await codeRow()).passwordHash!)).toBe(true);
  });

  it("🚨 DENEME HAKKI BİTMİŞ kodla onay sürerken yeni kod istenirse yeni kod yerinde kalır", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() + 5 * 60_000), pwChangeCodeAttempts: 5 },
    });
    injectNewCodeAfterClaim = true;
    expect((await changePassword(confirmReq("12345678"))).status).toBe(400);
    expect(injected).toBe(1);
    const row = await codeRow();
    expect(row.pwChangeCodeHash).not.toBeNull();
    expect(await verifyPassword(NEW_CODE, row.pwChangeCodeHash!)).toBe(true);
  });

  it("KONTROL: araya yeni kod GİRMEZSE süresi dolmuş kod yine yakılır (ölü kod ortada kalmaz)", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() - 60_000), pwChangeCodeAttempts: 0 },
    });
    expect((await changePassword(confirmReq("12345678"))).status).toBe(400);
    const row = await codeRow();
    expect(row.pwChangeCodeHash).toBeNull();
    expect(row.pwChangeCodeExpiresAt).toBeNull();
  });

  it("KONTROL: araya yeni kod girmezse deneme hakkı bitmiş kod yine yakılır — doğru kod da artık çalışmaz", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: new Date(Date.now() + 5 * 60_000), pwChangeCodeAttempts: 5 },
    });
    expect((await changePassword(confirmReq("12345678"))).status).toBe(400);
    expect((await codeRow()).pwChangeCodeHash).toBeNull();
    expect(await verifyPassword("eski-parola-1", (await codeRow()).passwordHash!)).toBe(true);
  });

  it("KONTROL: süresi yazılmamış artık kod (bozuk satır) da yakılır", async () => {
    await prisma.user.update({ where: { id: userId }, data: { pwChangeCodeHash: await hashPassword("12345678"), pwChangeCodeExpiresAt: null, pwChangeCodeAttempts: 0 } });
    expect((await changePassword(confirmReq("12345678"))).status).toBe(400);
    expect((await codeRow()).pwChangeCodeHash).toBeNull();
  });

  it("🚨 e-posta GÖNDERİLEMEYEN istek, o sırada yazılmış DAHA YENİ kodu silmez (kuyruk kapalı yol)", async () => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "0");
    // Sağlayıcı çağrısı sürerken ikinci istek yeni kod yazar; sonra ilk isteğin gönderimi başarısız döner.
    sendReporting.mockImplementationOnce(async () => {
      await writeNewCode();
      return { ok: false };
    });
    const res = await changePassword(requestReq());
    expect(res.status).toBe(400);
    const row = await codeRow();
    expect(row.pwChangeCodeHash).not.toBeNull(); // ⬅️ ESKİDE null
    expect(await verifyPassword(NEW_CODE, row.pwChangeCodeHash!)).toBe(true);
  });

  it("KONTROL: e-posta gönderilemezse ve araya yeni kod girmediyse isteğin kendi kodu silinir", async () => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "0");
    sendReporting.mockResolvedValueOnce({ ok: false });
    expect((await changePassword(requestReq())).status).toBe(400);
    expect((await codeRow()).pwChangeCodeHash).toBeNull();
  });
});
