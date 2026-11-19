import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// `createReservationTasks` HIZLI YOL — SORGU MALİYETİ + KİLİTLİ YOLLA EŞDEĞERLİK (O1 optimizasyonu, 11-19).
//
// Hospitable senkronu her 2 dakikada pencerendeki (dar: 30 gün geri; saatlik derin: 540 gün geri) HER rezervasyon için bunu çağırır.
// Kilitsiz ön okuma rezervasyonu mülk + işletme saat dilimiyle birlikte okuyordu (iç içe seçim = 3 SQL) ve ardından görevleri: iptal ya da
// çoktan bitmiş konaklama için de 4 SQL. Artık önce yalnız rezervasyonun kendi kolonları okunur; iptal → 0, giriş de çıkış da HER saat
// diliminde bugünden önce (72 saat pay) → 0; kalanında okuma sırası ve sayısı aynı (Reservation · Property · Organization · Task).
//
// Eşdeğerlik iki katmanlı:
//   1. Saf kural: "her dilimde geçmiş" diyen yardımcı, hiçbir IANA diliminde `onOrAfterToday` doğru olan bir tarihi geçmiş SAYMAZ
//      (00:00Z / 12:00Z çapaları ve gerçek anlar, sınırın iki yanı).
//   2. Kilitli yol KÂHİN: `{ reopened: true }` hızlı yolu atlar ve kararı kilit altında aynı saf fonksiyonla verir (o kod değişmedi).
//      İkiz fikstürde (aynı veri, iki işletme) hızlı yolun sonucu ve yazdığı görevler kilitli yolunkiyle birebir.
// ---------------------------------------------------------------------------

const counter = vi.hoisted(() => ({ on: false, rows: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on(e: string, cb: (e: { query: string }) => void): void }).$on("query", (e) => {
    if (counter.on) counter.rows.push(e.query);
  });
  return { prisma: client };
});

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { createReservationTasks, lifecycleDatesPastInEveryTimeZone } from "@/lib/automation";
import { onOrAfterToday } from "@/modules/availability/core";

const HOUR = 3_600_000;

async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: string[] }> {
  counter.rows = [];
  counter.on = true;
  try {
    const result = await fn();
    return { result, queries: [...counter.rows] };
  } finally {
    counter.on = false;
  }
}
const tableOf = (q: string) => /(?:FROM|INTO|UPDATE)\s+"public"\."(\w+)"/i.exec(q)?.[1] ?? q.trim().split(/\s+/)[0];

async function orgWithProperty(timezone: string, name = "Lale") {
  const org = await prisma.organization.create({ data: { name: `Org ${timezone}`, timezone } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name, createdAt: PROPERTY_EXISTED_BEFORE, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  return { orgId: org.id, propertyId: property.id };
}

describe("lifecycleDatesPastInEveryTimeZone — saf kural, bütün IANA dilimleri", () => {
  const zones = Intl.supportedValuesOf("timeZone");
  const nows = [
    new Date("2026-11-19T00:00:00.000Z"),
    new Date("2026-11-19T11:59:59.999Z"),
    new Date("2026-11-19T12:00:00.000Z"),
    new Date("2026-11-19T23:30:00.000Z"),
    new Date("2026-03-29T01:30:00.000Z"), // Avrupa yaz saati geçişi
    new Date("2026-11-01T06:30:00.000Z"), // ABD kış saati geçişi
  ];

  it("🚨 'her dilimde geçmiş' dediği tarih HİÇBİR dilimde bugün ya da sonrası değildir (giriş ve çıkış)", () => {
    let checked = 0;
    let pastSeen = 0;
    for (const now of nows) {
      const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const candidates: Date[] = [];
      // Sınırın (72 sa) iki yanında saatlik gerçek anlar + gün çapaları (00:00Z / 12:00Z), 6 gün geriye.
      for (let h = 0; h <= 6 * 24; h++) candidates.push(new Date(now.getTime() - h * HOUR - 17 * 60_000));
      for (let d = 0; d <= 6; d++) {
        candidates.push(new Date(dayStart - d * 24 * HOUR));
        candidates.push(new Date(dayStart - d * 24 * HOUR + 12 * HOUR));
      }
      candidates.push(new Date(now.getTime() - 72 * HOUR)); // tam sınır
      for (const dep of candidates) {
        const arr = new Date(dep.getTime() - 3 * 24 * HOUR);
        if (!lifecycleDatesPastInEveryTimeZone({ arrivalDate: arr, departureDate: dep }, now)) continue;
        pastSeen++;
        for (const tz of zones) {
          checked++;
          if (onOrAfterToday(dep, now, tz) || onOrAfterToday(arr, now, tz)) {
            throw new Error(`yanlış geçmiş: dep=${dep.toISOString()} now=${now.toISOString()} tz=${tz}`);
          }
        }
      }
    }
    // Anti-vakum: kural gerçekten "geçmiş" dedi ve her dilim denendi.
    expect(pastSeen).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(pastSeen * 300);
  });

  it("giriş tarihi çıkıştan SONRA saklanmış satırda (bozuk veri) giriş de dikkate alınır", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    expect(
      lifecycleDatesPastInEveryTimeZone({ arrivalDate: new Date(now.getTime() + 2 * 24 * HOUR), departureDate: new Date(now.getTime() - 10 * 24 * HOUR) }, now),
    ).toBe(false);
  });

  it("aşırı uygulama yok: son 72 saat içindeki çıkış 'geçmiş' sayılmaz (dilime göre bugün olabilir)", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    const dep = new Date(now.getTime() - 71 * HOUR);
    expect(lifecycleDatesPastInEveryTimeZone({ arrivalDate: new Date(dep.getTime() - 24 * HOUR), departureDate: dep }, now)).toBe(false);
  });
});

describe("createReservationTasks — hızlı yolun sorgu sayısı", () => {
  beforeEach(resetDb);

  it("🚨 iptal edilmiş rezervasyon: TEK okuma (eskiden rezervasyon + mülk + işletme = 3)", async () => {
    const { propertyId } = await orgWithProperty("Europe/Istanbul");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() + 2 * 24 * HOUR), departureDate: new Date(Date.now() + 4 * 24 * HOUR), channel: "airbnb", status: "cancelled" },
    });
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0);
    expect(queries.map(tableOf)).toEqual(["Reservation"]);
  });

  it("🚨 her dilimde bitmiş konaklama: TEK okuma (eskiden rezervasyon + mülk + işletme + görev = 4)", async () => {
    const { propertyId } = await orgWithProperty("Pacific/Kiritimati");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() - 10 * 24 * HOUR), departureDate: new Date(Date.now() - 7 * 24 * HOUR), channel: "airbnb", status: "confirmed" },
    });
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0);
    expect(queries.map(tableOf)).toEqual(["Reservation"]);
  });

  it("gelecek konaklama, görevleri tam: okuma sırası ve sayısı AYNI kalır (Reservation · Property · Organization · Task), işlem yok", async () => {
    const { propertyId } = await orgWithProperty("Europe/Istanbul");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() + 2 * 24 * HOUR), departureDate: new Date(Date.now() + 4 * 24 * HOUR), channel: "airbnb", status: "confirmed" },
    });
    expect(await createReservationTasks(r.id)).toBe(2);
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0);
    expect(queries.map(tableOf)).toEqual(["Reservation", "Property", "Organization", "Task"]);
  });
});

describe("createReservationTasks — hızlı yol kilitli yolla (kâhin) aynı kararı verir", () => {
  beforeEach(resetDb);

  // Dilim × tarih ızgarası: çıkış şimdiden −100 sa … +30 sa, gerçek an ve gün çapaları; giriş çıkıştan 2 gün önce (bazıları bugün).
  const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Istanbul", "America/New_York", "Asia/Kathmandu"];
  function grid(now: Date): { arrivalDate: Date; departureDate: Date; status: string }[] {
    const out: { arrivalDate: Date; departureDate: Date; status: string }[] = [];
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (const h of [-100, -80, -73, -72, -71, -60, -50, -49, -37, -36, -30, -24, -13, -12, -1, 0, 1, 13, 30]) {
      const dep = new Date(now.getTime() + h * HOUR + 7 * 60_000);
      out.push({ arrivalDate: new Date(dep.getTime() - 2 * 24 * HOUR), departureDate: dep, status: "confirmed" });
    }
    for (let d = -5; d <= 2; d++) {
      for (const off of [0, 12]) {
        const dep = new Date(dayStart + d * 24 * HOUR + off * HOUR);
        out.push({ arrivalDate: new Date(dep.getTime() - 2 * 24 * HOUR), departureDate: dep, status: "confirmed" });
        out.push({ arrivalDate: dep, departureDate: new Date(dep.getTime() + 24 * HOUR), status: "pending" });
      }
    }
    out.push({ arrivalDate: new Date(now.getTime() + 24 * HOUR), departureDate: new Date(now.getTime() + 3 * 24 * HOUR), status: "cancelled" });
    return out;
  }

  it("🚨 ikiz fikstürde dönen sayı ve yazılan görevler birebir (5 dilim × 36 konaklama)", async () => {
    const now = new Date();
    let created = 0;
    for (const tz of zones) {
      const fast = await orgWithProperty(tz, "Lale 1");
      const locked = await orgWithProperty(tz, "Lale 1");
      const rows = grid(now);
      for (const [i, row] of rows.entries()) {
        const a = await prisma.reservation.create({ data: { ...row, propertyId: fast.propertyId, guestName: `Misafir ${i}`, channel: "airbnb" } });
        const b = await prisma.reservation.create({ data: { ...row, propertyId: locked.propertyId, guestName: `Misafir ${i}`, channel: "airbnb" } });
        const got = await createReservationTasks(a.id);
        const want = await createReservationTasks(b.id, { reopened: true });
        expect({ tz, i, got }).toEqual({ tz, i, got: want });
        created += got;
      }
      const shape = async (propertyId: string) =>
        (
          await prisma.task.findMany({
            where: { propertyId },
            select: { type: true, origin: true, title: true, dueAt: true, dueAtPrecision: true, status: true, checklistJson: true, assignedToId: true },
            orderBy: [{ title: "asc" }, { type: "asc" }],
          })
        ).map((t) => ({ ...t }));
      expect(await shape(fast.propertyId)).toEqual(await shape(locked.propertyId));
    }
    // Anti-vakum: ızgara iki yönü de içerir (görev yazılan ve yazılmayan konaklamalar).
    expect(created).toBeGreaterThan(20);
  }, 120_000);
});
