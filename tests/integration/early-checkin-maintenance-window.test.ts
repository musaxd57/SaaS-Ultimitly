import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — "mülkte açık bakım" otomatik onayı DURDURUR (kanıt modeli: yalnız otomatik gönderimi durduranlar). 15 ajan
// incelemesi A15 (10-01, ölçüldü): bakım penceresi ÖNCEKİ çıkış gününde bitiyordu ve yalnız BAĞSIZ görevi sayıyordu →
//  · araya boş gün giren varışta bugüne / dünkü vadeli açık bakım,
//  · ESKİ bir konaklamaya bağlı hâlâ açık bakım,
//  · önceki konaklaması olmayan mülkteki açık bakım
// otomatik "Daireniz hazır" onayını durdurmuyordu.
// ---------------------------------------------------------------------------

// İstanbul (UTC+3): 14 Ekim 11:40.
const NOW = new Date("2026-10-14T08:40:00.000Z");
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const REQUESTED = { time: "13:00", sources: 2, conflict: false };

async function org() {
  const o = await prisma.organization.create({ data: { name: "Test Org", timezone: "Europe/Istanbul" } });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  return { orgId: o.id, propertyId: p.id };
}
const reservation = (propertyId: string, arrival: string, departure: string) =>
  prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status: "confirmed", channel: "airbnb" },
  });
const task = (propertyId: string, data: Record<string, unknown>) =>
  prisma.task.create({ data: { propertyId, title: "Bakım", origin: "manual", type: "maintenance", status: "todo", ...data } as never });
const facts = async (t: { orgId: string; propertyId: string }, ownId: string) =>
  (await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: ownId, now: NOW, requested: REQUESTED, singleIntent: true }))
    ?.facts;

describe("mülkte açık bakım — varış gününe kadar, her bağlamda", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 araya boş gün giren varış: bugüne ve düne tarihli açık bağsız bakım otomatik onayı durdurur; ileri tarihli durdurmaz", async () => {
    for (const [due, expected] of [
      [new Date("2026-10-14T10:00:00.000Z"), true], // bugün 13:00
      [new Date("2026-10-13T07:00:00.000Z"), true], // dün 10:00 (vadesi geçmiş)
      [midnight("2026-10-14"), true], // yalnız tarih: bugün
      [midnight("2026-10-15"), false], // yalnız tarih: yarın
      [new Date("2026-10-16T09:00:00.000Z"), false], // ileri tarih
    ] as const) {
      await resetDb();
      const t = await org();
      await reservation(t.propertyId, "2026-10-08", "2026-10-11");
      const own = await reservation(t.propertyId, "2026-10-14", "2026-10-16");
      await task(t.propertyId, { dueAt: due });
      expect((await facts(t, own.id))?.maintenanceOpen, due.toISOString()).toBe(expected);
    }
  });

  it("🚨 ESKİ bir konaklamaya bağlı hâlâ AÇIK bakım durdurur; kapanmışı ve eski konaklamanın açık çıkış KONTROLÜ durdurmaz", async () => {
    const t = await org();
    const older = await reservation(t.propertyId, "2026-10-01", "2026-10-05");
    await reservation(t.propertyId, "2026-10-12", "2026-10-14");
    const own = await reservation(t.propertyId, "2026-10-14", "2026-10-16");
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(false);
    const m = await task(t.propertyId, { reservationId: older.id });
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(true);
    await prisma.task.update({ where: { id: m.id }, data: { status: "done" } });
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(false);
    await task(t.propertyId, { reservationId: older.id, type: "checkout_review" });
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(false);
  });

  it("🚨 önceki konaklaması olmayan mülk: açık bakım yine durdurur", async () => {
    const t = await org();
    const own = await reservation(t.propertyId, "2026-10-14", "2026-10-16");
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(false);
    await task(t.propertyId, {});
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(true);
  });

  it("KONTROL: başka mülkün açık bakımı sayılmaz", async () => {
    const t = await org();
    const other = await org();
    const own = await reservation(t.propertyId, "2026-10-14", "2026-10-16");
    await task(other.propertyId, {});
    expect((await facts(t, own.id))?.maintenanceOpen).toBe(false);
  });
});
