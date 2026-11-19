import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { loadBookingComparison } from "@/lib/reservations/compare";
import { activeBookingConflicts, BOOKING_ENDED_SLACK_MS } from "@/lib/booking-property-conflict";

// ---------------------------------------------------------------------------
// UA-1 (kurucu 11-19): "Kayıtları karşılaştır" sayfasının verisi. Gerçek PostgreSQL.
// Sabitlenen: anahtar = satır kimliği (Dikkat satırının `rowKey`i) · başka işletmenin anahtarı → null (sayfa 404) · aynı kaynak kimliği
// başka işletmede GÖRÜNMEZ · kaynak sınıfı + besleme adı · etkin olmayan satır etiketli, eylemsiz · çakışma çözülünce `resolved`.
// ---------------------------------------------------------------------------

const DAY = 24 * 3_600_000;

async function world(names = ["Lale 5", "Lale 3"]) {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const ids: string[] = [];
  for (const name of names) ids.push((await prisma.property.create({ data: { organizationId: org.id, name } })).id);
  return { orgId: org.id, ids };
}

async function booking(
  propertyId: string,
  ref: string | null,
  o: { channel?: string; calendarSourceId?: string; connectionId?: string; guestNameSource?: string; status?: string; departure?: Date } = {},
) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: stayDay(4),
      departureDate: o.departure ?? stayDay(7),
      status: o.status ?? "confirmed",
      sourceReference: ref,
      channel: o.channel ?? "manual",
      calendarSourceId: o.calendarSourceId ?? null,
      connectionId: o.connectionId ?? null,
      guestNameSource: o.guestNameSource ?? null,
    },
    select: { id: true },
  });
}

const load = (organizationId: string, key: string) => loadBookingComparison(prisma, { organizationId, key, now: new Date() });

describe("loadBookingComparison (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 Dikkat satırının anahtarı sayfayı açar: iki satır, kaynak sınıfları, besleme adı; etkin daireler ada göre; elle satır kaldırılabilir", async () => {
    const w = await world();
    const source = await prisma.calendarSource.create({ data: { propertyId: w.ids[0], label: "Booking.com", url: "https://example.com/b.ics" } });
    const cal = await booking(w.ids[0], "HM-1", { channel: "booking", calendarSourceId: source.id, guestNameSource: "calendar" });
    const manual = await booking(w.ids[1], "HM-1", { channel: "manual", guestNameSource: "host" });
    const { conflicts } = await activeBookingConflicts(prisma, { organizationId: w.orgId, now: new Date() });
    expect(conflicts).toHaveLength(1);

    const view = await load(w.orgId, conflicts[0].rowKey);

    expect(view).not.toBeNull();
    expect(view!.resolved).toBe(false);
    expect(view!.activePropertyNames).toEqual(["Lale 3", "Lale 5"]);
    expect(view!.rows.map((r) => [r.id, r.propertyName, r.sourceClass, r.calendarSourceLabel, r.active, r.removable])).toEqual([
      [manual.id, "Lale 3", "manual", null, true, true],
      [cal.id, "Lale 5", "calendar", "Booking.com", true, false],
    ]);
    // Herhangi bir satırın kimliği aynı görünümü açar (anahtar yalnız giriş noktası).
    expect((await load(w.orgId, cal.id))!.rows.map((r) => r.id)).toEqual(view!.rows.map((r) => r.id));
  });

  it("🚨 başka işletmenin anahtarı → null (404); aynı kaynak kimlikli başka işletme satırı görünümde YOK", async () => {
    const a = await world();
    const b = await world(["Lale 9"]);
    const mine = await booking(a.ids[0], "HM-1");
    await booking(a.ids[1], "HM-1", { channel: "airbnb", connectionId: "c1" });
    const foreign = await booking(b.ids[0], "HM-1");
    expect(await load(a.orgId, foreign.id)).toBeNull();
    expect(await load(b.orgId, mine.id)).toBeNull();
    const view = await load(a.orgId, mine.id);
    expect(view!.rows).toHaveLength(2);
    expect(view!.rows.map((r) => r.id)).not.toContain(foreign.id);
    expect(await load(a.orgId, "yok")).toBeNull();
  });

  it("kaynak kimliği olmayan satır → null (karşılaştırılacak bir şey yok)", async () => {
    const w = await world();
    const bare = await booking(w.ids[0], null);
    expect(await load(w.orgId, bare.id)).toBeNull();
  });

  it("🚨 etkin olmayan satırlar (iptal / konaklaması bitmiş) etiketli ve EYLEMSİZ; en sonda", async () => {
    const w = await world(["Lale 1", "Lale 2", "Lale 3", "Lale 4"]);
    const live1 = await booking(w.ids[2], "HM-1", { channel: "airbnb", connectionId: "c1" });
    const live2 = await booking(w.ids[3], "HM-1");
    const cancelled = await booking(w.ids[0], "HM-1", { status: "cancelled" });
    const ended = await booking(w.ids[1], "HM-1", { departure: new Date(Date.now() - BOOKING_ENDED_SLACK_MS - DAY) });
    const view = (await load(w.orgId, live1.id))!;
    expect(view.rows.map((r) => [r.id, r.active, r.removable])).toEqual([
      [live1.id, true, false],
      [live2.id, true, true],
      [cancelled.id, false, false],
      [ended.id, false, false],
    ]);
    expect(view.resolved).toBe(false);
    expect(view.activePropertyNames).toEqual(["Lale 3", "Lale 4"]);
  });

  it("🚨 çakışma çözülünce (elle kopya silindi ya da iptal) resolved; kalan satır görünür", async () => {
    const w = await world();
    const channel = await booking(w.ids[0], "HM-1", { channel: "airbnb", connectionId: "c1" });
    const manual = await booking(w.ids[1], "HM-1");
    expect((await load(w.orgId, manual.id))!.resolved).toBe(false);
    await prisma.reservation.update({ where: { id: manual.id }, data: { status: "cancelled" } });
    const afterCancel = (await load(w.orgId, channel.id))!;
    expect(afterCancel.resolved).toBe(true);
    expect(afterCancel.activePropertyNames).toEqual(["Lale 5"]);
    await prisma.reservation.delete({ where: { id: manual.id } });
    const afterDelete = (await load(w.orgId, channel.id))!;
    expect(afterDelete.resolved).toBe(true);
    expect(afterDelete.rows.map((r) => r.id)).toEqual([channel.id]);
  });

  it("başka işletmenin beslemesine işaret eden takvim kimliği adını sızdırmaz (ad null)", async () => {
    const a = await world();
    const b = await world(["Lale 9"]);
    const foreignSource = await prisma.calendarSource.create({ data: { propertyId: b.ids[0], label: "Gizli", url: "https://example.com/g.ics" } });
    const row = await booking(a.ids[0], "HM-1", { channel: "airbnb", calendarSourceId: foreignSource.id });
    await booking(a.ids[1], "HM-1");
    const view = (await load(a.orgId, row.id))!;
    const cal = view.rows.find((r) => r.id === row.id)!;
    expect(cal.sourceClass).toBe("calendar");
    expect(cal.calendarSourceLabel).toBeNull();
  });
});
