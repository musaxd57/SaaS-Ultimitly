import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { encryptSecret } from "@/lib/crypto";
import { getOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { backfillChannelConnections, getConnection } from "@/lib/channels/connections";
import { __setOutboundAdapterForTest } from "@/lib/channels";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// GEÇİŞ KANITI (V0.3, migration 49) — çalışan Hospitable bağlantıları ve bekleyen
// mesajlar korunur.
//
// "Migration öncesi" durum DOĞRUDAN org kolonlarına yazılarak kurulur (49'dan
// önce üretimde olan şekil): bağlantı satırı YOK, kuyruk satırında connectionId
// YOK. Backfill idempotent olarak satırları oluşturur; kimlik bilgisi okuma iki
// modda da (anahtar kapalı/açık) aynı token'ı verir; eski kuyruk satırı worker'dan
// aynen teslim olur. Sağlayıcı sahte (fake); kimlik bilgisi deposu GERÇEK.
// ---------------------------------------------------------------------------
const fake = new FakeOutboundProvider();

async function legacyOrg(name: string, opts: { pat?: string; oauth?: { access: string; refresh: string }; label?: string }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      name,
      hospitableTokenEnc: opts.pat ? encryptSecret(opts.pat) : opts.oauth ? encryptSecret(opts.oauth.access) : null,
      hospitableRefreshTokenEnc: opts.oauth ? encryptSecret(opts.oauth.refresh) : null,
      hospitableTokenExpiresAt: opts.oauth ? new Date(Date.now() + 3600_000) : null,
      hospitableLabel: opts.label ?? null,
      hospitableConnectedAt: new Date("2026-06-01T00:00:00Z"),
    },
  });
  return { orgId, propertyId };
}

describe("migration 49 — backfill ve geriye uyum", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.unstubAllEnvs();
    fake.reset();
    __setOutboundAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("🚨 backfill: kolonlardaki her canlı bağlantı için satır oluşur — ciphertext AYNEN, idempotent", async () => {
    const pat = await legacyOrg("PAT org", { pat: "PAT-legacy", label: "8 mülk" });
    const oauth = await legacyOrg("OAuth org", { oauth: { access: "acc-legacy", refresh: "ref-legacy" }, label: "2 mülk" });
    const off = await legacyOrg("Bağlı değil", {});

    const r1 = await backfillChannelConnections();
    expect(r1.created).toBe(2);

    const cPat = await getConnection(pat.orgId);
    const orgPat = await prisma.organization.findUniqueOrThrow({ where: { id: pat.orgId } });
    expect(cPat).toMatchObject({ status: "active", generation: 1, label: "8 mülk", refreshTokenEnc: null });
    expect(cPat!.accessTokenEnc).toBe(orgPat.hospitableTokenEnc); // yeniden şifreleme YOK
    const cOa = await getConnection(oauth.orgId);
    const orgOa = await prisma.organization.findUniqueOrThrow({ where: { id: oauth.orgId } });
    expect(cOa!.refreshTokenEnc).toBe(orgOa.hospitableRefreshTokenEnc);
    expect(cOa!.tokenExpiresAt?.getTime()).toBe(orgOa.hospitableTokenExpiresAt!.getTime());
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: cPat!.id } })).connectedAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(await getConnection(off.orgId)).toBeNull();

    const before = await prisma.channelConnection.findMany({ orderBy: { id: "asc" } });
    const r2 = await backfillChannelConnections();
    expect(r2.created).toBe(0);
    const after = await prisma.channelConnection.findMany({ orderBy: { id: "asc" } });
    expect(after).toEqual(before); // ikinci koşu hiçbir satırı yazmadı
  });

  it("🚨 kimlik bilgisi paritesi: okuma anahtarı kapalı/açık AYNI token (PAT ve OAuth)", async () => {
    const pat = await legacyOrg("PAT org", { pat: "PAT-legacy" });
    const oauth = await legacyOrg("OAuth org", { oauth: { access: "acc-legacy", refresh: "ref-legacy" } });
    await backfillChannelConnections();
    expect(await getOrgHospitableToken(pat.orgId)).toBe("PAT-legacy");
    expect(await getOrgHospitableToken(oauth.orgId)).toBe("acc-legacy");
    vi.stubEnv("CHANNEL_CONNECTION_READ", "1");
    expect(await getOrgHospitableToken(pat.orgId)).toBe("PAT-legacy");
    expect(await getOrgHospitableToken(oauth.orgId)).toBe("acc-legacy");
  });

  it("🚨 bekleyen ESKİ kuyruk satırı (connectionId NULL) migration sonrası aynen teslim olur", async () => {
    const { orgId, propertyId } = await legacyOrg("PAT org", { pat: "PAT-legacy" });
    const conv = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: "res-legacy" },
    });
    fake.registerReservation("res-legacy", "PAT-legacy");
    // Migration ÖNCESİ kuyruklanmış satır: connectionId yok.
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId: conv.id, channel: "airbnb", externalReservationId: "res-legacy",
      reservationId: null, body: "Eski satır", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "legacy-1",
    });
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { connectionId: null } });

    await backfillChannelConnections();
    await drainOutboxOnce({}); // gerçek tokenFor → gerçek kimlik bilgisi deposu

    expect(fake.deliveries).toHaveLength(1);
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).toMatchObject({ status: "sent", connectionId: null });
  });

  it("backfill EŞZAMANLI/yarışan bağlanma ile çakışmaz: satır zaten varsa dokunmaz", async () => {
    const { orgId } = await legacyOrg("PAT org", { pat: "PAT-legacy", label: "eski" });
    await prisma.channelConnection.create({
      data: { organizationId: orgId, provider: "hospitable", status: "active", label: "yeni", accessTokenEnc: encryptSecret("PAT-new"), generation: 4 },
    });
    expect((await backfillChannelConnections()).created).toBe(0);
    expect(await getConnection(orgId)).toMatchObject({ label: "yeni", generation: 4 });
  });
});
