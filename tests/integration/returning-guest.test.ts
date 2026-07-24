import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { getReturningGuestInfo } from "@/lib/returning-guest";

async function stay(
  propertyId: string,
  over: Partial<{ guestExternalId: string | null; status: string; arrivalDate: Date; departureDate: Date }> = {},
) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: over.arrivalDate ?? daysFromNow(-5),
      departureDate: over.departureDate ?? daysFromNow(-2),
      status: over.status ?? "completed",
      channel: "airbnb",
      guestExternalId: "guestExternalId" in over ? over.guestExternalId : null,
    },
  });
}

describe("getReturningGuestInfo (stable guest id only — no false positives)", () => {
  beforeEach(resetDb);

  it("counts prior non-cancelled stays sharing the guest id, excluding the current one", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, { guestExternalId: "g1", arrivalDate: daysFromNow(-30), departureDate: daysFromNow(-27) });
    await stay(propertyId, { guestExternalId: "g1", arrivalDate: daysFromNow(-10), departureDate: daysFromNow(-7) });
    const current = await stay(propertyId, {
      guestExternalId: "g1",
      status: "confirmed",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
    });

    const info = await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "g1" });
    expect(info).not.toBeNull();
    expect(info!.stayCount).toBe(3);
    expect(info!.pastStays).toHaveLength(2);
    expect(info!.pastStays.some((s) => s.id === current.id)).toBe(false);
  });

  it("returns null when the current reservation has no guest id (manual/iCal/old rows)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const current = await stay(propertyId, { guestExternalId: null });
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: null })).toBeNull();
  });

  it("returns null for a first-time guest (no other stay shares the id)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const current = await stay(propertyId, { guestExternalId: "solo" });
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "solo" })).toBeNull();
  });

  it("excludes cancelled prior stays", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, { guestExternalId: "g2", status: "cancelled" });
    const current = await stay(propertyId, { guestExternalId: "g2", status: "confirmed" });
    // The only other stay is cancelled → not counted → first-timer → null.
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "g2" })).toBeNull();
  });

  it("NEVER matches across organizations (tenant isolation)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await stay(b.propertyId, { guestExternalId: "shared" }); // another tenant's guest with the SAME id
    const current = await stay(a.propertyId, { guestExternalId: "shared" });
    expect(await getReturningGuestInfo(a.orgId, { id: current.id, guestExternalId: "shared" })).toBeNull();
  });
});
