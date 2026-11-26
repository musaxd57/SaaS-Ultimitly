import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertCanonicalReservation } from "@/lib/ingest/write-service";
import { normalizeReservation } from "@/lib/channels/hospitable-ingest";
import { ANON_NAME } from "@/lib/data-retention";
import type { HospitableReservation } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// MİGRATION 57 — KANAL ALAN EŞLEMESİ (K10-o, kurucu kararı 09-28; Codex kapsamı: "iki boş olabilir sütun, mevcut adları
// değiştirme, tahminî doldurma yapma").
//
//   Hospitable `guest.first_name`  → `Reservation.guestGivenName` (YALNIZ bu alandan; tam ad BÖLÜNMEZ)
//   kanal gerçek ad gönderdi        → `Reservation.guestNameSource = "channel"`
//   kanal ad göndermedi (yer tutucu) → `guestNameSource = "placeholder"`, hitap adı yok
//
// Köken / hitap adı OLAY DEĞİLDİR: yalnız onlar değişince `reservation.updated` üretilmez, alan listesine de girmez.
// ---------------------------------------------------------------------------

const EXT = "prov-res-given-1";

function reservation(guest: HospitableReservation["guest"]): HospitableReservation {
  return { id: EXT, code: "HM4K2", platform: "airbnb", arrival_date: "2026-07-20", departure_date: "2026-07-23", guest };
}

async function upsert(propertyId: string, r: HospitableReservation) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  const ctx = { organizationId: p.organizationId, provider: "hospitable" as const, connectionId: null };
  return prisma.$transaction(async (tx) => upsertCanonicalReservation(tx, propertyId, normalizeReservation(r), ctx));
}

const row = (propertyId: string) =>
  prisma.reservation.findFirstOrThrow({
    where: { propertyId, sourceReference: EXT },
    select: { id: true, guestName: true, guestGivenName: true, guestNameSource: true },
  });

const updateEvents = (entityId: string) =>
  prisma.ingestEvent.findMany({ where: { entityId, kind: "reservation.updated" }, select: { changedFieldsJson: true } });

describe("kanal eşlemesi — Hospitable first_name → guestGivenName", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 ayrı ad alanı hitap adına yazılır; kaynak 'channel'", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz", first_name: "Ayşe", last_name: "Yılmaz" }));
    expect(await row(propertyId)).toMatchObject({ guestName: "Ayşe Yılmaz", guestGivenName: "Ayşe", guestNameSource: "channel" });
  });

  it("🚨 TAHMİN YOK: ayrı ad alanı yoksa tam ad BÖLÜNMEZ, hitap adı boş kalır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Mehmet Ali Kaya" }));
    expect(await row(propertyId)).toMatchObject({ guestName: "Mehmet Ali Kaya", guestGivenName: null, guestNameSource: "channel" });
  });

  it("🚨 kanal ad göndermedi → yer tutucu ad + kaynak 'placeholder' + hitap adı yok", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation(undefined));
    expect(await row(propertyId)).toMatchObject({ guestName: "Rezervasyon HM4K2", guestGivenName: null, guestNameSource: "placeholder" });
  });

  it("🚨 hitap adı sonradan gelince yazılır ama OLAY üretmez; boş gelince eskisi silinmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }));
    const { id } = await row(propertyId);
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz", first_name: "Ayşe" }));
    expect((await row(propertyId)).guestGivenName).toBe("Ayşe");
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }));
    expect((await row(propertyId)).guestGivenName).toBe("Ayşe");
    expect(await updateEvents(id)).toEqual([]);
  });

  it("🚨 ad değişince hitap adı yeni adınki (ya da boş) olur; olay alan listesinde yalnız 'guestName'", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz", first_name: "Ayşe" }));
    const { id } = await row(propertyId);
    await upsert(propertyId, reservation({ full_name: "Can Demir" }));
    expect(await row(propertyId)).toMatchObject({ guestName: "Can Demir", guestGivenName: null, guestNameSource: "channel" });
    const events = await updateEvents(id);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].changedFieldsJson ?? "[]")).toEqual(["guestName"]);
  });

  it("🚨 eski satır (kaynak NULL, ad aynı) gözlemle 'channel' damgalanır — olay yok", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }));
    const { id } = await row(propertyId);
    await prisma.reservation.update({ where: { id }, data: { guestNameSource: null } });
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }));
    expect((await row(propertyId)).guestNameSource).toBe("channel");
    expect(await updateEvents(id)).toEqual([]);
  });

  it("🚨 KVKK: saklama süresiyle anonimleşmiş satıra hitap adı GERİ YAZILMAZ", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }));
    const { id } = await row(propertyId);
    await prisma.reservation.update({ where: { id }, data: { guestName: ANON_NAME, guestNameSource: "channel" } });
    await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz", first_name: "Ayşe" }));
    expect(await row(propertyId)).toMatchObject({ guestName: ANON_NAME, guestGivenName: null });
  });

  it("hitap adı tavanı: 100 kod noktası, boşluk kırpılır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ full_name: "Uzun Ad", first_name: `  ${"A".repeat(150)}  ` }));
    expect((await row(propertyId)).guestGivenName).toBe("A".repeat(100));
  });
});

describe("Y6 (Codex 10-07) — ters / sıfır süreli tarih yazılmaz", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 çıkış girişten önce → satır YAZILMAZ (eskiden ters konaklama yazılıyordu)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const id = await upsert(propertyId, { ...reservation({ full_name: "Ayşe Yılmaz" }), arrival_date: "2026-07-23", departure_date: "2026-07-20" });
    expect(id).toBeNull();
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("🚨 var olan kaydı ters tarihli güncelleme EZMEZ; imkânsız gün (30 Şubat) da", async () => {
    const { propertyId } = await makeOrgWithProperty();
    expect(await upsert(propertyId, reservation({ full_name: "Ayşe Yılmaz" }))).not.toBeNull();
    expect(await upsert(propertyId, { ...reservation({ full_name: "Ayşe Yılmaz" }), departure_date: "2026-07-20" })).toBeNull();
    expect(await upsert(propertyId, { ...reservation({ full_name: "Ayşe Yılmaz" }), arrival_date: "2026-02-30" })).toBeNull();
    const r = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: EXT } });
    expect(r.arrivalDate.toISOString().slice(0, 10)).toBe("2026-07-20");
    expect(r.departureDate.toISOString().slice(0, 10)).toBe("2026-07-23");
  });
});
