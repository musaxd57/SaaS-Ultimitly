import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { decryptSecret } from "@/lib/crypto";
import {
  getOrgHospitableToken,
  setOrgHospitableToken,
  setOrgHospitableOAuthTokens,
  clearOrgHospitableToken,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";
import { getConnection } from "@/lib/channels/connections";

// ---------------------------------------------------------------------------
// CHANNEL CONNECTION YAŞAM DÖNGÜSÜ (V0.3) — dual-write + generation CAS
//
// Her kimlik-bilgisi yazımı (bağlan / kaldır / yeniden bağlan / refresh / revoke)
// HEM org kolonlarına HEM `ChannelConnection` satırına tek TX'te yazar; satır
// (org, provider) başına TEKTİR ve yeniden bağlanmada AYNI id ile aktifleşir
// (kuyruk damgaları kopmaz). `generation` her yazımda artar ve OAuth refresh
// yarışının CAS çapasıdır: gecikmiş refresh ne org blob'unu ne bağlantıyı diriltir.
// Sağlayıcı sahte (`refreshAccessToken` mock); DB gerçek.
// ---------------------------------------------------------------------------
vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return { ...actual, getHospitableOAuthConfig: vi.fn(), refreshAccessToken: vi.fn() };
});
import { getHospitableOAuthConfig, refreshAccessToken, HospitableOAuthError } from "@/lib/hospitable-oauth";
const mockGetConfig = vi.mocked(getHospitableOAuthConfig);
const mockRefresh = vi.mocked(refreshAccessToken);
const FAKE_CONFIG = {
  clientId: "c", clientSecret: "s", authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token", redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
};
const future = () => new Date(Date.now() + 12 * 3600 * 1000);
const expired = () => new Date(Date.now() - 1000);

describe("ChannelConnection — dual-write ve yaşam döngüsü", () => {
  let orgId = "";
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockGetConfig.mockReturnValue(FAKE_CONFIG);
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 bağlan → kaldır → yeniden bağlan: AYNI satır, status/generation ilerler, org kolonları paralel", async () => {
    await setOrgHospitableToken(orgId, "PAT-1", "3 mülk");
    const c1 = await getConnection(orgId);
    expect(c1).not.toBeNull(); // ⬅️ ARIZADA: null (dual-write yok)
    expect(c1).toMatchObject({ status: "active", generation: 1, label: "3 mülk", refreshTokenEnc: null, tokenExpiresAt: null });
    expect(decryptSecret(c1!.accessTokenEnc!)).toBe("PAT-1");
    // Org kolonları da yazıldı (geriye uyum): aynı ciphertext.
    const org1 = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org1.hospitableTokenEnc).toBe(c1!.accessTokenEnc);

    await clearOrgHospitableToken(orgId);
    const c2 = await getConnection(orgId);
    expect(c2).toMatchObject({ id: c1!.id, status: "disconnected", generation: 2, accessTokenEnc: null, refreshTokenEnc: null });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).hospitableTokenEnc).toBeNull();
    expect(await getOrgHospitableToken(orgId)).toBeNull();

    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-1", refreshToken: "ref-1", expiresAt: future() }, "5 mülk");
    const c3 = await getConnection(orgId);
    expect(c3).toMatchObject({ id: c1!.id, status: "active", generation: 3, label: "5 mülk" });
    expect(decryptSecret(c3!.refreshTokenEnc!)).toBe("ref-1");
    expect(await getOrgHospitableToken(orgId)).toBe("acc-1");
  });

  it("refresh: bağlantı token'ları döner, generation artar, org blob'u ile AYNI ciphertext", async () => {
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-old", refreshToken: "ref-old", expiresAt: expired() }, "5 mülk");
    mockRefresh.mockResolvedValue({ accessToken: "acc-new", refreshToken: "ref-new", expiresAt: future() });
    expect(await getOrgHospitableToken(orgId)).toBe("acc-new");
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "active", generation: 2 });
    expect(decryptSecret(c!.accessTokenEnc!)).toBe("acc-new");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.hospitableTokenEnc).toBe(c!.accessTokenEnc); // tek şifreleme, iki yazma
    expect(org.hospitableRefreshTokenEnc).toBe(c!.refreshTokenEnc);
  });

  it("🚨 refresh ↔ disconnect yarışı: gecikmiş refresh bağlantıyı DİRİLTMEZ (generation CAS)", async () => {
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-old", refreshToken: "ref-old", expiresAt: expired() }, "5 mülk");
    mockRefresh.mockImplementation(async () => {
      await clearOrgHospitableToken(orgId); // refresh sağlayıcıda beklerken host kaldırır
      return { accessToken: "acc-LATE", refreshToken: "ref-LATE", expiresAt: future() };
    });
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, generation: 2 }); // ⬅️ dirilseydi active/gen 3
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).hospitableTokenEnc).toBeNull();
  });

  it("🚨 refresh ↔ reconnect (yeni hesap) yarışı: eski hesabın gecikmiş token'ı yeni hesabı EZMEZ", async () => {
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-A", refreshToken: "ref-A", expiresAt: expired() }, "Hesap A");
    mockRefresh.mockImplementation(async () => {
      await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-B", refreshToken: "ref-B", expiresAt: future() }, "Hesap B");
      return { accessToken: "acc-A2", refreshToken: "ref-A2", expiresAt: future() };
    });
    expect(await getOrgHospitableToken(orgId)).toBeNull(); // gecikmiş A sonucu aktif sayılmaz
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "active", label: "Hesap B", generation: 2 });
    expect(decryptSecret(c!.accessTokenEnc!)).toBe("acc-B");
    mockRefresh.mockClear();
    expect(await getOrgHospitableToken(orgId)).toBe("acc-B");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("🚨 refresh invalid_grant → org temizlenir, bağlantı REVOKED (refresh_invalid_grant), audit satırı", async () => {
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-old", refreshToken: "ref-dead", expiresAt: expired() }, "5 mülk");
    mockRefresh.mockRejectedValue(new HospitableOAuthError("invalid_grant", true));
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, generation: 2 });
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: c!.id } })).revokedReason).toBe("refresh_invalid_grant");
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "channel.connection_revoked" } });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.metadataJson ?? "{}").reason).toBe("refresh_invalid_grant");
  });

  it("KONTROL: geçici refresh hatası bağlantıya DOKUNMAZ (aktif kalır, generation sabit)", async () => {
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-old", refreshToken: "ref-ok", expiresAt: expired() }, "5 mülk");
    mockRefresh.mockRejectedValueOnce(new HospitableOAuthError("network timeout", false));
    expect(await getOrgHospitableToken(orgId)).toBeNull();
    expect(await getConnection(orgId)).toMatchObject({ status: "active", generation: 1 });
  });

  it("kiracı sınırı: başka org'un bağlantısı okunmaz", async () => {
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const other = await prisma.organization.create({ data: { name: "Other" } });
    expect(await getConnection(other.id)).toBeNull();
    expect(await getOrgHospitableToken(other.id)).toBeNull();
  });

  describe("okuma anahtarı CHANNEL_CONNECTION_READ=1", () => {
    it("aynı token'ı döndürür (parite) ve bağlantı satırı otorite olur", async () => {
      await setOrgHospitableToken(orgId, "PAT-1", null);
      expect(await getOrgHospitableToken(orgId)).toBe("PAT-1"); // kapalı: org kolonları
      vi.stubEnv("CHANNEL_CONNECTION_READ", "1");
      expect(await getOrgHospitableToken(orgId)).toBe("PAT-1"); // açık: bağlantı satırı
      // Tutarsız durum (yalnız doğrudan DB müdahalesiyle mümkün): satır disconnected,
      // org kolonu dolu → açıkken bağlantı kazanır (null), kapalıyken org kolonu (token).
      await prisma.channelConnection.updateMany({ where: { organizationId: orgId }, data: { status: "disconnected", accessTokenEnc: null } });
      expect(await getOrgHospitableToken(orgId)).toBeNull();
      vi.stubEnv("CHANNEL_CONNECTION_READ", "");
      expect(await getOrgHospitableToken(orgId)).toBe("PAT-1");
    });
  });
});
