import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// OAUTH O2 / O4 / O5 (Codex 11-10) — BAĞLANTI NİYETİ. Gerçek PostgreSQL + gerçek rotalar; sağlayıcı çağrıları taklit.
//  O2: geciken OAuth dönüşü, ev sahibinin daha YENİ kararını (bağlantıyı kaldırma, elle anahtar, akışı yeniden başlatma) EZMEZ.
//  O5: dönüş adresi aynı durum değeriyle ikinci kez çağrılınca sağlayıcıya yetki kodu isteği GİTMEZ (tek kullanımlık).
//  O4: doğrulama sırasındaki kesinti (hız sınırı / sağlayıcı arızası / ağ) "anahtar geçersiz" diye gösterilmez ve operatör haberdar edilir.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { exchangeMock, verifyMock } = vi.hoisted(() => ({ exchangeMock: vi.fn(), verifyMock: vi.fn() }));
vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return { ...actual, exchangeCodeForToken: exchangeMock };
});
vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return { ...actual, verifyToken: verifyMock };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) };
});

import { GET as authorize } from "@/app/api/hospitable/oauth/authorize/route";
import { GET as callback } from "@/app/api/hospitable/oauth/callback/route";
import { POST as connect } from "@/app/api/hospitable/connect/route";
import { OAUTH_STATE_COOKIE, HospitableOAuthError } from "@/lib/hospitable-oauth";
import { HospitableError } from "@/lib/hospitable";
import {
  clearOrgHospitableToken,
  setOrgHospitableToken,
  getOrgHospitableToken,
  connectIntentLockName,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";
import { reportError } from "@/lib/report-error";

const tokens = (n = "oauth") => ({ accessToken: `at-${n}`, refreshToken: `rt-${n}`, expiresAt: new Date(Date.now() + 3_600_000) });

async function startFlow() {
  const res = await authorize(new NextRequest("http://localhost/api/hospitable/oauth/authorize", { headers: { host: "www.lixusai.com" } }));
  const cookie = res.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const state = new URL(res.headers.get("location")!).searchParams.get("state") ?? "";
  return { cookie, state };
}
const callbackReq = (state: string, cookie: string) =>
  new NextRequest(`http://localhost/api/hospitable/oauth/callback?state=${state}&code=authcode`, {
    headers: { host: "www.lixusai.com", cookie: `${OAUTH_STATE_COOKIE}=${cookie}` },
  });
const outcome = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("hospitable");
const orgRow = (id: string) => prisma.organization.findUniqueOrThrow({ where: { id }, select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true, hospitableConnectedAt: true } });
const intentRow = (id: string) => prisma.systemLock.findUnique({ where: { name: connectIntentLockName(id) } });

let orgId = "";

beforeEach(async () => {
  await resetDb();
  resetPrimaryOrgCache();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_ID", "cid");
  vi.stubEnv("HOSPITABLE_OAUTH_CLIENT_SECRET", "cs");
  exchangeMock.mockReset();
  verifyMock.mockReset();
  exchangeMock.mockImplementation(async () => tokens());
  verifyMock.mockImplementation(async () => ({ properties: 3, name: "Host" }));
  // Birincil (en eski) işletme ortak ortam anahtarına düşebilir; testin işletmesi ikinci olsun.
  await prisma.organization.create({ data: { name: "İlk" } });
  await new Promise((r) => setTimeout(r, 5));
  const org = await prisma.organization.create({ data: { name: "Lale" } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "s@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "s@x.com", name: "Sahip", sessionEpoch: 0 };
});

describe("OAuth bağlantı niyeti — tek kullanım ve geciken dönüş (O2 / O5)", () => {
  it("KONTROL: akış baştan sona → bağlandı; anahtarlar kaydedildi, niyet kaydı kalmadı", async () => {
    const { cookie, state } = await startFlow();
    expect((await intentRow(orgId))?.holder).toBe(state);
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("connected");
    expect(await getOrgHospitableToken(orgId)).toBe("at-oauth");
    expect(await intentRow(orgId)).toBeNull();
    expect(exchangeMock).toHaveBeenCalledTimes(1);
  });

  it("🚨 O5: aynı dönüş adresi tekrar tekrar çağrılırsa sağlayıcıya yalnız İLKİNDE yetki kodu gider", async () => {
    const { cookie, state } = await startFlow();
    exchangeMock.mockRejectedValueOnce(new HospitableOAuthError("Token request failed (400 invalid_grant)", true));
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("invalid_token");
    for (let i = 0; i < 5; i++) expect(outcome(await callback(callbackReq(state, cookie)))).toBe("state_mismatch");
    expect(exchangeMock).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 6 (her tekrar bir sağlayıcı isteği)
    expect((await orgRow(orgId)).hospitableTokenEnc).toBeNull();
  });

  it("🚨 O5: başarılı bağlantıdan sonra aynı dönüş yeniden oynatılamaz (anahtarlar yeniden yazılmaz, sağlayıcıya gidilmez)", async () => {
    const { cookie, state } = await startFlow();
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("connected");
    const before = await orgRow(orgId);
    exchangeMock.mockImplementation(async () => tokens("replayed"));
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("state_mismatch");
    expect(exchangeMock).toHaveBeenCalledTimes(1);
    expect(await orgRow(orgId)).toEqual(before);
  });

  it("🚨 O2: yetki kodu anahtara çevrilirken ev sahibi bağlantıyı KALDIRIRSA geç gelen dönüş bağlantıyı geri getirmez", async () => {
    await setOrgHospitableToken(orgId, "pat-eski-baglanti", "2 mülk");
    const { cookie, state } = await startFlow();
    exchangeMock.mockImplementationOnce(async () => {
      await clearOrgHospitableToken(orgId); // başka sekmede "Bağlantıyı kaldır"
      return tokens();
    });
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("context_changed"); // ⬅️ ESKİDE "connected"
    const row = await orgRow(orgId);
    expect(row.hospitableTokenEnc).toBeNull(); // ⬅️ ESKİDE dolu (kaldırılan bağlantı geri gelmişti)
    expect(row.hospitableConnectedAt).toBeNull();
    expect(await getOrgHospitableToken(orgId)).toBeNull();
  });

  it("🚨 O2: o arada elle girilen YENİ anahtarı geç gelen dönüş ezmez", async () => {
    const { cookie, state } = await startFlow();
    exchangeMock.mockImplementationOnce(async () => {
      await setOrgHospitableToken(orgId, "pat-yeni-anahtar-123", "4 mülk");
      return tokens();
    });
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("context_changed");
    expect(await getOrgHospitableToken(orgId)).toBe("pat-yeni-anahtar-123"); // ⬅️ ESKİDE "at-oauth"
    expect((await orgRow(orgId)).hospitableRefreshTokenEnc).toBeNull();
  });

  it("🚨 O2: bağlan → kaldır aynı aralıkta olursa (başlangıçtaki 'bağlı değil' durumuna geri dönülse de) geç dönüş yazmaz", async () => {
    const { cookie, state } = await startFlow();
    exchangeMock.mockImplementationOnce(async () => {
      await setOrgHospitableToken(orgId, "pat-gecici-anahtar-1", "1 mülk");
      await clearOrgHospitableToken(orgId);
      return tokens();
    });
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("context_changed");
    expect((await orgRow(orgId)).hospitableTokenEnc).toBeNull();
  });

  it("🚨 akış YENİDEN başlatıldıysa eski sekmenin dönüşü geçersizdir (sağlayıcıya gidilmez); yeni akış bağlanır", async () => {
    const first = await startFlow();
    const second = await startFlow();
    expect(second.state).not.toBe(first.state);
    expect(outcome(await callback(callbackReq(first.state, first.cookie)))).toBe("state_mismatch");
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(outcome(await callback(callbackReq(second.state, second.cookie)))).toBe("connected");
  });

  it("süresi dolmuş niyet tüketilemez", async () => {
    const { cookie, state } = await startFlow();
    await prisma.systemLock.update({ where: { name: connectIntentLockName(orgId) }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("state_mismatch");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("niyet İŞLETMEYE aittir: başka işletmenin bekleyen akışı bu işletmenin dönüşünü geçerli kılmaz", async () => {
    const { cookie, state } = await startFlow();
    // Aynı durum değeri başka işletmenin satırında dursa bile bu işletmenin satırı yoksa dönüş reddedilir.
    await prisma.systemLock.deleteMany({ where: { name: connectIntentLockName(orgId) } });
    await prisma.systemLock.create({ data: { name: connectIntentLockName("baska-isletme"), holder: state, lockedUntil: new Date(Date.now() + 60_000) } });
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("state_mismatch");
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});

describe("doğrulama kesintisi ≠ geçersiz anahtar (O4)", () => {
  const transient: Array<[string, HospitableError]> = [
    ["hız sınırı (429)", new HospitableError("Hospitable API hatası (HTTP 429)", 429)],
    ["sağlayıcı arızası (503)", new HospitableError("Hospitable API hatası (HTTP 503)", 503)],
    ["ağ / zaman aşımı", new HospitableError("Hospitable'a ulaşılamadı: fetch failed")],
  ];

  it.each(transient)("🚨 OAuth dönüşü — %s: 'bağlantı kurulamadı' denir (anahtar geçersiz DEĞİL) ve operatör haberdar edilir", async (_label, err) => {
    const { cookie, state } = await startFlow();
    verifyMock.mockRejectedValueOnce(err);
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("exchange_failed"); // ⬅️ ESKİDE "invalid_token"
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 0
    expect((await orgRow(orgId)).hospitableTokenEnc).toBeNull();
  });

  it.each([401, 402, 403])("KONTROL: OAuth dönüşü — sağlayıcı anahtarı / hesabı GERÇEKTEN reddederse (%i) 'geçersiz' denir, alarm yok", async (status) => {
    const { cookie, state } = await startFlow();
    verifyMock.mockRejectedValueOnce(new HospitableError(`Hospitable API hatası (HTTP ${status})`, status));
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("invalid_token");
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });

  const connectReq = (body: unknown) =>
    new NextRequest("http://localhost/api/hospitable/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it.each(transient)("🚨 elle anahtar — %s: 'şu anda ulaşılamadı' (503), anahtar saklanmaz, operatör haberdar edilir", async (_label, err) => {
    verifyMock.mockRejectedValueOnce(err);
    const res = await connect(connectReq({ token: "dogru-olabilecek-anahtar-123" }));
    expect(res.status).toBe(503); // ⬅️ ESKİDE 400 "Token geçersiz ya da Hospitable'a ulaşılamadı."
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Hospitable'a şu anda ulaşılamadı. Birazdan tekrar deneyin.");
    expect(data.error).not.toContain("geçersiz");
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect((await orgRow(orgId)).hospitableTokenEnc).toBeNull();
  });

  it("KONTROL: elle anahtar — sağlayıcı 401 derse 'Token geçersiz.' (400), alarm yok", async () => {
    verifyMock.mockRejectedValueOnce(new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    const res = await connect(connectReq({ token: "yanlis-anahtar-123456" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Token geçersiz.");
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });

  it("🚨 O2: elle anahtar bağlamak bekleyen OAuth akışını geçersiz kılar (sonradan gelen dönüş yazmaz, sağlayıcıya gitmez)", async () => {
    const { cookie, state } = await startFlow();
    const res = await connect(connectReq({ token: "elle-girilen-anahtar-1" }));
    expect(res.status).toBe(200);
    expect(await intentRow(orgId)).toBeNull();
    expect(outcome(await callback(callbackReq(state, cookie)))).toBe("state_mismatch");
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(await getOrgHospitableToken(orgId)).toBe("elle-girilen-anahtar-1");
  });
});
