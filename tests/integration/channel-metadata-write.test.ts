import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// KANAL METAVERİSİ YAZICILARI (migration 60 A–C) — gerçek senkron motoru, gerçek PostgreSQL; yalnız sağlayıcı istemcisi sahte.
// Anahtar `CHANNEL_METADATA_WRITE` kapalıyken HİÇBİR satır / kolon yazılmaz (bugünkü davranış); açıkken yalnız YAZAR, okuyan yok.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable")>()),
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { HospitableError, listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";
import { recordChannelListings, recordConnectionRead } from "@/lib/channels/metadata";
import { sourcePlatformOf } from "@/lib/channels/ingest";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);

const RES = (platform: unknown) => ({
  id: "res-1",
  code: "HMABC",
  platform,
  arrival_date: "2026-11-10",
  departure_date: "2026-11-12",
  guest: { full_name: "Alex Guest" },
});

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty(); // "Test Property"
  const conn = await prisma.channelConnection.create({ data: { organizationId: orgId, provider: "hospitable", status: "active" } });
  mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
  return { orgId, propertyId, connectionId: conn.id };
}

describe("kanal metaverisi — senkron üzerinden", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([RES("Airbnb Official")] as never);
    mockMessages.mockResolvedValue([]);
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("açık: ilan eşlemesi + ham platform + başarılı okuma yazılır; kanal etiketi ve yetenek alanları AYNEN", async () => {
    const { orgId, propertyId, connectionId } = await seed();
    await syncHospitable(orgId);
    expect(await prisma.channelListing.findMany({ select: { organizationId: true, connectionId: true, externalId: true, propertyId: true } })).toEqual([
      { organizationId: orgId, connectionId, externalId: "hosp-prop-1", propertyId },
    ]);
    const res = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } });
    expect(res.sourcePlatform).toBe("airbnb_official");
    expect(res.channel).toBe("airbnb"); // kanal etiketi eski kuraldan, değişmedi
    const conn = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.lastReadOkAt).not.toBeNull();
    expect(conn.lastReadErrorAt).toBeNull();
    // İkinci geçiş idempotent: tek ilan satırı, değişmeyen eşleme yeniden YAZILMAZ.
    const first = await prisma.channelListing.findFirstOrThrow();
    await syncHospitable(orgId);
    expect(await prisma.channelListing.count()).toBe(1);
    expect((await prisma.channelListing.findFirstOrThrow()).updatedAt).toEqual(first.updatedAt);
  });

  it("🚨 KAPALI (varsayılan): ilan satırı, platform, sağlık YAZILMAZ — bugünkü davranış", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "");
    const { orgId, connectionId } = await seed();
    const r = await syncHospitable(orgId);
    expect(r.properties).toBe(1);
    expect(await prisma.channelListing.count()).toBe(0);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).sourcePlatform).toBeNull();
    const conn = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect([conn.lastReadOkAt, conn.lastReadErrorAt, conn.lastReadErrorKind]).toEqual([null, null, null]);
  });

  it("🚨 platform değişimi OLAY DEĞİLDİR: yalnız platform değişince reservation.updated üretilmez", async () => {
    const { orgId } = await seed();
    await syncHospitable(orgId);
    const before = await prisma.ingestEvent.count({ where: { kind: "reservation.updated" } });
    mockReservations.mockResolvedValue([RES("airbnb_v2")] as never);
    await syncHospitable(orgId);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).sourcePlatform).toBe("airbnb_v2");
    expect(await prisma.ingestEvent.count({ where: { kind: "reservation.updated" } })).toBe(before);
  });

  it("ilan listesi okunamadı (401) → okuma hatası türü kaydedilir, senkron hatası aynen yükselir", async () => {
    const { orgId, connectionId } = await seed();
    mockProperties.mockRejectedValue(new HospitableError("unauthorized", 401));
    await expect(syncHospitable(orgId)).rejects.toThrow();
    const conn = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.lastReadErrorKind).toBe("auth_revoked");
    expect(conn.lastReadErrorAt).not.toBeNull();
    expect(conn.lastReadOkAt).toBeNull();
  });

  it("ilanın rezervasyonları okunamadı (500) → geçiş hata olarak kaydedilir (başarı YAZILMAZ)", async () => {
    const { orgId, connectionId } = await seed();
    mockReservations.mockRejectedValue(new HospitableError("boom", 503));
    await syncHospitable(orgId);
    const conn = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.lastReadErrorKind).toBe("outage");
    expect(conn.lastReadOkAt).toBeNull();
  });

  it("bağlantı satırı yoksa (env fallback) hiçbir metaveri yazılmaz — çıkarım yok", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    await syncHospitable(orgId);
    expect(await prisma.channelListing.count()).toBe(0);
  });
});

describe("ilan OKUMA geçişi (CHANNEL_LISTING_READ, varsayılan kapalı)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([RES("Airbnb Official")] as never);
    mockMessages.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  /** Senkronun bugünkü yolu "Test Property"yi ADIYLA benimserdi; ilan satırı BAŞKA mülkü gösteriyor. */
  async function seedWithListing() {
    const s = await seed();
    const other = await prisma.property.create({ data: { organizationId: s.orgId, name: "Başka Daire" } });
    await prisma.channelListing.create({
      data: { organizationId: s.orgId, connectionId: s.connectionId, externalId: "hosp-prop-1", propertyId: other.id },
    });
    return { ...s, otherId: other.id };
  }

  it("🚨 KAPALI (varsayılan): ilan satırı OKUNMAZ — bugünkü yol (ad ile benimseme, `hospitableId`)", async () => {
    const { orgId, propertyId, otherId } = await seedWithListing();
    await syncHospitable(orgId);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).propertyId).toBe(propertyId);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).hospitableId).toBe("hosp-prop-1");
    expect(await prisma.reservation.count({ where: { propertyId: otherId } })).toBe(0);
  });

  it("🚨 AÇIK: bağlantı + ilan kimliği → satırdaki mülk (ad eşleşmesine ve eski kolona bakılmaz)", async () => {
    vi.stubEnv("CHANNEL_LISTING_READ", "1");
    const { orgId, propertyId, otherId } = await seedWithListing();
    await syncHospitable(orgId);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).propertyId).toBe(otherId);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).hospitableId).toBeNull();
  });

  it("AÇIK ama satır YOK → bugünkü yola DÜŞER (geçişte ilan kaybolmaz)", async () => {
    vi.stubEnv("CHANNEL_LISTING_READ", "1");
    const { orgId, propertyId } = await seed();
    await syncHospitable(orgId);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).propertyId).toBe(propertyId);
  });

  it("🚨 AÇIK: başka org'un mülkünü gösteren (bozuk) satır YOK SAYILIR → bugünkü yol; başka org'a hiçbir şey yazılmaz", async () => {
    vi.stubEnv("CHANNEL_LISTING_READ", "1");
    const s = await seed();
    const foreign = await makeOrgWithProperty();
    await prisma.channelListing.create({
      data: { organizationId: s.orgId, connectionId: s.connectionId, externalId: "hosp-prop-1", propertyId: foreign.propertyId },
    });
    await syncHospitable(s.orgId);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).propertyId).toBe(s.propertyId);
    expect(await prisma.reservation.count({ where: { propertyId: foreign.propertyId } })).toBe(0);
  });
});

describe("kanal metaverisi — kiracı denetimi (doğrudan)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 başka org'un bağlantı kimliği ya da başka org'un mülkü → ilan satırı YAZILMAZ; sağlık güncellenmez", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const connB = await prisma.channelConnection.create({ data: { organizationId: b.orgId, provider: "hospitable", status: "active" } });
    const connA = await prisma.channelConnection.create({ data: { organizationId: a.orgId, provider: "hospitable", status: "active" } });
    await recordChannelListings(a.orgId, connB.id, [{ externalId: "x", propertyId: a.propertyId }]);
    await recordChannelListings(a.orgId, connA.id, [{ externalId: "y", propertyId: b.propertyId }]);
    expect(await prisma.channelListing.count()).toBe(0);
    await recordConnectionRead(a.orgId, connB.id, { ok: true });
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: connB.id } })).lastReadOkAt).toBeNull();
    // KONTROL: doğru eşleşme yazılır.
    await recordChannelListings(a.orgId, connA.id, [{ externalId: "z", propertyId: a.propertyId }]);
    expect(await prisma.channelListing.count()).toBe(1);
  });

  it("ilan başka mülke bağlanırsa satır güncellenir (tek satır)", async () => {
    const a = await makeOrgWithProperty();
    const p2 = await prisma.property.create({ data: { organizationId: a.orgId, name: "İkinci" } });
    const conn = await prisma.channelConnection.create({ data: { organizationId: a.orgId, provider: "hospitable", status: "active" } });
    await recordChannelListings(a.orgId, conn.id, [{ externalId: "x", propertyId: a.propertyId }]);
    await recordChannelListings(a.orgId, conn.id, [{ externalId: "x", propertyId: p2.id }]);
    expect(await prisma.channelListing.findMany({ select: { propertyId: true } })).toEqual([{ propertyId: p2.id }]);
  });
});

describe("sourcePlatformOf (saf)", () => {
  it.each([
    ["Airbnb", "airbnb"],
    ["  Booking.com ", "booking.com"],
    ["Airbnb Official", "airbnb_official"],
    ["", null],
    [null, null],
    [42, null],
    ["<script>", null],
    ["x".repeat(41), null],
    ["Ayşe", null],
  ])("%j → %j", (raw, want) => {
    expect(sourcePlatformOf(raw)).toBe(want);
  });
});
