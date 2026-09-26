import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { treeText } from "../helpers/tree-text";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EV SAHİBİ RAPORLARINDA TEK TARİH KURALI (166b-2, 09-26). Rezervasyon / vade tarihi "yalnız tarih" çapası (D 00:00Z /
// D 12:00Z) ya da gerçek an; "hangi gün" kararı `calendarDateOf`. Eski ham an kıyasları İstanbul'da doğruydu (pinli:
// birebir aynı); New York'ta bir gün kayıyordu:
//   · bu gece doluluk: yarın ÇIKAN sayılmıyor, yarın GELEN sayılıyordu;
//   · aylık doluluk: ay başındaki konaklama bir gece EKSİK;
//   · performans puanı: BUGÜN vadeli görev "vadesi geçmiş" sayılıp puanı düşürüyordu;
//   · İptaller "Bugün / Bu hafta": bugünün girişi dışarıda, ertesi günün girişi içeride;
//   · tedarik ufku: bugünün girişi dışarıda, ufkun ertesi günü içeride.
// Auckland'da ayın son gününün 12:00Z girişi aylık sorgunun DIŞINDA kalıyordu (pencere artık bir gün pay bırakır).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, requireAuth: vi.fn(async () => session) };
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

import { getOpsStats, getOccupancyByProperty, getHostPerformanceScore } from "@/lib/reports";
import { getPrepPlan } from "@/lib/supply";
import CancellationsPage from "@/app/(app)/cancellations/page";

const NY = "America/New_York";
const IST = "Europe/Istanbul";
const AKL = "Pacific/Auckland";
const NOW = "2026-09-26T15:00:00Z"; // New York 26 Eylül (Cumartesi) 11:00 · İstanbul 18:00

beforeEach(resetDb);
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.$disconnect();
});

function freeze(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

async function orgWithFlat(timezone: string) {
  const org = await prisma.organization.create({ data: { name: "Rapor Org", timezone } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire R" } });
  session = { userId: "owner-" + org.id, organizationId: org.id, role: "owner", email: "o@x.com", name: "Sahip", sessionEpoch: 0 };
  return { orgId: org.id, propertyId: property.id };
}

function stay(propertyId: string, arrival: string, departure: string, status = "confirmed", guestName = "Deneme Misafir") {
  return prisma.reservation.create({
    data: { propertyId, guestName, arrivalDate: new Date(arrival), departureDate: new Date(departure), status },
  });
}

describe("bu gece doluluk (getOpsStats.occupiedToday) — gece-katı, iki kenar da tek tarih kuralıyla", () => {
  for (const tz of [NY, IST]) {
    it(`${tz === NY ? "🚨 " : ""}${tz}: YARIN çıkan bu gece dolu; YARIN gelen bu gece dolu DEĞİL`, async () => {
      freeze(NOW);
      const leavesTomorrow = await orgWithFlat(tz);
      await stay(leavesTomorrow.propertyId, "2026-09-24T00:00:00.000Z", "2026-09-27T00:00:00.000Z");
      expect((await getOpsStats(leavesTomorrow.orgId)).occupiedToday).toBe(1);

      const arrivesTomorrow = await orgWithFlat(tz);
      await stay(arrivesTomorrow.propertyId, "2026-09-27T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
      expect((await getOpsStats(arrivesTomorrow.orgId)).occupiedToday).toBe(0);

      const leftToday = await orgWithFlat(tz); // bugün çıktı, yerine kimse yok → dolu DEĞİL (gece-katı kararı)
      await stay(leftToday.propertyId, "2026-09-23T00:00:00.000Z", "2026-09-26T00:00:00.000Z");
      expect((await getOpsStats(leftToday.orgId)).occupiedToday).toBe(0);
    });
  }
});

describe("aylık doluluk (getOccupancyByProperty) — geceler tek tarih kuralıyla", () => {
  for (const tz of [NY, IST]) {
    it(`${tz === NY ? "🚨 " : ""}${tz}: 1–3 Eylül konaklaması İKİ gece (1 ve 2 Eylül)`, async () => {
      freeze(NOW);
      const { orgId, propertyId } = await orgWithFlat(tz);
      await stay(propertyId, "2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z");
      const [row] = await getOccupancyByProperty(orgId);
      expect(row.thisMonthRate).toBe(Math.round((2 / 26) * 100)); // 26 Eylül'e kadar 26 gece
    });
  }

  for (const tz of [NY, IST]) {
    it(`${tz}: önceki aydan taşan konaklama (29 Ağu–3 Eyl) bu ay YALNIZ kendi gecelerini sayar (1 ve 2 Eylül)`, async () => {
      freeze(NOW);
      const { orgId, propertyId } = await orgWithFlat(tz);
      await stay(propertyId, "2026-08-29T00:00:00.000Z", "2026-09-03T00:00:00.000Z");
      const [row] = await getOccupancyByProperty(orgId);
      expect(row.thisMonthRate).toBe(Math.round((2 / 26) * 100));
    });
  }

  it("🚨 Auckland: ayın SON günü 12:00Z girişi o geceyi doldurur (sorgu penceresi bir gün pay bırakır)", async () => {
    freeze("2026-09-30T02:00:00Z"); // Auckland 30 Eylül 15:00 (NZDT)
    const { orgId, propertyId } = await orgWithFlat(AKL);
    await stay(propertyId, "2026-09-30T12:00:00.000Z", "2026-10-02T12:00:00.000Z");
    const [row] = await getOccupancyByProperty(orgId);
    expect(row.thisMonthRate).toBe(Math.round((1 / 30) * 100));
  });
});

describe("performans puanı — görev tamamlama yalnız BUGÜNDEN ÖNCE vadesi gelenler", () => {
  for (const tz of [NY, IST]) {
    it(`${tz === NY ? "🚨 " : ""}${tz}: bugün vadeli (açık) görev 'geçmiş' sayılmaz → %100`, async () => {
      freeze(NOW);
      const { orgId, propertyId } = await orgWithFlat(tz);
      await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Dun", status: "done", dueAt: new Date("2026-09-25T00:00:00.000Z") } });
      await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Bugun", status: "todo", dueAt: new Date("2026-09-26T00:00:00.000Z") } });
      expect((await getHostPerformanceScore(orgId)).breakdown.taskCompletionRate).toBe(100);
    });
  }

  it("ayın 1'inde pencere boş → ölçülmedi (null), eskisi gibi", async () => {
    freeze("2026-10-01T15:00:00Z");
    const { orgId, propertyId } = await orgWithFlat(NY);
    await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Bugun", status: "todo", dueAt: new Date("2026-10-01T00:00:00.000Z") } });
    expect((await getHostPerformanceScore(orgId)).breakdown.taskCompletionRate).toBeNull();
  });
});

describe("İptaller — 'Bugün' ve 'Bu hafta' giriş gününe göre", () => {
  async function page(period: string) {
    return treeText(await CancellationsPage({ searchParams: Promise.resolve({ period }) }));
  }

  for (const tz of [NY, IST]) {
    it(`${tz === NY ? "🚨 " : ""}${tz}: Bugün = bugünün girişi (yarınınki değil); Bu hafta = pazartesi…pazar`, async () => {
      freeze(NOW); // 26 Eylül Cumartesi → hafta 21–27 Eylül
      const { propertyId } = await orgWithFlat(tz);
      // Adlar birbirinin alt dizisi OLMAMALI ("Iptal Pazar" ⊂ "Iptal Pazartesi" iddiayı boşa çıkarıyordu — mutasyon R10).
      await stay(propertyId, "2026-09-26T00:00:00.000Z", "2026-09-29T00:00:00.000Z", "cancelled", "Iptal Bugun");
      await stay(propertyId, "2026-09-27T00:00:00.000Z", "2026-09-29T00:00:00.000Z", "cancelled", "Iptal Yarin");
      await stay(propertyId, "2026-09-21T00:00:00.000Z", "2026-09-23T00:00:00.000Z", "cancelled", "Iptal HaftaBasi");
      await stay(propertyId, "2026-09-20T00:00:00.000Z", "2026-09-23T00:00:00.000Z", "cancelled", "Iptal OncekiHafta");
      await stay(propertyId, "2026-09-28T00:00:00.000Z", "2026-09-30T00:00:00.000Z", "cancelled", "Iptal SonrakiHafta");

      const day = await page("day");
      expect(day).toContain("Iptal Bugun");
      expect(day).not.toContain("Iptal Yarin");

      const week = await page("week");
      for (const name of ["Iptal Bugun", "Iptal Yarin", "Iptal HaftaBasi"]) expect(week, name).toContain(name);
      for (const name of ["Iptal OncekiHafta", "Iptal SonrakiHafta"]) expect(week, name).not.toContain(name);
    });
  }
});

describe("tedarik ufku (getPrepPlan) — bugün … bugün+gün-1", () => {
  for (const tz of [NY, IST]) {
    it(`${tz === NY ? "🚨 " : ""}${tz}: 1 günlük ufuk bugünün girişini sayar, yarınınkini saymaz`, async () => {
      const now = new Date(NOW);
      const today = await orgWithFlat(tz);
      await stay(today.propertyId, "2026-09-26T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
      expect((await getPrepPlan(today.orgId, { days: 1, now })).totalArrivals).toBe(1);

      const tomorrow = await orgWithFlat(tz);
      await stay(tomorrow.propertyId, "2026-09-27T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
      expect((await getPrepPlan(tomorrow.orgId, { days: 1, now })).totalArrivals).toBe(0);
    });
  }
});
