import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { todayKey, addNights } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Giriş hazırlığı listesi — bir konaklamanın hükmü okunamazsa sayfa DÜŞMEZ: o satır "okunamadı" (bilinmiyor; asla yeşil değil) olur,
// hata raporlanır, diğer satırlar normal hesaplanır. Arıza taklidi ayrı dosyada (modül taklidi diğer testlere sızmasın).
// ---------------------------------------------------------------------------

const failFor = new Set<string>();
vi.mock("@/lib/early-checkin/load", async (orig) => {
  const actual = await orig<typeof import("@/lib/early-checkin/load")>();
  return {
    ...actual,
    loadEarlyCheckinFacts: vi.fn(async (args: Parameters<typeof actual.loadEarlyCheckinFacts>[0]) => {
      if (args.reservationId && failFor.has(args.reservationId)) throw new Error("db hiccup (test)");
      return actual.loadEarlyCheckinFacts(args);
    }),
  };
});
const reported = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async (ctx: string) => {
    reported.calls.push(ctx);
    return "reported";
  }),
}));

import { loadArrivalReadiness } from "@/lib/readiness-list/load";

const TZ = "Europe/Istanbul";
const TODAY = todayKey(new Date(), TZ);
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);

describe("giriş hazırlığı listesi — bir konaklamanın arızası", () => {
  beforeEach(async () => {
    await resetDb();
    failFor.clear();
    reported.calls.length = 0;
  });

  it("🚨 bir konaklamanın hükmü okunamazsa o satır BİLİNMİYOR + 'okunamadı'; diğer satır etkilenmez; hata raporlanır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const p2 = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 7" } })).id;
    const bad = await prisma.reservation.create({
      data: { propertyId, guestName: "Arızalı", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId: p2, guestName: "Sağlam", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    failFor.add(bad.id);
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    const byGuest = new Map(rows.map((r) => [r.guestName, r]));
    expect(rows).toHaveLength(2);
    const broken = byGuest.get("Arızalı")!;
    expect(broken.readiness.overall).toBe("unknown");
    expect(broken.readiness.factors.find((f) => f.key === "cleaning")).toMatchObject({ state: "unknown", label: "Temizlik durumu şu an okunamadı" });
    const ok = byGuest.get("Sağlam")!;
    expect(ok.readiness.factors.find((f) => f.key === "cleaning")!.label).not.toBe("Temizlik durumu şu an okunamadı");
    expect(reported.calls).toContain("readiness-list.stay");
  });
});
