import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  getOrgHospitableToken,
  setOrgHospitableOAuthTokens,
  getConnectionInfo,
  resetPrimaryOrgCache,
  oauthRefreshLockName,
  __setOAuthRefreshWaitForTests,
} from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// OAUTH O1 (Codex 11-10) — EŞZAMANLI YENİLEME SAĞLAM BAĞLANTIYI DÜŞÜRMEZ. Gerçek PostgreSQL; sağlayıcı, DÖNEN (tek kullanımlık) yenileme
// anahtarlarını taklit eder: aynı anahtarla gelen ikinci istek "invalid_grant" alır.
//
// İki istek aynı yenileme anahtarını kullanıyordu. İlki başarılı olup yeni anahtarı kaydetmeyi beklerken ikincisi "anahtar geçersiz"
// cevabını alıyor ve (kayıt hâlâ eski anahtar olduğu için) bağlantıyı iptal ediyordu; ardından başarılı sonuç da "bağlantı değişti" diye
// atılıyordu — ev sahibi elinde geçerli anahtar varken yeniden bağlanmak zorunda kalıyordu. Artık bir işletmenin yenilemesini aynı anda
// tek istek yapar: aynı süreçte çağrılar tek isteği paylaşır; başka süreç yeniliyorsa sağlayıcıya gidilmez, sonucu beklenir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return { ...actual, getHospitableOAuthConfig: vi.fn(), refreshAccessToken: vi.fn() };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { getHospitableOAuthConfig, refreshAccessToken, HospitableOAuthError } from "@/lib/hospitable-oauth";
const mockGetConfig = vi.mocked(getHospitableOAuthConfig);
const mockRefresh = vi.mocked(refreshAccessToken);

const FAKE_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
};
const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fresh = (n: string) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: new Date(Date.now() + 12 * HOUR) });

/** DÖNEN anahtarlı sağlayıcı: her yenileme anahtarı BİR KEZ kullanılabilir; ilk kullanım `delayMs` sürer. */
function rotatingProvider(delayMs: number) {
  const spent = new Set<string>();
  mockRefresh.mockImplementation(async (_cfg, refreshToken: string) => {
    if (spent.has(refreshToken)) throw new HospitableOAuthError("Token request failed (400 invalid_grant)", true);
    spent.add(refreshToken);
    await sleep(delayMs);
    return fresh("new");
  });
}

/**
 * Kilit deposu arızası taklidi: açıkken kilit satırı yazımı fırlatır (kod "kilitsiz devam et" der). Casus dosya başında BİR KEZ kurulur
 * ve geri alınmaz (Prisma temsilcisinde geri alma yöntemi siliyor); kapalıyken aynen geçirir.
 */
let lockStoreDown = false;
/** Doluyken: bu çağrı kilidi ALMADAN hemen önce çalışır (başka bir kopyanın yenilemesi tam o arada bitti). Tek atımlık. */
let beforeLockClaim: null | (() => Promise<void>) = null;
const realCreateMany = prisma.systemLock.createMany.bind(prisma.systemLock);
vi.spyOn(prisma.systemLock, "createMany").mockImplementation((async (args: Parameters<typeof realCreateMany>[0]) => {
  if (lockStoreDown) throw new Error("lock store down");
  if (beforeLockClaim) {
    const run = beforeLockClaim;
    beforeLockClaim = null;
    await run();
  }
  return realCreateMany(args);
}) as never);

async function expiredOrg() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await setOrgHospitableOAuthTokens(org.id, { accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() - 1000) }, "5 mülk");
  return org.id;
}

describe("OAuth yenileme — tek uçuş (O1)", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.unstubAllEnvs();
    mockRefresh.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockReturnValue(FAKE_CONFIG);
    __setOAuthRefreshWaitForTests(2_000, 40);
    lockStoreDown = false;
    beforeLockClaim = null;
  });
  afterEach(() => {
    __setOAuthRefreshWaitForTests(8_000, 250);
    lockStoreDown = false;
    beforeLockClaim = null;
  });

  it("🚨 aynı anda iki istek: sağlayıcıya TEK yenileme gider, ikisi de yeni anahtarı alır, bağlantı DÜŞMEZ", async () => {
    const orgId = await expiredOrg();
    rotatingProvider(150);
    const [a, b] = await Promise.all([getOrgHospitableToken(orgId), getOrgHospitableToken(orgId)]);
    expect(mockRefresh).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 2 (ikincisi invalid_grant alıp bağlantıyı düşürüyordu)
    expect([a, b]).toEqual(["access-new", "access-new"]);
    const info = await getConnectionInfo(orgId);
    expect(info.connected).toBe(true); // ⬅️ ESKİDE false
    // Kilit bırakıldı; sonraki çağrı yenileme yapmadan kayıtlı yeni anahtarı kullanır.
    expect(await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) } })).toBeNull();
    mockRefresh.mockClear();
    expect(await getOrgHospitableToken(orgId)).toBe("access-new");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("🚨 başka bir kopya yeniliyorsa (kilit onda) sağlayıcıya GİDİLMEZ; onun yazdığı yeni anahtar beklenip kullanılır", async () => {
    const orgId = await expiredOrg();
    await prisma.systemLock.create({ data: { name: oauthRefreshLockName(orgId), holder: "other-replica", lockedUntil: new Date(Date.now() + 30_000) } });
    // Öteki kopya 120 ms sonra yeni anahtarları yazar.
    const other = (async () => {
      await sleep(120);
      await setOrgHospitableOAuthTokens(orgId, fresh("other"), "5 mülk");
    })();
    const token = await getOrgHospitableToken(orgId);
    await other;
    expect(token).toBe("access-other");
    expect(mockRefresh).not.toHaveBeenCalled(); // ⬅️ ESKİDE çağrılır, "invalid_grant" alınca bağlantı düşerdi
    expect((await getConnectionInfo(orgId)).connected).toBe(true);
  });

  it("öteki kopya sonuç yazmadan bitirirse (kilit kalktı, anahtar aynı) bu tur anahtarsız biter; bağlantıya DOKUNULMAZ, sağlayıcıya gidilmez", async () => {
    const orgId = await expiredOrg();
    await prisma.systemLock.create({ data: { name: oauthRefreshLockName(orgId), holder: "other-replica", lockedUntil: new Date(Date.now() + 30_000) } });
    const other = (async () => {
      await sleep(100);
      await prisma.systemLock.deleteMany({ where: { name: oauthRefreshLockName(orgId) } }); // öteki yenileme başarısız bitti
    })();
    const token = await getOrgHospitableToken(orgId);
    await other;
    expect(token).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect((await getConnectionInfo(orgId)).connected).toBe(true);
    // Sonraki tur kilit boşken yeniler.
    rotatingProvider(0);
    expect(await getOrgHospitableToken(orgId)).toBe("access-new");
  });

  it("çökmüş kopyanın bayat kilidi (süresi geçmiş) yenilemeyi DURDURMAZ: kilit devralınır, yenileme yapılır", async () => {
    const orgId = await expiredOrg();
    await prisma.systemLock.create({ data: { name: oauthRefreshLockName(orgId), holder: "dead-replica", lockedUntil: new Date(Date.now() - 1_000) } });
    rotatingProvider(0);
    expect(await getOrgHospitableToken(orgId)).toBe("access-new");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) } })).toBeNull();
  });

  it("KONTROL: gerçekten ölü yenileme anahtarı (tek istek, invalid_grant) bağlantıyı yine düşürür ve kilit bırakılır", async () => {
    const orgId = await expiredOrg();
    mockRefresh.mockRejectedValue(new HospitableOAuthError("Token request failed (400 invalid_grant)", true));
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    expect((await getConnectionInfo(orgId)).connected).toBe(false);
    expect(await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) } })).toBeNull();
  });

  it("KONTROL: yenileme başarısız (geçici) olsa da kilit bırakılır — sonraki tur beklemeden yeniden dener", async () => {
    const orgId = await expiredOrg();
    mockRefresh.mockRejectedValueOnce(new HospitableOAuthError("network timeout", false));
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    expect(await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) } })).toBeNull();
    mockRefresh.mockResolvedValueOnce(fresh("recovered"));
    expect(await getOrgHospitableToken(orgId)).toBe("access-recovered");
  });

  it("🚨 kilit deposu okunamıyorken de aynı süreçteki eşzamanlı çağrılar TEK isteği paylaşır (yenileme kilit arızasında durmaz, çiftlenmez)", async () => {
    const orgId = await expiredOrg();
    rotatingProvider(120);
    lockStoreDown = true; // kilit yazılamıyor → kod "kilitsiz devam" eder; koruma süreç içi paylaşımdan gelir
    const [a, b] = await Promise.all([getOrgHospitableToken(orgId), getOrgHospitableToken(orgId)]);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual(["access-new", "access-new"]);
    expect((await getConnectionInfo(orgId)).connected).toBe(true);
  });

  it("🚨 kilit alınmadan hemen önce başka bir kopya yenilemeyi BİTİRDİYSE tüketilmiş eski anahtarla sağlayıcıya gidilmez; yazılmış yeni anahtar kullanılır", async () => {
    const orgId = await expiredOrg();
    rotatingProvider(0);
    beforeLockClaim = async () => {
      await setOrgHospitableOAuthTokens(orgId, fresh("other"), "5 mülk"); // öteki kopya yeni anahtarları yazdı ve kilidini bıraktı
    };
    expect(await getOrgHospitableToken(orgId)).toBe("access-other");
    expect(mockRefresh).not.toHaveBeenCalled(); // ⬅️ ESKİDE eski anahtarla çağrılır, "invalid_grant" alınırdı
    expect((await getConnectionInfo(orgId)).connected).toBe(true);
  });

  it("🚨 bağlantıyı düşürmek MÜNHASIRLIK ister: kilit deposu okunamıyorken gelen 'anahtar ölü' cevabı bağlantıyı KALDIRMAZ; kilit geri gelince aynı cevap kaldırır", async () => {
    const orgId = await expiredOrg();
    mockRefresh.mockRejectedValue(new HospitableOAuthError("Token request failed (400 invalid_grant)", true));
    lockStoreDown = true; // münhasırlık kanıtlanamıyor: başka bir kopya aynı anda yenilemiş olabilir
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    expect((await getConnectionInfo(orgId)).connected).toBe(true); // ⬅️ korunur (eşzamanlı yenileme varsa bu cevap yanıltıcıdır)
    lockStoreDown = false;
    expect(await getOrgHospitableToken(orgId)).toBeNull(); // münhasır deneme: anahtar gerçekten ölü
    expect((await getConnectionInfo(orgId)).connected).toBe(false);
  });

  it("🚨 deneme sırasında kilit elden çıktıysa (süresi doldu, başka kopya devraldı) 'anahtar ölü' cevabı bağlantıyı KALDIRMAZ", async () => {
    const orgId = await expiredOrg();
    mockRefresh.mockImplementationOnce(async () => {
      // Sağlayıcı çağrısı sürerken kilidi başka bir kopya devraldı (bizimki süresini doldurdu).
      await prisma.systemLock.updateMany({ where: { name: oauthRefreshLockName(orgId) }, data: { holder: "other-replica", lockedUntil: new Date(Date.now() + 30_000) } });
      throw new HospitableOAuthError("Token request failed (400 invalid_grant)", true);
    });
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    expect((await getConnectionInfo(orgId)).connected).toBe(true);
    // Öteki kopyanın kilidine dokunulmadı (yalnız kendi kilidimizi bırakırız).
    expect((await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) } }))?.holder).toBe("other-replica");
  });

  it("iki ayrı işletmenin yenilemeleri birbirini beklemez (kilit işletme başına)", async () => {
    const a = await expiredOrg();
    const b = await expiredOrg();
    await prisma.systemLock.create({ data: { name: oauthRefreshLockName(a), holder: "other-replica", lockedUntil: new Date(Date.now() + 30_000) } });
    mockRefresh.mockResolvedValue(fresh("b"));
    expect(await getOrgHospitableToken(b)).toBe("access-b");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
