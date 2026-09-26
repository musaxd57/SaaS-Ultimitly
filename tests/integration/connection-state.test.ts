import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// V0.7 (kod hazırlığı) — BAĞLANTI DURUMU ve KİMLİK ÇÖZÜMÜ tek kaynak, ChannelConnection
// otorite (satır varsa), org kolonları yalnız backfill öncesi fallback, env fallback AÇIK
// bir durum. Kurallar:
//   · Durum SAKLI VERİDEN türetilir — sağlayıcıya çağrı YOK ("bağlantı var" ≠ "sağlayıcı
//     sağlıklı"; sağlık ayrı bir sinyaldir, burada iddia edilmez).
//   · Beş durum: connected (kendi kimlik bilgisi) · env_fallback (yalnız kurucu org, env
//     token) · disconnected (host kaldırdı; satır tarihçe olarak kalır) · revoked (sağlayıcı
//     reddetti; sebep kapalı küme) · never_connected.
//   · Kendi bağlantısı revoked olan KURUCU org'un env fallback erişimi KORUNUR (Lale): durum
//     "revoked" + envAvailable + credentialSource "env" — iki gerçek birlikte gösterilir.
//   · `resolveHospitableCredential(org, { forConnectionId })`: damgalı bir kuyruk satırı
//     YALNIZ damgalandığı bağlantıdan gider — bağlantı aktif değilse token YOK (env'e sessizce
//     düşmez); başka org'un bağlantısı → tenant_mismatch. Damgasız (env altında kuyruklanan)
//     satır env ile gider.
//   · Okuma anahtarı (CHANNEL_CONNECTION_READ=1) açıkken satır otorite: aynı durumlar, aynı
//     token; anahtar KAPALI kalır (prod'da açılmadı) — parite burada pinlenir.
//   · Revoke/disconnect GEÇMİŞ satırların provenance damgasını yeniden yazmaz (tahmin yok).
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  const boom = () => {
    throw new Error("PROVIDER CALLED — durum saklı veriden türetilmeli");
  };
  return { ...actual, listProperties: boom, listReservations: boom, listMessages: boom, verifyToken: boom, sendMessage: boom };
});
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { getConnection } from "@/lib/channels/connections";
import {
  getConnectionInfo,
  resolveHospitableCredential,
  setOrgHospitableToken,
  clearOrgHospitableToken,
  handleProviderAuthFailure,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";

const ORIGINAL_ENV = {
  PRIMARY_ORG_ID: process.env.PRIMARY_ORG_ID,
  HOSPITABLE_API_TOKEN: process.env.HOSPITABLE_API_TOKEN,
  CHANNEL_CONNECTION_READ: process.env.CHANNEL_CONNECTION_READ,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrimaryOrgCache();
}
function envFallback(orgId: string, token = "ENV-TOK") {
  process.env.PRIMARY_ORG_ID = orgId;
  process.env.HOSPITABLE_API_TOKEN = token;
  resetPrimaryOrgCache();
}
function noEnv() {
  delete process.env.HOSPITABLE_API_TOKEN;
  process.env.PRIMARY_ORG_ID = "org-that-does-not-exist";
  resetPrimaryOrgCache();
}

/** Aynı senaryoyu okuma anahtarı KAPALI ve AÇIK koşturur (parite). */
function bothReadModes(name: string, fn: () => Promise<void>) {
  for (const on of [false, true]) {
    it(`${name} [CHANNEL_CONNECTION_READ=${on ? "1" : "kapalı"}]`, async () => {
      if (on) process.env.CHANNEL_CONNECTION_READ = "1";
      else delete process.env.CHANNEL_CONNECTION_READ;
      await fn();
    });
  }
}

describe("V0.7 — bağlantı durumu (getConnectionInfo) saklı veriden", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    noEnv();
  });
  afterEach(restoreEnv);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  bothReadModes("never_connected: satır yok, kolon yok, env yok", async () => {
    const { orgId } = await makeOrgWithProperty();
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "never_connected", connected: false, ownToken: false, envAvailable: false, credentialSource: null, connectionId: null, revokedReason: null });
  });

  bothReadModes("connected: kendi PAT'i → state connected, kaynak db, satır id'si, etiket", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", "8 mülk");
    const row = await getConnection(orgId);
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "connected", connected: true, ownToken: true, envAvailable: false, credentialSource: "db", connectionId: row!.id, label: "8 mülk" });
    expect(info.connectedAt).toBeInstanceOf(Date);
  });

  bothReadModes("disconnected: host kaldırdı → state disconnected, bağlı değil, satır tarihçe olarak kalır", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    await clearOrgHospitableToken(orgId);
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "disconnected", connected: false, ownToken: false, credentialSource: null, connectionId: row!.id });
    expect(info.disconnectedAt).toBeInstanceOf(Date);
  });

  bothReadModes("revoked: sağlayıcı PAT'i reddetti (401) → state revoked + sebep send_401, bağlı değil; geçmiş provenance damgası DEĞİŞMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    const stamped = await prisma.reservation.create({
      data: { propertyId, guestName: "G", arrivalDate: daysFromNow(3), departureDate: daysFromNow(5), channel: "airbnb", sourceReference: "r-1", connectionId: row!.id, connectionEvidence: "ingest", ingestedAt: new Date() },
    });
    expect(await handleProviderAuthFailure(orgId, 401)).toBe("revoked");
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "revoked", revokedReason: "send_401", connected: false, ownToken: false, credentialSource: null, connectionId: row!.id });
    expect(info.revokedAt).toBeInstanceOf(Date);
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: stamped.id } });
    expect(after.connectionId).toBe(row!.id); // tarihçe yeniden yazılmaz
    expect(after.connectionEvidence).toBe("ingest");
  });

  bothReadModes("env_fallback: kurucu org, satır yok → state env_fallback, bağlı, kaynak env, satır id'si yok", async () => {
    const { orgId } = await makeOrgWithProperty();
    envFallback(orgId);
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "env_fallback", connected: true, ownToken: false, envAvailable: true, credentialSource: "env", connectionId: null });
  });

  bothReadModes("🚨 revoked + env (kurucu): iki gerçek birlikte — state revoked, ama erişim env ile KORUNUR (Lale)", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    await handleProviderAuthFailure(orgId, 401);
    envFallback(orgId);
    const info = await getConnectionInfo(orgId);
    expect(info).toMatchObject({ state: "revoked", revokedReason: "send_401", connected: true, ownToken: false, envAvailable: true, credentialSource: "env", connectionId: row!.id });
    const cred = await resolveHospitableCredential(orgId);
    expect(cred).toMatchObject({ token: "ENV-TOK", source: "env", connectionId: null, reason: null });
  });

  bothReadModes("kiracı sınırı: A revoked, B bağlı → B'nin durumu ve token'ı A'dan etkilenmez", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await setOrgHospitableToken(a.orgId, "PAT-A", null);
    await setOrgHospitableToken(b.orgId, "PAT-B", null);
    await handleProviderAuthFailure(a.orgId, 403);
    expect((await getConnectionInfo(a.orgId)).state).toBe("revoked");
    const infoB = await getConnectionInfo(b.orgId);
    expect(infoB.state).toBe("connected");
    expect(infoB.connectionId).toBe((await getConnection(b.orgId))!.id);
    expect((await resolveHospitableCredential(b.orgId)).token).toBe("PAT-B");
    expect((await resolveHospitableCredential(a.orgId)).token).toBeNull();
  });
});

describe("V0.7 — resolveHospitableCredential: damgalı satır yalnız kendi bağlantısından gider", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    noEnv();
  });
  afterEach(restoreEnv);

  bothReadModes("db kimliği: token + kaynak + satır id'si; forConnectionId aynı satır → aynı sonuç", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    const cred = await resolveHospitableCredential(orgId);
    expect(cred).toMatchObject({ token: "PAT-1", connectionId: row!.id, reason: null });
    expect(["connection", "org_columns"]).toContain(cred.source);
    expect(await resolveHospitableCredential(orgId, { forConnectionId: row!.id })).toMatchObject({ token: "PAT-1", connectionId: row!.id });
  });

  bothReadModes("🚨 damgalı satır + bağlantı revoked + env mevcut (kurucu) → token YOK, reason connection_inactive (env'e sessizce DÜŞMEZ)", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    await handleProviderAuthFailure(orgId, 401);
    envFallback(orgId);
    expect(await resolveHospitableCredential(orgId, { forConnectionId: row!.id })).toMatchObject({ token: null, reason: "connection_inactive", connectionId: row!.id });
    // Damgasız satır (env altında kuyruklanmış) env ile gider.
    expect(await resolveHospitableCredential(orgId, { forConnectionId: null })).toMatchObject({ token: "ENV-TOK", source: "env" });
    // Yeniden bağlanınca aynı satır aktif → damgalı satır yine gider.
    await setOrgHospitableToken(orgId, "PAT-2", null);
    expect(await resolveHospitableCredential(orgId, { forConnectionId: row!.id })).toMatchObject({ token: "PAT-2", connectionId: row!.id });
  });

  bothReadModes("damgalı satır + bağlantı disconnected → connection_inactive (yeniden bağlanana kadar bekler)", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    const row = await getConnection(orgId);
    await clearOrgHospitableToken(orgId);
    expect(await resolveHospitableCredential(orgId, { forConnectionId: row!.id })).toMatchObject({ token: null, reason: "connection_inactive" });
  });

  bothReadModes("🚨 kiracı: forConnectionId BAŞKA org'un bağlantısı → token YOK, reason connection_tenant_mismatch", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await setOrgHospitableToken(a.orgId, "PAT-A", null);
    await setOrgHospitableToken(b.orgId, "PAT-B", null);
    const rowB = await getConnection(b.orgId);
    expect(await resolveHospitableCredential(a.orgId, { forConnectionId: rowB!.id })).toMatchObject({ token: null, reason: "connection_tenant_mismatch" });
  });

  bothReadModes("bilinmeyen forConnectionId (satır silinmiş) → token YOK, connection_inactive", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    expect(await resolveHospitableCredential(orgId, { forConnectionId: "conn-yok" })).toMatchObject({ token: null, reason: "connection_inactive" });
  });

  it("KONTROL: mevcut getOrgHospitableToken sarmalayıcısı aynı token'ı verir (parite)", async () => {
    const { getOrgHospitableToken } = await import("@/lib/hospitable-credentials");
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "PAT-1", null);
    expect(await getOrgHospitableToken(orgId)).toBe("PAT-1");
    envFallback(orgId, "ENV-2");
    await clearOrgHospitableToken(orgId);
    expect(await getOrgHospitableToken(orgId)).toBe("ENV-2");
  });
});
