import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// `createReservationTasks` HIZLI YOL — SORGU MALİYETİ + KİLİTLİ YOLLA EŞDEĞERLİK (O1 optimizasyonu, 11-19).
//
// Hospitable senkronu her 2 dakikada pencerendeki (dar: 30 gün geri; saatlik derin: 540 gün geri) HER rezervasyon için bunu çağırır.
// Kilitsiz ön okuma rezervasyonu mülk + işletme saat dilimiyle birlikte okuyordu (iç içe seçim = 3 SQL) ve ardından görevleri: her çağrıda
// 4 SQL. Artık önce yalnız rezervasyonun kendi kolonları okunur; iptal → 0; giriş de çıkış da HER saat diliminde bugünden önce (72 saat
// pay) → 0; görevler okunur ve her tür ya geçmiş ya sistemin açtığı bitmemiş görevle duruyorsa → 0 (mülk / işletme okunmaz). Kalanında
// karar eskisiyle aynı tam kuraldan (Reservation · Task · Property · Organization).
//
// Eşdeğerlik iki katmanlı:
//   1. Saf kural: "yerleşik" diyen yardımcı, hiçbir IANA diliminde görev yazdıracak bir girişi yerleşik SAYMAZ (kâhin `wouldCreate` =
//      gerçek `onOrAfterToday` + `lifecycleTaskPresent`; 00:00Z / 12:00Z çapaları ve gerçek anlar, sınırın iki yanı).
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
import { flushQueryEvents } from "../helpers/query-event-barrier";
import { createReservationTasks, lifecycleTasksSettledInEveryTimeZone } from "@/lib/automation";
import { onOrAfterToday } from "@/modules/availability/core";
import { lifecycleTaskPresent } from "@/lib/tasks/lifecycle-presence";

const HOUR = 3_600_000;

async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: string[] }> {
  counter.rows = [];
  counter.on = true;
  try {
    const result = await fn();
    await flushQueryEvents(prisma, counter); // son sorgunun olayı sonuçtan sonra gelebilir (CI 1841)
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

/**
 * KURALIN AYNASI (test kâhini): `reservationTasksToCreate` bir tür için görev yazar ⇔ tarihi dilimde bugün ya da sonrası VE o tür
 * `lifecycleTaskPresent`e göre yok. Hızlı yolun "yerleşik" dediği her girişte bu ifade HER dilimde iki tür için de yanlış olmalı.
 */
function wouldCreate(r: { arrivalDate: Date; departureDate: Date }, tasks: Parameters<typeof lifecycleTaskPresent>[2], now: Date, tz: string) {
  return (
    (onOrAfterToday(r.arrivalDate, now, tz) && !lifecycleTaskPresent("checkin_prep", r.arrivalDate, tasks, tz)) ||
    (onOrAfterToday(r.departureDate, now, tz) && !lifecycleTaskPresent("cleaning", r.departureDate, tasks, tz))
  );
}

describe("lifecycleTasksSettledInEveryTimeZone — saf kural, bütün IANA dilimleri", () => {
  const zones = Intl.supportedValuesOf("timeZone");
  const nows = [
    new Date("2026-11-19T00:00:00.000Z"),
    new Date("2026-11-19T11:59:59.999Z"),
    new Date("2026-11-19T12:00:00.000Z"),
    new Date("2026-11-19T23:30:00.000Z"),
    new Date("2026-03-29T01:30:00.000Z"), // Avrupa yaz saati geçişi
    new Date("2026-11-01T06:30:00.000Z"), // ABD kış saati geçişi
  ];
  const T = (type: string, origin: string, status: string, dueAt: Date | null, commitments = 0) => ({ type, origin, status, dueAt, _count: { commitments } });
  const day = (n: number) => new Date(Date.UTC(2026, 10, 19 + n));

  it("🚨 görev yokken (yalnız tarih şartı): 'yerleşik' dediği konaklamada HİÇBİR dilimde görev yazılmaz — sınırın iki yanı, çapalar", () => {
    let checked = 0;
    let settledSeen = 0;
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
        const r = { arrivalDate: new Date(dep.getTime() - 3 * 24 * HOUR), departureDate: dep };
        if (!lifecycleTasksSettledInEveryTimeZone(r, [], now)) continue;
        settledSeen++;
        for (const tz of zones) {
          checked++;
          if (wouldCreate(r, [], now, tz)) throw new Error(`yanlış yerleşik: dep=${dep.toISOString()} now=${now.toISOString()} tz=${tz}`);
        }
      }
    }
    // Anti-vakum: kural gerçekten "yerleşik" dedi ve her dilim denendi.
    expect(settledSeen).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(settledSeen * 300);
  });

  it("🚨 görev listesiyle: 'yerleşik' dediği her (konaklama, görevler) çiftinde HİÇBİR dilimde görev yazılmaz", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    const stays = [
      { arrivalDate: day(2), departureDate: day(4) }, // gelecek
      { arrivalDate: day(0), departureDate: day(3) }, // bugün giriş (çapa)
      { arrivalDate: new Date(now.getTime() - 5 * 24 * HOUR), departureDate: day(2) }, // sürüyor, giriş her dilimde geçmiş
      { arrivalDate: new Date(now.getTime() - 30 * HOUR), departureDate: day(2) }, // sürüyor, giriş bazı dilimlerde bugün olabilir
      { arrivalDate: new Date("2026-11-21T13:37:00.000Z"), departureDate: new Date("2026-11-23T08:10:00.000Z") }, // gerçek anlar
    ];
    const lists = [
      [T("checkin_prep", "system", "todo", day(2)), T("cleaning", "system", "todo", day(4))],
      [T("checkin_prep", "system", "in_progress", null), T("cleaning", "system", "todo", day(-30))], // vadesi boş / taşınmış: yine "var"
      [T("cleaning", "system", "todo", day(2))],
      [T("checkin_prep", "system", "todo", day(2)), T("cleaning", "system", "done", day(4))],
      [T("checkin_prep", "system", "todo", day(2)), T("cleaning", "manual", "todo", day(4))],
      [T("cleaning", "system", "todo", day(4)), T("checkin_prep", "ai", "todo", day(2))],
      [T("checkin_prep", "system", "done", day(2)), T("cleaning", "system", "done", day(4))],
      [],
    ];
    let settledSeen = 0;
    for (const r of stays) {
      for (const tasks of lists) {
        if (!lifecycleTasksSettledInEveryTimeZone(r, tasks, now)) continue;
        settledSeen++;
        for (const tz of zones) {
          if (wouldCreate(r, tasks, now, tz)) throw new Error(`yanlış yerleşik: r=${JSON.stringify(r)} tz=${tz}`);
        }
      }
    }
    // Anti-vakum: iki açık sistem görevi (5 konaklama × 2 liste) + giriş her dilimde geçmiş ve açık sistem temizliği (2 liste: yalnız
    // temizlik · temizlik + yapay zekâ hazırlığı).
    expect(settledSeen).toBe(12);
  });

  it("aşırı uygulama yok: biten / elle / yapay zekâ görevi, eksik tür ya da son 72 saatteki tarih 'yerleşik' sayılmaz (tam kural koşar)", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    const future = { arrivalDate: day(2), departureDate: day(4) };
    expect(lifecycleTasksSettledInEveryTimeZone(future, [T("checkin_prep", "system", "todo", day(2)), T("cleaning", "system", "done", day(4))], now)).toBe(false);
    expect(lifecycleTasksSettledInEveryTimeZone(future, [T("checkin_prep", "system", "todo", day(2)), T("cleaning", "manual", "todo", day(4))], now)).toBe(false);
    expect(lifecycleTasksSettledInEveryTimeZone(future, [T("checkin_prep", "ai", "todo", day(2)), T("cleaning", "system", "todo", day(4))], now)).toBe(false);
    expect(lifecycleTasksSettledInEveryTimeZone(future, [T("cleaning", "system", "todo", day(4))], now)).toBe(false);
    const dep = new Date(now.getTime() - 71 * HOUR);
    expect(lifecycleTasksSettledInEveryTimeZone({ arrivalDate: new Date(dep.getTime() - 24 * HOUR), departureDate: dep }, [], now)).toBe(false);
    // Bozuk veri (giriş çıkıştan sonra): giriş de dikkate alınır.
    expect(lifecycleTasksSettledInEveryTimeZone({ arrivalDate: day(2), departureDate: new Date(now.getTime() - 10 * 24 * HOUR) }, [], now)).toBe(false);
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

  it("🚨 gelecek konaklama, iki sistem görevi de açık (senkronun olağan hâli): İKİ okuma, mülk / işletme okunmaz (eskiden 4), işlem yok", async () => {
    const { propertyId } = await orgWithProperty("Europe/Istanbul");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() + 2 * 24 * HOUR), departureDate: new Date(Date.now() + 4 * 24 * HOUR), channel: "airbnb", status: "confirmed" },
    });
    expect(await createReservationTasks(r.id)).toBe(2);
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0);
    expect(queries.map(tableOf)).toEqual(["Reservation", "Task"]);
  });

  it("sürmekte olan konaklama (giriş her dilimde geçmiş), açık temizlik: İKİ okuma (giriş hazırlığı aranmaz)", async () => {
    const { propertyId } = await orgWithProperty("America/New_York");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() - 5 * 24 * HOUR), departureDate: new Date(Date.now() + 2 * 24 * HOUR), channel: "airbnb", status: "confirmed" },
    });
    expect(await createReservationTasks(r.id)).toBe(1); // yalnız çıkış temizliği
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0);
    expect(queries.map(tableOf)).toEqual(["Reservation", "Task"]);
  });

  it("dilim gereken durumda tam kural aynen koşar: biten görev (aynı gün mü?) → rezervasyon · görev · mülk · işletme, işlem yok", async () => {
    const { propertyId } = await orgWithProperty("Europe/Istanbul");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() + 2 * 24 * HOUR), departureDate: new Date(Date.now() + 4 * 24 * HOUR), channel: "airbnb", status: "confirmed" },
    });
    expect(await createReservationTasks(r.id)).toBe(2);
    await prisma.task.updateMany({ where: { reservationId: r.id, type: "cleaning" }, data: { status: "done" } });
    const { result, queries } = await countQueries(() => createReservationTasks(r.id));
    expect(result).toBe(0); // bitmiş sistem görevi aynı günün görevi → var sayılır
    expect(queries.map(tableOf)).toEqual(["Reservation", "Task", "Property", "Organization"]);
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
        // İkinci tur: görev durumu değişir (biri biter / biri silinir / biri elle olur / dokunulmaz) → hızlı yolun her çıkışı kâhinle kıyaslanır.
        const mutate = async (reservationId: string) => {
          const mode = i % 4;
          if (mode === 1) await prisma.task.updateMany({ where: { reservationId, type: "cleaning" }, data: { status: "done" } });
          if (mode === 2) await prisma.task.deleteMany({ where: { reservationId, type: "checkin_prep" } });
          if (mode === 3) await prisma.task.updateMany({ where: { reservationId, type: "cleaning" }, data: { origin: "manual", reservationId: null } });
        };
        await mutate(a.id);
        await mutate(b.id);
        const got2 = await createReservationTasks(a.id);
        const want2 = await createReservationTasks(b.id, { reopened: true });
        expect({ tz, i, round: 2, got: got2 }).toEqual({ tz, i, round: 2, got: want2 });
        created += got2;
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
