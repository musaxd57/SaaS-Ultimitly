import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { totp } from "@/lib/auth/totp";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİMLİK A2 (Codex 11-10) — BEKLEYEN 2FA KURULUMU: İPTAL EDİLMİŞ OTURUM YAZAMAZ, ESKİ EKRAN YANILTMAZ. Gerçek PostgreSQL.
//
// (1) Kurulum isteği, başında denetlenen oturumla başlar ve şifre karşılaştırmasından (yavaş) sonra bekleyen sırrı yazar. O arada parola
//     sıfırlanırsa oturum iptal edilir; bayat istek yine de yazıyor ve sıfırlamadan SONRA yeni oturumla başlatılmış kurulumu eziyordu.
//     Testte oturum denetimi taklittir: isteğin "başında geçerliydi, yazarken artık değil" hâli, kayıttaki kuşak ilerletilerek kurulur.
// (2) İki sekmede iki kurulum (son yazan kazanır): eski sekme geçersiz sırrı gösterir; oradan gelen kod "Kod hatalı" alıyor, kullanıcı
//     nedenini bilmeden deneme hakkını tüketiyordu. Ekran artık kurulum kimliğini yollar; uymuyorsa kod hiç denenmez.
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

const PW = "dogru-sifre-42";
const NEWER = "QRSTUVWXYZ234567";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
/** Hatalı yeniden doğrulama denemeleri: her biri hem günlük sayaca hem denetim kaydına yazılır — kayıt sayısı sayacın aynasıdır. */
const failedAttempts = () => prisma.auditLog.count({ where: { action: "account.reauth_failed" } });
const row = () => prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { twoFactorSecret: true, twoFactorEnabledAt: true, sessionEpoch: true } });

describe("2FA kurulumu — iptal edilmiş oturum ve eski ekran (A2)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword(PW), role: "owner", sessionEpoch: 3 },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 3 };
  });

  it("🚨 oturum arada iptal edildiyse (parola sıfırlandı) bayat kurulum isteği YAZMAZ: yeni oturumun bekleyen kurulumu yerinde kalır, cevap 401", async () => {
    // Sıfırlama oldu (kuşak 3 → 4) ve yeni oturum kendi kurulumunu başlattı.
    await prisma.user.update({ where: { id: session.userId }, data: { sessionEpoch: 4, twoFactorSecret: encryptSecret(NEWER) } });
    // Bayat istek hâlâ ESKİ şifreyi biliyor olabilir; burada kayıtlı şifreyle geçer — durduran şifre değil, oturum kuşağı olmalı.
    const res = await POST(req({ action: "setup", password: PW }));
    expect(res.status).toBe(401); // ⬅️ ESKİDE 200 + yeni kurulumun üzerine yazılmış sır
    const body = await res.json();
    expect(body.secret).toBeUndefined();
    const after = await row();
    expect(decryptSecret(after.twoFactorSecret!)).toBe(NEWER);
    expect(after.twoFactorEnabledAt).toBeNull();
  });

  it("KONTROL: geçerli oturumda kurulum çalışır; sır kayda yazılır ve kurulum kimliği döner (sırrın kendisi / parçası değildir)", async () => {
    const res = await POST(req({ action: "setup", password: PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(decryptSecret((await row()).twoFactorSecret!)).toBe(body.secret);
    expect(body.setupId).toMatch(/^[0-9a-f]{24}$/);
    expect(String(body.setupId)).not.toContain(String(body.secret).toLowerCase());
  });

  it("KONTROL: 2FA zaten açıkken oturum kuşağı da eskiyse cevap 'zaten etkin' kalır (401'e dönmez) ve sır değişmez", async () => {
    await prisma.user.update({ where: { id: session.userId }, data: { sessionEpoch: 4, twoFactorSecret: encryptSecret(NEWER), twoFactorEnabledAt: new Date() } });
    const res = await POST(req({ action: "setup", password: PW }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields._).toMatch(/şu an etkin/);
    expect(decryptSecret((await row()).twoFactorSecret!)).toBe(NEWER);
  });

  it("🚨 iki sekmede iki kurulum: ESKİ ekranın kodu denenmez — 'kurulum durumu değişti' denir, hatalı deneme SAYILMAZ, 2FA açılmaz", async () => {
    const first = await (await POST(req({ action: "setup", password: PW }))).json();
    const second = await (await POST(req({ action: "setup", password: PW }))).json();
    expect(second.setupId).not.toBe(first.setupId);

    const stale = await POST(req({ action: "enable", code: totp(first.secret), setupId: first.setupId }));
    expect(stale.status).toBe(400);
    const body = await stale.json();
    expect(body.fields._).toMatch(/Kurulum durumu değişti/); // ⬅️ ESKİDE fields.code "Kod hatalı veya süresi geçmiş."
    expect(body.fields.code).toBeUndefined();
    expect(await failedAttempts()).toBe(0); // eski ekranın isteği hatalı deneme sayılmadı (günlük tavana işlemedi)
    expect((await row()).twoFactorEnabledAt).toBeNull();

    // Güncel ekran, kendi koduyla açar.
    const ok = await POST(req({ action: "enable", code: totp(second.secret), setupId: second.setupId }));
    expect(ok.status).toBe(200);
    expect((await row()).twoFactorEnabledAt).not.toBeNull();
  });

  it("🚨 kurulum kimliği kodu ATLATMAZ: doğru kimlik + yanlış kod reddedilir ve deneme SAYILIR", async () => {
    const s = await (await POST(req({ action: "setup", password: PW }))).json();
    const res = await POST(req({ action: "enable", code: "000000", setupId: s.setupId }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.code).toMatch(/Kod hatalı/);
    expect(await failedAttempts()).toBe(1);
    expect((await row()).twoFactorEnabledAt).toBeNull();
  });

  it("uydurma kurulum kimliği de kodu denetmez: 2FA açılmaz, deneme sayılmaz (kimlik bir tahmin yüzeyi değildir)", async () => {
    const s = await (await POST(req({ action: "setup", password: PW }))).json();
    const res = await POST(req({ action: "enable", code: totp(s.secret), setupId: "0".repeat(24) }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields._).toMatch(/Kurulum durumu değişti/);
    expect(await failedAttempts()).toBe(0);
    expect((await row()).twoFactorEnabledAt).toBeNull();
  });

  it("KONTROL: kimlik göndermeyen (eski) ekran aynen çalışır — kod kayıtlı sırla denenir", async () => {
    const s = await (await POST(req({ action: "setup", password: PW }))).json();
    const ok = await POST(req({ action: "enable", code: totp(s.secret) }));
    expect(ok.status).toBe(200);
  });
});
