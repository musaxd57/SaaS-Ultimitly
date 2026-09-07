import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { __setOutboundAdapterForTest } from "@/lib/channels";
import { getConnection } from "@/lib/channels/connections";
import { enqueueOutbound, enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import {
  setOrgHospitableToken,
  setOrgHospitableOAuthTokens,
  clearOrgHospitableToken,
  handleProviderAuthFailure,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// KUYRUK × BAĞLANTI YAŞAM DÖNGÜSÜ (V0.3) — kimlik bilgisi deposu GERÇEK, sağlayıcı fake.
//
//   · enqueue satıra aktif bağlantının id'sini damgalar (provenance);
//   · kaldır → satır bekler (0 deneme) → yeniden bağlan (AYNI bağlantı id) → teslim;
//   · gönderimde 401/403 = `auth_revoked`: deneme TÜKETİLMEZ, satır bekler;
//       PAT → bağlantı revoked + org temizlenir + audit (host yeniden bağlanır),
//       OAuth → refresh ZORLANIR (bağlantı aktif kalır), refresh sonrası teslim;
//   · başka org'un bağlantı id'sini taşıyan satır ASLA gönderilmez (cancel).
// ---------------------------------------------------------------------------
vi.mock("@/lib/hospitable-oauth", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-oauth")>();
  return { ...actual, getHospitableOAuthConfig: vi.fn(), refreshAccessToken: vi.fn() };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));
import { getHospitableOAuthConfig, refreshAccessToken } from "@/lib/hospitable-oauth";
const mockGetConfig = vi.mocked(getHospitableOAuthConfig);
const mockRefresh = vi.mocked(refreshAccessToken);

const fake = new FakeOutboundProvider();
const RES = "res-conn-1";
const row = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(Date.now() + 86_400_000), status: "confirmed", sourceReference: RES, channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ayşe", status: "waiting", externalReservationId: RES },
  });
  return { orgId, propertyId, reservationId: reservation.id, conversationId: conversation.id };
}
const enqueue = (orgId: string, conversationId: string, key: string) =>
  enqueueOutbound({
    organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: RES, reservationId: null,
    body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: key,
  });

describe("outbox × ChannelConnection", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    fake.reset();
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    mockGetConfig.mockReturnValue({
      clientId: "c", clientSecret: "s", authorizeUrl: "https://auth.example.com/authorize",
      tokenUrl: "https://auth.example.com/token", redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
    });
  });
  afterEach(() => __setOutboundAdapterForTest("hospitable", null));

  it("🚨 enqueue satıra AKTİF bağlantının id'sini damgalar (reply + lifecycle)", async () => {
    const { orgId, conversationId, reservationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-A", "3 mülk");
    const c = await getConnection(orgId);
    const r = await enqueue(orgId, conversationId, "k1");
    const p = await enqueueProactive({ organizationId: orgId, externalReservationId: RES, reservationId, channel: "airbnb", messageType: "welcome", body: "Hoş geldiniz", idempotencyKey: "w1" });
    expect((await row(r.outboxId)).connectionId).toBe(c!.id); // ⬅️ ARIZADA: null
    expect((await row(p.outboxId)).connectionId).toBe(c!.id);
  });

  it("bağlantısız org'da enqueue connectionId NULL bırakır (hata değil)", async () => {
    const { orgId, conversationId } = await seed();
    const r = await enqueue(orgId, conversationId, "k0");
    expect((await row(r.outboxId)).connectionId).toBeNull();
  });

  it("🚨 kaldır → satır bekler (0 deneme) → yeniden bağlan (AYNI bağlantı) → TEK teslim", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-A", null);
    fake.registerReservation(RES, "PAT-A");
    const cBefore = await getConnection(orgId);
    const { outboxId } = await enqueue(orgId, conversationId, "k-disc");
    await clearOrgHospitableToken(orgId);
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ now });
    expect(fake.attempts).toHaveLength(0);
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "disconnected", attemptCount: 0 });

    await setOrgHospitableToken(orgId, "PAT-A2", null); // yeniden bağlandı (yeni PAT)
    fake.registerReservation(RES, "PAT-A2");
    expect((await getConnection(orgId))!.id).toBe(cBefore!.id); // aynı satır
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent", connectionId: cBefore!.id });
  });

  it("🚨 PAT gönderimde 401: deneme tüketilmez, satır bekler; bağlantı REVOKED + org temizlenir + audit; yeniden bağlanınca TEK teslim", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-dead", null);
    fake.registerReservation(RES, "PAT-dead");
    fake.behave({ mode: "reject", status: 401 });
    const { outboxId } = await enqueue(orgId, conversationId, "k-401");
    let clock = Date.now();
    const now = () => new Date(clock);

    await drainOutboxOnce({ now });

    const r1 = await row(outboxId);
    expect(r1).toMatchObject({ status: "pending", lastErrorKind: "auth_revoked", attemptCount: 0 }); // ⬅️ ARIZADA: definitive_failure, attemptCount 1
    expect(fake.attempts).toHaveLength(1);
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "revoked", accessTokenEnc: null });
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: c!.id } })).revokedReason).toBe("send_401");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).hospitableTokenEnc).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "channel.connection_revoked" } });
    expect(JSON.parse(audit?.metadataJson ?? "{}").reason).toBe("send_401");

    // Bağlantı yokken sağlayıcıya bir daha gidilmez.
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(fake.attempts).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "disconnected" });

    // Host yeniden bağlanır → satır teslim olur, tam bir kez.
    await setOrgHospitableToken(orgId, "PAT-new", null);
    fake.registerReservation(RES, "PAT-new");
    fake.behave({ mode: "succeed" });
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(await getConnection(orgId)).toMatchObject({ status: "active" });
  });

  it("403 de aynı sınıf: auth_revoked + send_403", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-x", null);
    fake.registerReservation(RES, "PAT-x");
    fake.behave({ mode: "reject", status: 403 });
    const { outboxId } = await enqueue(orgId, conversationId, "k-403");
    await drainOutboxOnce({});
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "auth_revoked", attemptCount: 0 });
    expect((await prisma.channelConnection.findFirstOrThrow({ where: { organizationId: orgId } })).revokedReason).toBe("send_403");
  });

  it("🚨 OAuth gönderimde 401: bağlantı REVOKED OLMAZ — refresh zorlanır, refresh sonrası teslim", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableOAuthTokens(orgId, { accessToken: "acc-stale", refreshToken: "ref-1", expiresAt: new Date(Date.now() + 3600_000) }, "5 mülk");
    fake.registerReservation(RES, "acc-stale");
    fake.behave({ mode: "reject", status: 401 });
    const { outboxId } = await enqueue(orgId, conversationId, "k-oauth");
    let clock = Date.now();
    const now = () => new Date(clock);

    await drainOutboxOnce({ now });

    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "auth_revoked", attemptCount: 0 });
    const c = await getConnection(orgId);
    expect(c).toMatchObject({ status: "active" }); // ⬅️ aşırı-uygulama olsaydı revoked
    expect(c!.tokenExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now()); // süre şimdiye çekildi → refresh
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).hospitableTokenExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());

    mockRefresh.mockResolvedValue({ accessToken: "acc-fresh", refreshToken: "ref-2", expiresAt: new Date(Date.now() + 12 * 3600_000) });
    fake.registerReservation(RES, "acc-fresh");
    fake.behave({ mode: "succeed" });
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(await getConnection(orgId)).toMatchObject({ status: "active", generation: 2 });
  });

  it("🚨 kiracı sınırı: satırın connectionId'si BAŞKA org'un bağlantısıysa gönderilmez (cancel)", async () => {
    const a = await seed();
    await setOrgHospitableToken(a.orgId, "PAT-A", null);
    fake.registerReservation(RES, "PAT-A");
    const b = await makeOrgWithProperty();
    await setOrgHospitableToken(b.orgId, "PAT-B", null);
    const cB = await getConnection(b.orgId);
    const { outboxId } = await enqueue(a.orgId, a.conversationId, "k-x");
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { connectionId: cB!.id } }); // bozuk/yanlış damga
    await drainOutboxOnce({});
    expect(fake.attempts).toHaveLength(0);
    expect(await row(outboxId)).toMatchObject({ status: "canceled", lastErrorCode: "connection_tenant_mismatch" });
  });

  it("🚨 V0.7: damgalı satır + kendi bağlantısı REVOKED + env fallback mevcut (kurucu) → satır BEKLER (connection_inactive), env ile GÖNDERİLMEZ; yeniden bağlanınca TEK teslim, yeni PAT ile", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-A", null);
    fake.registerReservation(RES, "PAT-A");
    const conn = await getConnection(orgId);
    const { outboxId } = await enqueue(orgId, conversationId, "k-rev-env");
    expect((await row(outboxId)).connectionId).toBe(conn!.id);
    expect(await handleProviderAuthFailure(orgId, 401)).toBe("revoked");
    // Kurucu org: env fallback devrede — ama bu satır bağlantı X altında kuyruklandı.
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    vi.stubEnv("HOSPITABLE_API_TOKEN", "ENV-TOK");
    resetPrimaryOrgCache();
    fake.registerReservation(RES, "ENV-TOK");
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ now });
    expect(fake.attempts).toHaveLength(0); // env ile sessizce gitmedi
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorCode: "connection_inactive", attemptCount: 0 });

    await setOrgHospitableToken(orgId, "PAT-A2", null); // yeniden bağlandı (aynı satır)
    fake.registerReservation(RES, "PAT-A2");
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.lastToken()).toBe("PAT-A2");
    expect(await row(outboxId)).toMatchObject({ status: "sent", connectionId: conn!.id });
  });

  it("V0.7: env fallback altında kuyruklanan satır (connectionId NULL) env token'ı ile teslim edilir (Nuve yolu korunur)", async () => {
    const { orgId, conversationId } = await seed();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    vi.stubEnv("HOSPITABLE_API_TOKEN", "ENV-TOK");
    resetPrimaryOrgCache();
    fake.registerReservation(RES, "ENV-TOK");
    const { outboxId } = await enqueue(orgId, conversationId, "k-env");
    expect((await row(outboxId)).connectionId).toBeNull();
    await drainOutboxOnce({ now: () => new Date() });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.lastToken()).toBe("ENV-TOK");
    expect(await row(outboxId)).toMatchObject({ status: "sent", connectionId: null });
  });

  it("KONTROL: sağlıklı bağlantıda normal teslim (aşırı-uygulama değil)", async () => {
    const { orgId, conversationId } = await seed();
    await setOrgHospitableToken(orgId, "PAT-A", null);
    fake.registerReservation(RES, "PAT-A");
    const { outboxId } = await enqueue(orgId, conversationId, "k-ok");
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(await getConnection(orgId)).toMatchObject({ status: "active", generation: 1 });
  });
});
