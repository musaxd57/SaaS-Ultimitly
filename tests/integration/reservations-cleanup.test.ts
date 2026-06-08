import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Mock the Hospitable client so the cleanup runs against fixed "current" data.
vi.mock("@/lib/hospitable", () => ({ listReservations: vi.fn() }));

// The org is "connected" — return a fixed token so cleanup runs (multi-tenant).
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { listReservations } from "@/lib/hospitable";
import { cleanupStaleReservations } from "@/lib/reservations-cleanup";

const mockList = vi.mocked(listReservations);

async function makeOrgProp(hospitableId: string | null) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "P", hospitableId },
  });
  return { orgId: org.id, propertyId: property.id };
}

async function makeRes(propertyId: string, sourceRef: string, arrival: Date) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "G",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 86_400_000),
      channel: "airbnb",
      status: "confirmed",
      currency: "EUR",
      sourceReference: sourceRef,
    },
    select: { id: true },
  });
}

describe("cleanupStaleReservations", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("removes a ghost Hospitable no longer has, keeps the valid one", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    const today = new Date();
    const valid = await makeRes(propertyId, "res-valid", today);
    const ghost = await makeRes(propertyId, "res-ghost", today);

    // Hospitable currently only knows res-valid (res-ghost was re-issued/moved).
    mockList.mockResolvedValue([{ id: "res-valid" }]);

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 1, checkedProperties: 1 });
    expect(await prisma.reservation.findUnique({ where: { id: valid.id } })).not.toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: ghost.id } })).toBeNull();
  });

  it("never prunes when the fetch returns EMPTY (unverifiable)", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    await makeRes(propertyId, "res-1", new Date());
    mockList.mockResolvedValue([]);

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, skippedProperties: 1 });
    expect(await prisma.reservation.count()).toBe(1);
  });

  it("never prunes when the fetch THROWS (rate limit etc.)", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    await makeRes(propertyId, "res-1", new Date());
    mockList.mockRejectedValue(new Error("rate limit"));

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, skippedProperties: 1 });
    expect(await prisma.reservation.count()).toBe(1);
  });

  it("leaves out-of-window reservations alone even if absent from the result", async () => {
    const { orgId, propertyId } = await makeOrgProp("hosp-1");
    const farFuture = new Date(Date.now() + 600 * 86_400_000); // beyond the +540d window
    const future = await makeRes(propertyId, "res-far", farFuture);
    mockList.mockResolvedValue([{ id: "res-other" }]); // does NOT include res-far

    const out = await cleanupStaleReservations(orgId);

    expect(out.removed).toBe(0); // out of window → not eligible for pruning
    expect(await prisma.reservation.findUnique({ where: { id: future.id } })).not.toBeNull();
  });

  it("ignores properties with no hospitableId", async () => {
    const { orgId, propertyId } = await makeOrgProp(null);
    await makeRes(propertyId, "res-1", new Date());

    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, checkedProperties: 0, skippedProperties: 0 });
    expect(mockList).not.toHaveBeenCalled();
    expect(await prisma.reservation.count()).toBe(1);
  });
});
