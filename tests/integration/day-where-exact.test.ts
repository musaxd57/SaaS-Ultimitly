import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { reservationDayRangeWhere, taskDueDayRangeWhere, type DayRange } from "@/lib/day-where";
import { addNights, calendarDateOf, onOrAfterToday, todayKey } from "@/modules/availability/core";
import { zonedDayRange, zonedWallClockToUtc } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// TEK TARİH KURALININ SORGU İKİZİ KESİN Mİ (09-26). Sayım ve listeler `reservationDayRangeWhere` / `taskDueDayRangeWhere`
// kullanır; bellekteki karar `calendarDateOf`. İkisi HER dilimde, her "şimdi" anında, her saklama biçiminde (D 00:00Z ·
// D 12:00Z · gerçek an · yerel gece yarısı ±1 ms) ve her aralık biçiminde (bugün · bugün ve sonrası · geçmiş · hafta ·
// ters aralık) AYNI kümeyi seçmeli — veritabanı üzerinden. Ayrıca: UTC ile +12 arasındaki dilimlerde (İstanbul dahil)
// "bugün ya da sonrası" eski `>= gün başı` kıyasıyla BİREBİR (davranış değişmedi); fark yalnız UTC− ve +12 üstü
// dilimlerde (New York, Auckland) — orada eskisi yanlıştı.
// ---------------------------------------------------------------------------

const ZONES = [
  "Pacific/Kiritimati", // +14
  "Pacific/Auckland", // +12 / +13 (DST 27 Eylül)
  "Asia/Tokyo",
  "Asia/Kolkata", // +5:30
  "Europe/Istanbul",
  "Europe/Berlin",
  "UTC",
  "America/St_Johns", // −2:30
  "America/New_York",
  "Pacific/Honolulu",
  "Etc/GMT+12", // −12
] as const;

/** Her dilimde yerel 00:30 · 11:59 · 12:00 · 23:30 (26 Eylül) + DST günleri. */
function nowsFor(tz: string): Date[] {
  const at = (y: number, m: number, d: number, h: number, mi: number) => zonedWallClockToUtc(y, m, d, h, mi, 0, tz);
  const list = [at(2026, 9, 26, 0, 30), at(2026, 9, 26, 11, 59), at(2026, 9, 26, 12, 0), at(2026, 9, 26, 23, 30)];
  if (tz === "America/New_York") list.push(at(2026, 11, 1, 1, 30), at(2026, 3, 8, 12, 0)); // DST bitişi / başlangıcı
  if (tz === "Pacific/Auckland") list.push(at(2026, 9, 27, 12, 0)); // DST başlangıcı
  return list;
}

/** Sınanan aralıklar (bugüne göre): bugün · bugün ve sonrası · geçmiş · yedi gün · ters (boş). */
function rangesFor(now: Date, tz: string): [string, DayRange][] {
  const t = todayKey(now, tz);
  return [
    ["bugün", { from: t, to: t }],
    ["bugün ve sonrası", { from: t, to: null }],
    ["geçmiş", { from: null, to: addNights(t, -1) }],
    ["yedi gün", { from: addNights(t, -3), to: addNights(t, 3) }],
    ["ters", { from: addNights(t, 1), to: t }],
  ];
}

/** `calendarDateOf` anahtarları dilim başına BİR kez (her gerçek an bir Intl biçimleyicisi kurar — ızgara büyük). */
const keyCache = new Map<string, Map<number, string>>();
function keyOf(stored: Date, tz: string): string {
  let byTz = keyCache.get(tz);
  if (!byTz) keyCache.set(tz, (byTz = new Map()));
  let key = byTz.get(stored.getTime());
  if (key === undefined) byTz.set(stored.getTime(), (key = calendarDateOf(stored, tz).key));
  return key;
}

function inRange(stored: Date, range: DayRange, tz: string): boolean {
  const key = keyOf(stored, tz);
  return (range.from === null || key >= range.from) && (range.to === null || key <= range.to);
}

function gridValues(): Date[] {
  const out = new Map<number, Date>();
  const add = (d: Date) => out.set(d.getTime(), d);
  const spans: [string, number][] = [
    ["2026-09-20", 13],
    ["2026-10-29", 7],
    ["2026-03-04", 7],
  ];
  for (const [start, days] of spans) {
    const base = new Date(`${start}T00:00:00.000Z`).getTime();
    for (let i = 0; i < days * 48; i++) add(new Date(base + i * 30 * 60_000)); // yarım saat (çapalar dahil)
    for (const tz of ZONES) {
      for (let i = 0; i < days; i++) {
        const midnight = zonedDayRange(new Date(base + i * 86_400_000 + 12 * 3_600_000), tz).start;
        add(new Date(midnight.getTime() - 1));
        add(midnight);
        add(new Date(midnight.getTime() + 1));
      }
    }
  }
  return [...out.values()];
}

let propertyId: string;
let reservations: { id: string; arrivalDate: Date; departureDate: Date }[];
let tasks: { id: string; dueAt: Date | null }[];

beforeAll(async () => {
  await resetDb();
  ({ propertyId } = await makeOrgWithProperty());
  const values = gridValues();
  await prisma.reservation.createMany({
    data: values.map((v) => ({ propertyId, guestName: "Deneme Misafir", arrivalDate: v, departureDate: v, status: "confirmed" })),
  });
  await prisma.task.createMany({
    data: [
      ...values.map((v) => ({ propertyId, type: "cleaning", title: "Deneme", dueAt: v })),
      ...[1, 2, 3].map(() => ({ propertyId, type: "cleaning", title: "Vadesiz", dueAt: null })),
    ],
  });
  reservations = await prisma.reservation.findMany({ where: { propertyId }, select: { id: true, arrivalDate: true, departureDate: true } });
  tasks = await prisma.task.findMany({ where: { propertyId }, select: { id: true, dueAt: true } });
  expect(reservations.length).toBe(values.length);
  expect(tasks.length).toBe(values.length + 3);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("reservationDayRangeWhere / taskDueDayRangeWhere — bellekteki kararla AYNI küme (veritabanı)", () => {
  for (const tz of ZONES) {
    it(`${tz}: her 'şimdi' anında, her aralıkta, üç alanda da`, async () => {
      for (const now of nowsFor(tz)) {
        for (const [name, range] of rangesFor(now, tz)) {
          const label = `${tz} ${now.toISOString()} ${name}`;
          for (const field of ["arrivalDate", "departureDate"] as const) {
            const got = await prisma.reservation.findMany({
              where: { AND: [{ propertyId }, reservationDayRangeWhere(field, range, tz)] },
              select: { id: true },
            });
            const want = reservations.filter((r) => inRange(r[field], range, tz)).map((r) => r.id);
            if (name !== "ters") expect(want.length, `${label} ${field}`).toBeGreaterThan(0); // boş iddia değil
            expect(want.length, `${label} ${field}`).toBeLessThan(reservations.length);
            expect(got.map((r) => r.id).sort(), `${label} ${field}`).toEqual(want.sort());
          }
          const gotTasks = await prisma.task.findMany({
            where: { AND: [{ propertyId }, taskDueDayRangeWhere(range, tz)] },
            select: { id: true },
          });
          const wantTasks = tasks.filter((t) => t.dueAt !== null && inRange(t.dueAt, range, tz)).map((t) => t.id);
          expect(gotTasks.map((t) => t.id).sort(), `${label} dueAt`).toEqual(wantTasks.sort());
        }
      }
    });
  }

  it("iki uç da sınırsızsa süzgeç yok (vadesiz görev yine GİRMEZ); ters aralık hiçbir satır seçmez", async () => {
    const all = await prisma.reservation.count({ where: { AND: [{ propertyId }, reservationDayRangeWhere("arrivalDate", { from: null, to: null }, "UTC")] } });
    expect(all).toBe(reservations.length);
    const dated = await prisma.task.count({ where: { AND: [{ propertyId }, taskDueDayRangeWhere({ from: null, to: null }, "UTC")] } });
    expect(dated).toBe(tasks.length - 3);
    const none = await prisma.task.count({ where: { AND: [{ propertyId }, taskDueDayRangeWhere({ from: "2026-09-27", to: "2026-09-26" }, "UTC")] } });
    expect(none).toBe(0);
    const noneRes = await prisma.reservation.count({ where: { AND: [{ propertyId }, reservationDayRangeWhere("departureDate", { from: "2026-09-27", to: "2026-09-26" }, "UTC")] } });
    expect(noneRes).toBe(0);
  });
});

describe("onOrAfterToday — İstanbul (ve UTC..+12 arası) eski kuralla BİREBİR; UTC− ve +12 üstünde eskisi yanlıştı", () => {
  const all = gridValues();
  /** "Şimdi"nin ±3 günü (karar yalnız bugünün kenarında değişebilir; uzak değerler iki kuralda da aynı taraftadır). */
  const near = (now: Date) => all.filter((v) => Math.abs(v.getTime() - now.getTime()) <= 3 * 86_400_000);
  /** Eski kural: ham `tarih >= org gün başı`. */
  const diffWithOld = (now: Date, tz: string) => {
    const start = zonedDayRange(now, tz).start;
    return near(now)
      .filter((v) => onOrAfterToday(v, now, tz) !== v >= start)
      .map((v) => v.toISOString());
  };

  for (const tz of ["Europe/Istanbul", "UTC", "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo"]) {
    it(`${tz}: her değerde eskisiyle aynı karar`, () => {
      for (const now of nowsFor(tz)) {
        expect(near(now).length).toBeGreaterThan(300); // boş iddia değil
        expect(diffWithOld(now, tz), `${tz} ${now.toISOString()}`).toEqual([]);
      }
    });
  }

  it("New York: bugünün 00:00Z çapası eskide 'dün'dü (fark YALNIZ bugünün çapası)", () => {
    expect(diffWithOld(new Date("2026-09-26T15:00:00Z"), "America/New_York")).toEqual(["2026-09-26T00:00:00.000Z"]);
  });

  it("Auckland: dünün 12:00Z çapası eskide 'bugün'dü (fark YALNIZ dünün öğlen çapası)", () => {
    // NZST 26 Eylül 15:00
    expect(diffWithOld(new Date("2026-09-26T03:00:00Z"), "Pacific/Auckland")).toEqual(["2026-09-25T12:00:00.000Z"]);
  });
});
