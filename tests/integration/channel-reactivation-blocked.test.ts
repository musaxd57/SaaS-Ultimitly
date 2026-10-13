import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertCanonicalReservation } from "@/lib/ingest/write-service";
import { normalizeReservation } from "@/lib/channels/hospitable-ingest";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import type { HospitableReservation } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// G9 (kurucu kararı 10-13 "Kanal açmasın, iCal aynı"; değişmez 7 / 17): kanal sağlayıcısı İPTAL edilmiş rezervasyonu eski bir anlık
// görüntüyle ("accepted") kendiliğinden geri AÇMAZ. Önce: durum koşulsuz yazılıyordu → satır yeniden "confirmed", karşılama / giriş
// göndericileri (status:"confirmed" seçer) ve görev üretimi yeniden devreye girebiliyordu. Sonra: satır iptal kalır + panelde
// "kanal bu rezervasyonu yeniden etkin gösteriyor — kontrol edin" satırı. iCal aboneliği bu yoldan geçmez (kuralı değişmedi).
// ---------------------------------------------------------------------------

const EXT = "prov-res-revive-1";
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

function reservation(status: string, guestName = "Ayşe Yılmaz", arrival = 10, departure = 13): HospitableReservation {
  return {
    id: EXT,
    code: "HM4K2",
    platform: "airbnb",
    status,
    arrival_date: isoDay(arrival),
    departure_date: isoDay(departure),
    guest: { full_name: guestName },
  } as HospitableReservation;
}

async function upsert(propertyId: string, r: HospitableReservation) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  const ctx = { organizationId: p.organizationId, provider: "hospitable" as const, connectionId: null };
  return prisma.$transaction(async (tx) => upsertCanonicalReservation(tx, propertyId, normalizeReservation(r), ctx));
}

const row = (propertyId: string) =>
  prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: EXT }, select: { id: true, status: true, guestName: true } });

const blockedEvents = (entityId: string) =>
  prisma.ingestEvent.count({ where: { entityId, kind: "reservation.updated", changedFieldsJson: { contains: REACTIVATION_BLOCKED_FIELD } } });

describe("G9 — kanal iptalli rezervasyonu geri açmaz", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 iptal → sonraki geçişte 'accepted' → satır İPTAL kalır, olay bir kez düşer", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("accepted"));
    await upsert(propertyId, reservation("cancelled"));
    expect((await row(propertyId)).status).toBe("cancelled");

    await upsert(propertyId, reservation("accepted"));
    const r = await row(propertyId);
    expect(r.status).toBe("cancelled");
    expect(await blockedEvents(r.id)).toBe(1);
  });

  it("2 dakikalık senkron her geçişte olay YAZMAZ (günde en çok bir)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("cancelled"));
    for (let i = 0; i < 5; i++) await upsert(propertyId, reservation("accepted"));
    expect(await blockedEvents((await row(propertyId)).id)).toBe(1);
  });

  it("öteki alanlar yine eşitlenir (yalnız durum tutulur)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("cancelled", "Ayşe Yılmaz"));
    await upsert(propertyId, reservation("accepted", "Ayşe Demir"));
    expect(await row(propertyId)).toMatchObject({ status: "cancelled", guestName: "Ayşe Demir" });
  });

  it("KONTROL: onaylı → iptal geçişi AYNEN çalışır (iptal olayı yazılır)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("accepted"));
    await upsert(propertyId, reservation("cancelled"));
    const r = await row(propertyId);
    expect(r.status).toBe("cancelled");
    expect(await prisma.ingestEvent.count({ where: { entityId: r.id, kind: "reservation.cancelled" } })).toBe(1);
    expect(await blockedEvents(r.id)).toBe(0);
  });

  it("KONTROL: iptal olmayan satırda durum değişimi AYNEN (talep → onaylı)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("request"));
    expect((await row(propertyId)).status).toBe("pending");
    await upsert(propertyId, reservation("accepted"));
    expect((await row(propertyId)).status).toBe("confirmed");
  });
});

describe("G9 — panel dikkat satırı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 kanal yeniden etkin gösterince tek 'channel_reactivation' satırı; konuşmaya bağlanır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("cancelled"));
    const r = await row(propertyId);
    const conv = await prisma.conversation.create({
      data: { propertyId, reservationId: r.id, externalReservationId: EXT, channel: "airbnb", guestIdentifier: "Ayşe Yılmaz" },
    });
    await upsert(propertyId, reservation("accepted"));
    await upsert(propertyId, reservation("accepted"));

    const items = (await findAttentionItems(orgId)).filter((i) => i.kind === "channel_reactivation");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ propertyId, certainty: "observed", href: `/inbox/${conv.id}` });
  });

  it("KONTROL: konaklaması bitmiş rezervasyon satır üretmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation("cancelled", "Ayşe Yılmaz", -10, -7));
    await upsert(propertyId, reservation("accepted", "Ayşe Yılmaz", -10, -7));
    expect((await findAttentionItems(orgId)).some((i) => i.kind === "channel_reactivation")).toBe(false);
  });

  it("KONTROL: olay yoksa (sakin gün) satır yok; başka işletmenin olayı görünmez", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await upsert(b.propertyId, reservation("cancelled"));
    await upsert(b.propertyId, reservation("accepted"));
    expect((await findAttentionItems(a.orgId)).some((i) => i.kind === "channel_reactivation")).toBe(false);
    expect((await findAttentionItems(b.orgId)).filter((i) => i.kind === "channel_reactivation")).toHaveLength(1);
  });
});
