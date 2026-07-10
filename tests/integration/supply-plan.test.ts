import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { getPrepPlan } from "@/lib/supply";

// now = 2026-07-10 12:00 Istanbul (09:00 UTC). Istanbul day window for a 7-day
// plan: [2026-07-10 .. 2026-07-16] inclusive.
const NOW = new Date("2026-07-10T09:00:00.000Z");

async function makeProperty(orgId: string, name: string, profile: Record<string, number> | null) {
  return prisma.property.create({
    data: {
      organizationId: orgId,
      name,
      supplyProfileJson: profile ? JSON.stringify(profile) : null,
    },
  });
}

async function arrival(propertyId: string, arrivalDate: string, status = "confirmed") {
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Guest",
      arrivalDate: new Date(arrivalDate),
      departureDate: new Date(new Date(arrivalDate).getTime() + 2 * 24 * 3600_000),
      status,
    },
  });
}

describe("getPrepPlan", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
  });

  it("multiplies arrivals in range by the per-property profile and aggregates", async () => {
    const a = await makeProperty(orgId, "nuve 1", { carsaf_takimi: 2, cop_poseti: 1 });
    const b = await makeProperty(orgId, "nuve 2", { carsaf_takimi: 1, cop_poseti: 3 });
    await arrival(a.id, "2026-07-11T00:00:00.000Z"); // in range
    await arrival(a.id, "2026-07-14T00:00:00.000Z"); // in range → a has 2 arrivals
    await arrival(b.id, "2026-07-12T00:00:00.000Z"); // in range → b has 1 arrival

    const plan = await getPrepPlan(orgId, { days: 7, now: NOW });

    expect(plan.totalArrivals).toBe(3);
    // carsaf: a(2×2)=4 + b(1×1)=1 = 5 ; cop: a(2×1)=2 + b(1×3)=3 = 5
    const linen = Object.fromEntries(plan.linen.map((i) => [i.key, i.qty]));
    const cons = Object.fromEntries(plan.consumables.map((i) => [i.key, i.qty]));
    expect(linen.carsaf_takimi).toBe(5);
    expect(cons.cop_poseti).toBe(5);
    expect(plan.perProperty).toHaveLength(2);
  });

  it("excludes cancelled bookings and arrivals outside the window", async () => {
    const a = await makeProperty(orgId, "nuve 1", { carsaf_takimi: 2 });
    await arrival(a.id, "2026-07-11T00:00:00.000Z", "confirmed"); // counts
    await arrival(a.id, "2026-07-12T00:00:00.000Z", "cancelled"); // excluded (status)
    await arrival(a.id, "2026-07-01T00:00:00.000Z"); // excluded (before window)
    await arrival(a.id, "2026-07-25T00:00:00.000Z"); // excluded (after window)

    const plan = await getPrepPlan(orgId, { days: 7, now: NOW });
    expect(plan.totalArrivals).toBe(1);
    expect(plan.linen.find((i) => i.key === "carsaf_takimi")?.qty).toBe(2);
  });

  it("nudges properties that have arrivals but no profile (not counted)", async () => {
    const a = await makeProperty(orgId, "nuve 1", { carsaf_takimi: 2 });
    const b = await makeProperty(orgId, "profilsiz daire", null);
    await arrival(a.id, "2026-07-11T00:00:00.000Z");
    await arrival(b.id, "2026-07-11T00:00:00.000Z");

    const plan = await getPrepPlan(orgId, { days: 7, now: NOW });
    expect(plan.totalArrivals).toBe(2); // both arrivals counted in the headline
    expect(plan.missingProfile).toContain("profilsiz daire");
    expect(plan.perProperty.map((p) => p.propertyName)).toEqual(["nuve 1"]); // only the profiled one
  });

  it("respects the day-window size (1 vs 7 days)", async () => {
    const a = await makeProperty(orgId, "nuve 1", { carsaf_takimi: 1 });
    await arrival(a.id, "2026-07-10T06:00:00.000Z"); // today (Istanbul)
    await arrival(a.id, "2026-07-13T00:00:00.000Z"); // +3 days

    expect((await getPrepPlan(orgId, { days: 1, now: NOW })).totalArrivals).toBe(1);
    expect((await getPrepPlan(orgId, { days: 7, now: NOW })).totalArrivals).toBe(2);
  });

  it("returns an empty plan when there are no arrivals", async () => {
    await makeProperty(orgId, "nuve 1", { carsaf_takimi: 2 });
    const plan = await getPrepPlan(orgId, { days: 7, now: NOW });
    expect(plan.totalArrivals).toBe(0);
    expect(plan.linen).toHaveLength(0);
    expect(plan.consumables).toHaveLength(0);
  });
});
