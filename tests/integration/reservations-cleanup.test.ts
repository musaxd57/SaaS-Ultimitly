import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Mock the Hospitable client so the cleanup runs against fixed "current" data.
vi.mock("@/lib/hospitable", () => ({ listReservations: vi.fn() }));

// The org is "connected" — return a fixed token so cleanup runs (multi-tenant).
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { listReservations } from "@/lib/hospitable";
import { cleanupStaleReservations } from "@/lib/reservations-cleanup";

const mockList = vi.mocked(listReservations);

async function makeOrgProp(hospitableId: string | null) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "P", hospitableId },
  });
  return { orgId: org.id, propertyId: property.id };
}

async function makeRes(propertyId: string, sourceRef: string, arrival: Date) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "G",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 86_400_000),
      channel: "airbnb",
      status: "confirmed",
      currency: "EUR",
      sourceReference: sourceRef,
    },
    select: { id: true },
  });
}

describe("cleanupStaleReservations", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("removes a ghost Hospitable no longer has, keeps the valid one", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    const today = new Date();
    const valid = await makeRes(propertyId, "res-valid", today);
    const ghost = await makeRes(propertyId, "res-ghost", today);
    // ⚠️ KÖKEN KANITI ARTIK ŞART (Codex kararı, 08-01 — fail-closed): silinebilmesi
    // için satırın Hospitable senkronunda yaratılmış bir KONUŞMASI olmalı.
    // `importThread` bunu HER ZAMAN yazar; CSV/iCal yolları hiç konuşma yaratmaz.
    // Fixture'a eklendi — eski hâli bu ayrımın yokluğunu pinliyordu.
    await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: "airbnb",
        status: "answered",
        externalReservationId: "res-ghost",
      },
    });

    // Hospitable currently only knows res-valid (res-ghost was re-issued/moved).
    mockList.mockResolvedValue([{ id: "res-valid" }]);

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 1, checkedProperties: 1 });
    expect(await prisma.reservation.findUnique({ where: { id: valid.id } })).not.toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: ghost.id } })).toBeNull();
  });

  it("never prunes when the fetch returns EMPTY (unverifiable)", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    await makeRes(propertyId, "res-1", new Date());
    mockList.mockResolvedValue([]);

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, skippedProperties: 1 });
    expect(await prisma.reservation.count()).toBe(1);
  });

  it("never prunes when the fetch THROWS (rate limit etc.)", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    await makeRes(propertyId, "res-1", new Date());
    mockList.mockRejectedValue(new Error("rate limit"));

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, skippedProperties: 1 });
    expect(await prisma.reservation.count()).toBe(1);
  });

  it("leaves out-of-window reservations alone even if absent from the result", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    const farFuture = new Date(Date.now() + 600 * 86_400_000); // beyond the +540d window
    const future = await makeRes(propertyId, "res-far", farFuture);
    mockList.mockResolvedValue([{ id: "res-other" }]); // does NOT include res-far

    const out = await cleanupStaleReservations(orgId);

    expect(out.removed).toBe(0); // out of window → not eligible for pruning
    expect(await prisma.reservation.findUnique({ where: { id: future.id } })).not.toBeNull();
  });

  it("ignores properties with no hospitableId", async () => {
    const { orgId, propertyId } = await makeOrgProp(null);
    await makeRes(propertyId, "res-1", new Date());

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, checkedProperties: 0, skippedProperties: 0 });
    expect(mockList).not.toHaveBeenCalled();
    expect(await prisma.reservation.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED: KÖKENİ KANITLANAMAYAN SATIR SİLİNMEZ (Codex kararı, 08-01).
//
// Temizlik "Hospitable kökenli" satırları hedefliyor ama SORGU bunu zorlamıyordu:
// filtre yalnız `sourceReference != null` idi. iCal satırlarının referansı VEVENT
// UID'i, CSV'ninki dosyadaki referans — ikisi de Hospitable'ın id uzayında DEĞİL,
// yani `seen`'de asla bulunmaz ve HEPSİ "hayalet" sayılıp KALICI siliniyordu.
// Kayıp yalnız rezervasyon satırı değil: `*SentAt` damgaları da gittiği için feed
// yeniden senkronlanınca AYNI misafire karşılama/giriş/çıkış mesajları TEKRAR gider.
//
// ⚠️ `channel` AYIRT EDİCİ DEĞİL — `channelFromLabel` (iCal) ve `toChannel`
// (Hospitable) AYNI değerleri üretir. `calendarSourceId` iCal'i ayırır ama CSV de
// Hospitable gibi NULL taşır → tek KANIT: satırın Hospitable senkronunda yaratılmış
// bir KONUŞMAYA bağlı olması (`importThread` thread'i HER ZAMAN yazar; CSV yolu
// hiç konuşma yaratmaz). Kanıtsız satır SİLİNMEZ, SAYILIR.
// Kalıcı çözüm `Reservation.ingestionOrigin` (nullable migration, ↑docs).
// ---------------------------------------------------------------------------
describe("cleanupStaleReservations — fail-closed köken kanıtı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  const soon = () => new Date(Date.now() + 5 * 86_400_000);

  // ⚠️ ÇİFT KAYNAK — CLAUDE.md 07-29'da belgelenen GERÇEK prod şekli: aynı ilan hem
  // Hospitable'dan hem bir iCal feed'inden geliyor (prod'da 8 canlı feed var).
  // O durumda konuşma Hospitable tarafından YARATILMIŞ olabilir (yani "kanıt"
  // sinyali dolu) ama rezervasyon satırı iCal kaynağına BAĞLIDIR. `calendarSourceId`
  // kapsamı olmasaydı bu satır silinirdi — iki koruma FARKLI satırları kurtarıyor.
  it("ÇİFT KAYNAK: konuşması olsa bile iCal'e BAĞLI satır silinmez", async () => {
    const { orgId, propertyId } = await makeOrgProp("hp-1");
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/a.ics" },
    });
    const r = await makeRes(propertyId, "VEVENT-UID-1", soon());
    await prisma.reservation.update({ where: { id: r.id }, data: { calendarSourceId: source.id } });
    // Konuşma VAR (Hospitable tarafından yaratılmış) → kanıt sinyali bu satırı kurtarmaz.
    await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: "airbnb",
        status: "answered",
        externalReservationId: "VEVENT-UID-1",
      },
    });
    mockList.mockResolvedValue([{ id: "hosp-only" }]);

    const out = await cleanupStaleReservations(orgId);
    expect(out.removed).toBe(0); // ⬅️ `calendarSourceId` kapsamı YOKSA 1 olurdu
    expect(await prisma.reservation.count({ where: { id: r.id } })).toBe(1);
  });

  it("KONUŞMASI OLMAYAN satır (CSV şekli) silinmez, SAYILIR", async () => {
    const { orgId, propertyId } = await makeOrgProp("hp-2");
    const r = await makeRes(propertyId, "CSV-REF-1", soon());
    mockList.mockResolvedValue([{ id: "hosp-only" }]);

    const out = await cleanupStaleReservations(orgId);
    expect(out.removed).toBe(0); // ⬅️ ARIZADA 1 olurdu
    expect(out.unprovableSkipped).toBe(1); // görünür: rapora çıkar
    expect(await prisma.reservation.count({ where: { id: r.id } })).toBe(1);
  });

  it("KANITLI Hospitable satırı (konuşması var) hâlâ silinir — koruma dekoratif değil", async () => {
    const { orgId, propertyId } = await makeOrgProp("hp-3");
    const r = await makeRes(propertyId, "hosp-gone-1", soon());
    await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: "airbnb",
        status: "answered",
        externalReservationId: "hosp-gone-1",
      },
    });
    mockList.mockResolvedValue([{ id: "hosp-still-here" }]);

    const out = await cleanupStaleReservations(orgId);
    expect(out.removed).toBe(1);
    expect(out.unprovableSkipped).toBe(0);
    expect(await prisma.reservation.count({ where: { id: r.id } })).toBe(0);
  });

  it("Hospitable HÂLÂ döndürüyorsa kanıtlı satır da silinmez (regresyon pini)", async () => {
    const { orgId, propertyId } = await makeOrgProp("hp-4");
    const r = await makeRes(propertyId, "hosp-alive-1", soon());
    await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: "airbnb",
        status: "answered",
        externalReservationId: "hosp-alive-1",
      },
    });
    mockList.mockResolvedValue([{ id: "hosp-alive-1" }]);

    const out = await cleanupStaleReservations(orgId);
    expect(out.removed).toBe(0);
    expect(await prisma.reservation.count({ where: { id: r.id } })).toBe(1);
  });
});
