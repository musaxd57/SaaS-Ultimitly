import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as dailyGET } from "@/app/api/reports/daily/route";

// ---------------------------------------------------------------------------
// GÜNLÜK RAPOR — "bugün" KİMİN bugünü?
//
// Rota date-fns startOfDay/endOfDay kullanıyordu: SUNUCUNUN yerel gününü keser.
// Railway UTC'de koşar; İstanbul UTC+3. Rezervasyon damgaları da tek biçim
// değil: iCal date-only satırları ÖĞLENE damgalanır (ics.ts "noon to avoid TZ
// edge cases"), Hospitable ISO'yu olduğu gibi yazar, yaşam döngüsü fixed-point
// yerel-geceyarısı kullanır. UTC gün penceresi bu damgaların hepsini aynı anda
// doğru KESEMEZ:
//
//   • öğlen-damgalı satır (12:00Z): İstanbul 00:00–03:00 arasında UTC hâlâ
//     DÜNDE → rapor dünün giriş/çıkışlarını "bugün" diye listeler, bugünü atlar.
//   • fixed-point satır (önceki gün 21:00Z): İstanbul gündüzünde UTC penceresi
//     o damgayı DIŞARIDA bırakır → bugünün girişi hiç görünmez.
//
// Doğru pencere org'un KENDİ günüdür: zonedDayRange(now, org.timezone).
// İki dilim de burada pinli — biri Codex'in 00:00–03:00 senaryosu, öbürü
// gündüz dilimi; eski kod ikisinde de kırmızı.
// ---------------------------------------------------------------------------

let orgId = "";

const req = () => new NextRequest("http://localhost/api/reports/daily");
const ctx = () => ({ params: Promise.resolve({}) }) as never;

async function seed() {
  await resetDb();
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "Europe/Istanbul" },
  });
  orgId = org.id;
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Owner", email: "o@x.com", passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire 1" },
  });
  session = {
    userId: user.id,
    organizationId: org.id,
    role: "owner",
    email: "o@x.com",
    name: "Owner",
    sessionEpoch: 0,
  };

  // İstanbul takvimiyle: 28 Temmuz "bugün" olacak şekilde kurgulanmış satırlar.
  const rows = [
    // iCal öğlen konvansiyonu (12:00Z) — üç güne bir tane.
    { guestName: "Dün Gelen", arrivalDate: "2026-07-27T12:00:00.000Z", departureDate: "2026-07-30T12:00:00.000Z" },
    { guestName: "Bugün Gelen", arrivalDate: "2026-07-28T12:00:00.000Z", departureDate: "2026-07-31T12:00:00.000Z" },
    { guestName: "Yarın Gelen", arrivalDate: "2026-07-29T12:00:00.000Z", departureDate: "2026-08-01T12:00:00.000Z" },
    // Fixed-point konvansiyonu: İstanbul 28 Tem 00:00 = 27 Tem 21:00Z.
    { guestName: "Bugün Gelen FP", arrivalDate: "2026-07-27T21:00:00.000Z", departureDate: "2026-07-30T21:00:00.000Z" },
    { guestName: "Bugün Çıkan FP", arrivalDate: "2026-07-24T21:00:00.000Z", departureDate: "2026-07-27T21:00:00.000Z" },
  ];
  for (const r of rows) {
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: r.guestName,
        arrivalDate: new Date(r.arrivalDate),
        departureDate: new Date(r.departureDate),
      },
    });
  }
}

async function arrivalsAt(nowIso: string): Promise<{ arrivals: string[]; departures: string[]; date: string }> {
  vi.setSystemTime(new Date(nowIso));
  const res = await dailyGET(req(), ctx());
  expect(res.status).toBe(200);
  const body = await res.json();
  return {
    arrivals: body.arrivals.map((a: { guestName: string }) => a.guestName).sort(),
    departures: body.departures.map((d: { guestName: string }) => d.guestName).sort(),
    date: body.date,
  };
}

describe("GET /api/reports/daily — org'un günü, sunucunun günü değil", () => {
  beforeEach(async () => {
    await seed();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("İstanbul 00:30'da (UTC hâlâ dünde) rapor BUGÜNÜ gösterir, dünü değil", async () => {
    // 27 Tem 21:30Z = İstanbul 28 Tem 00:30. Eski kod UTC 27 Tem penceresini
    // keser: "Dün Gelen"i (27 Tem 12:00Z) bugün sanır, "Bugün Gelen"i atlardı.
    const r = await arrivalsAt("2026-07-27T21:30:00.000Z");
    expect(r.arrivals).toEqual(["Bugün Gelen", "Bugün Gelen FP"]);
    expect(r.departures).toEqual(["Bugün Çıkan FP"]);
    // Pencerenin başı İstanbul geceyarısının UTC karşılığıdır.
    expect(r.date).toBe("2026-07-27T21:00:00.000Z");
  });

  it("İstanbul gündüzünde de aynı gün: fixed-point giriş kaybolmaz", async () => {
    // 28 Tem 11:00Z = İstanbul 14:00. Eski kod UTC 28 Tem penceresini keser:
    // fixed-point "Bugün Gelen FP" (27 Tem 21:00Z) pencere DIŞINDA kalırdı ve
    // "Bugün Çıkan FP" çıkışı da görünmezdi.
    const r = await arrivalsAt("2026-07-28T11:00:00.000Z");
    expect(r.arrivals).toEqual(["Bugün Gelen", "Bugün Gelen FP"]);
    expect(r.departures).toEqual(["Bugün Çıkan FP"]);
    expect(r.date).toBe("2026-07-27T21:00:00.000Z");
  });

  it("gün sınırının İKİ yakası: İstanbul 23:59 bugün, 00:01 yarın", async () => {
    const lateToday = await arrivalsAt("2026-07-28T20:59:00.000Z"); // İst 28 Tem 23:59
    expect(lateToday.arrivals).toEqual(["Bugün Gelen", "Bugün Gelen FP"]);
    const earlyTomorrow = await arrivalsAt("2026-07-28T21:01:00.000Z"); // İst 29 Tem 00:01
    expect(earlyTomorrow.arrivals).toEqual(["Yarın Gelen"]);
    expect(earlyTomorrow.date).toBe("2026-07-28T21:00:00.000Z");
  });

  it("başka dilimdeki org kendi gününü görür (Berlin)", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Berlin" } });
    // 27 Tem 22:30Z = Berlin 28 Tem 00:30 (CEST +02). Berlin'in 28 Tem'i
    // [27 Tem 22:00Z, 28 Tem 22:00Z) — öğlen damgalı "Bugün Gelen" içeride,
    // İstanbul fixed-point 21:00Z damgası Berlin gününe GİRMEZ (o artık 27 Tem).
    const r = await arrivalsAt("2026-07-27T22:30:00.000Z");
    expect(r.arrivals).toEqual(["Bugün Gelen"]);
    expect(r.date).toBe("2026-07-27T22:00:00.000Z");
  });
});
