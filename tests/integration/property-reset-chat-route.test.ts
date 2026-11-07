import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/[id]/reset-chat/route";

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/properties/${id}/reset-chat`, { method: "POST" });
  return POST(req, { params: Promise.resolve({ id }) });
}

async function boundReservation(propertyId: string) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "A",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      chatBoundHash: "a".repeat(64),
      chatBoundAt: new Date(),
    },
  });
}

describe("POST /api/properties/[id]/reset-chat (per-stay binding reset)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("clears the binding so the next device can re-claim the stay", async () => {
    const r = await boundReservation(propertyId);
    const res = await call(propertyId);
    expect(res.status).toBe(200);
    expect((await res.json()).reset).toBe(1);
    const after = await prisma.reservation.findUnique({ where: { id: r.id } });
    expect(after?.chatBoundHash).toBeNull();
    expect(after?.chatBoundAt).toBeNull();
  });

  it("403 for a staff member (owner/manager only)", async () => {
    await boundReservation(propertyId);
    session = { ...(session as SessionPayload), role: "staff" };
    expect((await call(propertyId)).status).toBe(403);
  });

  it("is IDOR-safe: another org's property is untouched (403)", async () => {
    const other = await makeOrgWithProperty();
    const r = await boundReservation(other.propertyId);
    // Our session (orgId) tries to reset the OTHER org's property.
    const res = await call(other.propertyId);
    expect(res.status).toBe(403);
    const after = await prisma.reservation.findUnique({ where: { id: r.id } });
    expect(after?.chatBoundHash).not.toBeNull(); // untouched
  });
});
