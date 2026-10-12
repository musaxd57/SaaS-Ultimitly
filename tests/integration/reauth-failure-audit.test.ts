// ---------------------------------------------------------------------------
// HATALI YENİDEN DOĞRULAMA DENETİM KAYDINA YAZILIR (DENETIM 2026-08-09 #8, kısmi — 10-12 gece). Başarılı 2FA / hesap silme işlemleri
// kayıtlıydı; hatalı şifre / kod denemesi yalnız günlük sayaçtaydı → ele geçirilmiş oturumla yapılan tahminler iz bırakmıyordu.
// Kayıt yalnız işlem adını taşır (şifre / kod YOK); bürünmede gerçek aktör operatördür. Doğru şifrede kayıt YOK (kontrol).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import type { SessionPayload } from "@/lib/auth";
import { noteReauthFailure } from "@/lib/auth/reauth-guard";
import { totp } from "@/lib/auth/totp";

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
    clearSessionCookie: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST as twoFactor } from "@/app/api/account/2fa/route";
import { POST as deleteAccount } from "@/app/api/account/delete/route";

const PASSWORD = "Doğru-Parola-2026!";
const json = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function failedAudits() {
  return prisma.auditLog.findMany({ where: { action: "account.reauth_failed" }, orderBy: { createdAt: "asc" } });
}

describe("hatalı yeniden doğrulama → denetim kaydı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword(PASSWORD), role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("🚨 2FA kurulumunda yanlış şifre → kayıt (işlem adı, aktör); şifre kayıtta YOK", async () => {
    const res = await twoFactor(json("http://localhost/api/account/2fa", { action: "setup", password: "yanlis-parola-1" }));
    expect(res.status).toBe(400);
    const [a] = await failedAudits();
    expect(a).toMatchObject({ organizationId: session.organizationId, actorUserId: session.userId });
    expect(JSON.parse(a.metadataJson!)).toEqual({ operation: "2fa_setup" });
    expect(a.metadataJson).not.toContain("yanlis-parola");
  });

  it("🚨 hesap silmede yanlış şifre → kayıt; hesap SİLİNMEZ", async () => {
    const res = await deleteAccount(json("http://localhost/api/account/delete", { password: "yanlis-parola-2" }));
    expect(res.status).toBe(400);
    const [a] = await failedAudits();
    expect(JSON.parse(a.metadataJson!)).toEqual({ operation: "account_delete" });
    expect(await prisma.organization.count({ where: { id: session.organizationId } })).toBe(1);
  });

  it("bürünmede (destek görünümü) rota yeniden doğrulamaya HİÇ girmez → kayıt yok (K8 salt-okunur)", async () => {
    // Haiku 10-12: eski hâli boş olabilecek bir dizi üzerinde döngüydü (bürünme daha önce 403) — hiçbir şey iddia etmiyordu.
    session = { ...session, actorUserId: "operator-1" } as SessionPayload;
    const res = await twoFactor(json("http://localhost/api/account/2fa", { action: "setup", password: "yanlis-parola-3" }));
    expect(res.status).toBe(403);
    expect(await failedAudits()).toEqual([]);
  });

  it("kayıt yazıcısı bürünme oturumunda gerçek aktörü (operatör) yazar — yolu açılırsa iz doğru kişide", async () => {
    await noteReauthFailure({ ...session, actorUserId: "operator-1" }, "account_delete");
    const [a] = await failedAudits();
    expect(a.actorUserId).toBe("operator-1");
  });

  it("🚨 2FA açarken yanlış kod → kayıt (`2fa_enable`); 2FA AÇILMAZ", async () => {
    const setup = await twoFactor(json("http://localhost/api/account/2fa", { action: "setup", password: PASSWORD }));
    const { secret } = (await setup.json()) as { secret: string };
    // Penceredeki (±1 adım) geçerli kodların hiçbiri olmayan kod — tesadüfi isabet yok.
    const valid = new Set([-30_000, 0, 30_000].map((d) => totp(secret, Date.now() + d)));
    const wrong = ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
    const res = await twoFactor(json("http://localhost/api/account/2fa", { action: "enable", code: wrong }));
    expect(res.status).toBe(400);
    const audits = await failedAudits();
    expect(audits.map((a) => JSON.parse(a.metadataJson!))).toEqual([{ operation: "2fa_enable" }]);
    expect((await prisma.user.findUnique({ where: { id: session.userId } }))!.twoFactorEnabledAt).toBeNull();
  });

  it("KONTROL: doğru şifrede hatalı deneme kaydı YOK", async () => {
    const res = await twoFactor(json("http://localhost/api/account/2fa", { action: "setup", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await failedAudits()).toEqual([]);
  });
});
