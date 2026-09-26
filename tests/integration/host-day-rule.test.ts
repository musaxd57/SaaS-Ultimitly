import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import React from "react";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EV SAHİBİ YÜZEYLERİNDE TEK TARİH KURALI (09-26). Rezervasyon tarihi "yalnız tarih" çapası (D 00:00Z / D 12:00Z) ya da
// gerçek an olarak saklanır; "bugün mü, geçti mi" kararı `calendarDateOf` ile verilir. Eski kıyas ham `tarih >= org gün
// başı` idi: İstanbul'da doğru (pinli: birebir aynı), ama
//   · New York'ta BUGÜN giriş yapan / çıkan konaklama "dün" sayılıyordu → aynı gün yapılan rezervasyona giriş hazırlığı,
//     bugün çıkana temizlik görevi açılmıyor, "Eksik görevleri oluştur" düğmesi de görünmüyordu;
//   · Auckland'da dünün 12:00Z değeri "bugün" sayılıyordu → geçmiş girişe hazırlık görevi açılıyordu.
// Görev oluşturma ile düğmedeki sayı AYNI kararı verir (her dilimde değişmez olarak pinli).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, requireAuth: vi.fn(async () => session) };
});
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { createReservationTasks, backfillReservationTasks } from "@/lib/automation";
import TasksPage from "@/app/(app)/tasks/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import { GET as dailyGET } from "@/app/api/reports/daily/route";
import { NextRequest } from "next/server";
import { getOpsStats } from "@/lib/reports";
import { BackfillTasksButton } from "@/components/tasks/backfill-button";
import { zonedDayRange } from "@/lib/timezone";
import { treeText } from "../helpers/tree-text";

const NY = "America/New_York";
const AKL = "Pacific/Auckland";
const IST = "Europe/Istanbul";

beforeEach(resetDb);
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.$disconnect();
});

/** Saat YALNIZ `Date` için dondurulur (Prisma'nın zamanlayıcıları gerçek kalır). */
function freeze(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

async function orgIn(timezone: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { timezone } });
  return { orgId, propertyId };
}

function stay(propertyId: string, arrival: string, departure: string, status = "confirmed", guestName = "Deneme Misafir") {
  return prisma.reservation.create({
    data: { propertyId, guestName, arrivalDate: new Date(arrival), departureDate: new Date(departure), status },
  });
}

async function taskTypes(reservationId: string): Promise<string[]> {
  const rows = await prisma.task.findMany({ where: { reservationId }, select: { type: true } });
  return rows.map((t) => t.type).sort();
}

/** Sayfa ağacında "Eksik görevleri oluştur" düğmesinin sayısı; düğme yoksa null. */
function backfillCount(root: unknown): number | null {
  let found: number | null = null;
  const walk = (node: unknown): void => {
    if (found !== null || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const el = node as React.ReactElement<Record<string, unknown>>;
      if (el.type === BackfillTasksButton) {
        found = Number(el.props.count);
        return;
      }
      for (const v of Object.values(el.props ?? {})) walk(v);
    }
  };
  walk(root);
  return found;
}

function asOwner(orgId: string) {
  session = { userId: "owner-" + orgId, organizationId: orgId, role: "owner", email: "o@x.com", name: "Sahip", sessionEpoch: 0 };
}

async function pageCount(orgId: string): Promise<number | null> {
  asOwner(orgId);
  return backfillCount(await TasksPage({ searchParams: Promise.resolve({}) }));
}

/** Pano fikstürü: her konaklama AYRI dairede (çakışma kartı ad basmasın); bugün / yarın giriş-çıkış + bugün / yarın görev. */
async function dashboardFixture(timezone: string, days: { today: string; tomorrow: string }) {
  const { orgId, propertyId } = await orgIn(timezone);
  const flat = async (name: string) => (await prisma.property.create({ data: { organizationId: orgId, name } })).id;
  const at = (day: string) => `${day}T00:00:00.000Z`;
  const later = "2026-10-05T00:00:00.000Z";
  const earlier = "2026-09-20T00:00:00.000Z";
  await stay(await flat("Daire 1"), at(days.today), later, "confirmed", "Bugun Gelen");
  await stay(await flat("Daire 2"), at(days.tomorrow), later, "confirmed", "Yarin Gelen");
  await stay(await flat("Daire 3"), earlier, at(days.today), "confirmed", "Bugun Cikan");
  await stay(await flat("Daire 4"), earlier, at(days.tomorrow), "confirmed", "Yarin Cikan");
  await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Bugunun Isi", dueAt: new Date(at(days.today)) } });
  await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Yarinin Isi", dueAt: new Date(at(days.tomorrow)) } });
  return orgId;
}

describe("createReservationTasks — org gününe göre BUGÜN (tek tarih kuralı)", () => {
  it("🚨 New York: aynı gün yapılan rezervasyon (bugünün 00:00Z çapası) giriş hazırlığı DA alır", async () => {
    freeze("2026-09-26T15:00:00Z"); // New York 26 Eylül 11:00 (gün başı 04:00Z)
    const { propertyId } = await orgIn(NY);
    const r = await stay(propertyId, "2026-09-26T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
    expect(await createReservationTasks(r.id)).toBe(2);
    expect(await taskTypes(r.id)).toEqual(["checkin_prep", "cleaning"]);
  });

  it("🚨 New York: BUGÜN çıkan konaklama (bugünün 00:00Z çapası) çıkış temizliği alır", async () => {
    freeze("2026-09-26T15:00:00Z");
    const { propertyId } = await orgIn(NY);
    const r = await stay(propertyId, "2026-09-23T00:00:00.000Z", "2026-09-26T00:00:00.000Z");
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(await taskTypes(r.id)).toEqual(["cleaning"]);
  });

  it("New York: dünün çapası ve dün akşamki gerçek an GEÇMİŞ; bu sabahki gerçek an BUGÜN (eskisiyle aynı)", async () => {
    freeze("2026-09-26T15:00:00Z");
    const { propertyId } = await orgIn(NY);
    const yesterdayNoon = await stay(propertyId, "2026-09-22T00:00:00.000Z", "2026-09-25T12:00:00.000Z");
    const yesterdayEvening = await stay(propertyId, "2026-09-22T00:00:00.000Z", "2026-09-26T02:00:00.000Z"); // NY 25 Eylül 22:00
    const thisMorning = await stay(propertyId, "2026-09-22T00:00:00.000Z", "2026-09-26T05:30:00.000Z"); // NY 26 Eylül 01:30
    expect(await createReservationTasks(yesterdayNoon.id)).toBe(0);
    expect(await createReservationTasks(yesterdayEvening.id)).toBe(0);
    expect(await createReservationTasks(thisMorning.id)).toBe(1);
  });

  it("🚨 Auckland (UTC+12): dünün 12:00Z çapası 'bugün' SAYILMAZ — geçmiş girişe hazırlık görevi açılmaz", async () => {
    freeze("2026-09-26T03:00:00Z"); // Auckland 26 Eylül 15:00 (NZST, gün başı 25 Eylül 12:00Z)
    const { propertyId } = await orgIn(AKL);
    const past = await stay(propertyId, "2026-09-25T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    expect(await createReservationTasks(past.id)).toBe(1);
    expect(await taskTypes(past.id)).toEqual(["cleaning"]);
    const today = await stay(propertyId, "2026-09-26T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    expect(await taskTypes(today.id)).toEqual([]);
    expect(await createReservationTasks(today.id)).toBe(2);
  });

  it("İstanbul: eski kuralla BİREBİR (aynı değerler, aynı görevler)", async () => {
    freeze("2026-09-26T15:00:00Z"); // İstanbul 26 Eylül 18:00 (gün başı 25 Eylül 21:00Z)
    const { propertyId } = await orgIn(IST);
    const values = [
      "2026-09-25T00:00:00.000Z",
      "2026-09-25T12:00:00.000Z",
      "2026-09-25T20:59:59.999Z", // İstanbul 25 Eylül 23:59:59.999
      "2026-09-25T21:00:00.000Z", // İstanbul 26 Eylül 00:00
      "2026-09-26T00:00:00.000Z",
      "2026-09-26T12:00:00.000Z",
      "2026-09-26T20:59:59.999Z",
      "2026-09-26T21:00:00.000Z",
    ];
    const oldRule = (v: string) => new Date(v) >= zonedDayRange(new Date(), IST).start;
    expect(values.map(oldRule)).toEqual([false, false, false, true, true, true, true, true]); // boş iddia değil
    for (const v of values) {
      const r = await stay(propertyId, v, "2026-10-01T00:00:00.000Z");
      await createReservationTasks(r.id);
      expect((await taskTypes(r.id)).includes("checkin_prep"), v).toBe(oldRule(v));
    }
  });
});

describe("Pano — 'Bugünkü Girişler / Çıkışlar / Görevler' ve durum kartları org gününe göre BUGÜN", () => {
  it("🚨 New York: bugünün girişi/çıkışı/görevi listede; YARININKİ listede DEĞİL (eskisi tam tersini gösteriyordu)", async () => {
    freeze("2026-09-26T15:00:00Z");
    const orgId = await dashboardFixture(NY, { today: "2026-09-26", tomorrow: "2026-09-27" });
    asOwner(orgId);
    const text = treeText(await DashboardPage());
    for (const shown of ["Bugun Gelen", "Bugun Cikan", "Bugunun Isi"]) expect(text, shown).toContain(shown);
    for (const hidden of ["Yarin Gelen", "Yarin Cikan", "Yarinin Isi"]) expect(text, hidden).not.toContain(hidden);
    const stats = await getOpsStats(orgId);
    expect({ arrivals: stats.arrivalsToday, departures: stats.departuresToday }).toEqual({ arrivals: 1, departures: 1 });
  });

  it("İstanbul: aynı fikstür aynı sonucu verir (eskisiyle birebir)", async () => {
    freeze("2026-09-26T15:00:00Z");
    const orgId = await dashboardFixture(IST, { today: "2026-09-26", tomorrow: "2026-09-27" });
    asOwner(orgId);
    const text = treeText(await DashboardPage());
    for (const shown of ["Bugun Gelen", "Bugun Cikan", "Bugunun Isi"]) expect(text, shown).toContain(shown);
    for (const hidden of ["Yarin Gelen", "Yarin Cikan", "Yarinin Isi"]) expect(text, hidden).not.toContain(hidden);
    const stats = await getOpsStats(orgId);
    expect({ arrivals: stats.arrivalsToday, departures: stats.departuresToday }).toEqual({ arrivals: 1, departures: 1 });
  });

  it("🚨 New York: günlük rapor listeleri kartlarla AYNI küme; 'date' sözleşmesi (org gece yarısı) değişmedi", async () => {
    freeze("2026-09-26T15:00:00Z");
    const orgId = await dashboardFixture(NY, { today: "2026-09-26", tomorrow: "2026-09-27" });
    asOwner(orgId);
    const res = await dailyGET(new NextRequest("http://localhost/api/reports/daily"), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.arrivals.map((a: { guestName: string }) => a.guestName)).toEqual(["Bugun Gelen"]);
    expect(body.departures.map((d: { guestName: string }) => d.guestName)).toEqual(["Bugun Cikan"]);
    expect({ a: body.stats.arrivalsToday, d: body.stats.departuresToday }).toEqual({ a: 1, d: 1 });
    expect(body.date).toBe("2026-09-26T04:00:00.000Z"); // New York 26 Eylül 00:00 (EDT)
  });

  it("🚨 Auckland (UTC+12): DÜNÜN 12:00Z girişi bugünün listesinde DEĞİL", async () => {
    freeze("2026-09-26T03:00:00Z"); // NZST 26 Eylül 15:00
    const { orgId } = await orgIn(AKL);
    const flat = (await prisma.property.create({ data: { organizationId: orgId, name: "Daire 9" } })).id;
    await stay(flat, "2026-09-25T12:00:00.000Z", "2026-09-28T12:00:00.000Z", "confirmed", "Dun Gelen");
    asOwner(orgId);
    expect(treeText(await DashboardPage())).not.toContain("Dun Gelen");
    expect((await getOpsStats(orgId)).arrivalsToday).toBe(0);
  });
});

describe("Görevler sayfası — 'Eksik görevleri oluştur' sayısı görev oluşturma ile AYNI kural", () => {
  it("🚨 New York: bugün çıkan, temizlik görevi olmayan konaklama sayılır; oluşturunca düğme kalkar", async () => {
    freeze("2026-09-26T15:00:00Z");
    const { orgId, propertyId } = await orgIn(NY);
    await stay(propertyId, "2026-09-23T00:00:00.000Z", "2026-09-26T00:00:00.000Z"); // bugün çıkıyor → sayılır
    await stay(propertyId, "2026-09-23T00:00:00.000Z", "2026-09-26T00:00:00.000Z", "cancelled"); // iptal → sayılmaz
    await stay(propertyId, "2026-09-20T00:00:00.000Z", "2026-09-25T00:00:00.000Z"); // dün çıktı → sayılmaz
    const withTask = await stay(propertyId, "2026-09-27T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
    await prisma.task.create({ data: { propertyId, reservationId: withTask.id, type: "cleaning", title: "Elle temizlik", dueAt: withTask.departureDate } });

    expect(await pageCount(orgId)).toBe(1);
    await backfillReservationTasks(orgId);
    expect(await pageCount(orgId)).toBeNull();
  });

  it("her dilimde düğmedeki sayı = tıklayınca açılan temizlik görevi sayısı (değişmez)", async () => {
    freeze("2026-09-26T15:00:00Z");
    const zones = [NY, AKL, IST, "Pacific/Kiritimati", "Pacific/Honolulu", "UTC", "Asia/Tokyo"];
    const departures: string[] = [];
    for (let day = 24; day <= 28; day++) {
      const d = `2026-09-${day}`;
      departures.push(`${d}T00:00:00.000Z`, `${d}T12:00:00.000Z`);
      for (let h = 1; h < 24; h += 3) departures.push(`${d}T${String(h).padStart(2, "0")}:30:00.000Z`);
    }
    for (const tz of zones) {
      const { orgId, propertyId } = await orgIn(tz);
      await prisma.reservation.createMany({
        data: departures.map((dep) => ({
          propertyId,
          guestName: "Deneme Misafir",
          arrivalDate: new Date(new Date(dep).getTime() - 2 * 86_400_000),
          departureDate: new Date(dep),
          status: "confirmed",
        })),
      });
      const shown = (await pageCount(orgId)) ?? 0;
      await backfillReservationTasks(orgId);
      const created = await prisma.task.count({ where: { type: "cleaning", property: { organizationId: orgId } } });
      expect(shown, tz).toBe(created);
      expect(created, tz).toBeGreaterThan(0);
      expect(created, tz).toBeLessThan(departures.length);
    }
  });
});
