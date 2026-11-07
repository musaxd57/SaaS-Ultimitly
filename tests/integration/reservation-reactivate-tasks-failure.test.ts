import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import type { SessionPayload } from "@/lib/auth";

// H2 Haiku incelemesi: görev oluşturma hata verirse rezervasyon AÇILMIŞ kalır ve yanıt 200 olur (500 dönmek düğmeyi "zaten etkin" 409'una
// iterdi); arıza raporlanır. Ayrı dosya: `@/lib/automation` taklidi öteki testlere sızmasın.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/automation", () => ({ createReservationTasks: vi.fn().mockRejectedValue(new Error("db down")) }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { POST } from "@/app/api/reservations/[id]/reactivate/route";
import { reportError } from "@/lib/report-error";

describe("reactivate — görev oluşturma arızası yanıtı bozmaz", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("200 + rezervasyon onaylı + arıza raporlanır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "G",
        sourceReference: "res-f",
        arrivalDate: new Date(Date.now() + 5 * 86_400_000),
        departureDate: new Date(Date.now() + 8 * 86_400_000),
        status: "cancelled",
      },
    });
    await prisma.ingestEvent.create({
      data: {
        organizationId: orgId,
        provider: "hospitable",
        entityType: "reservation",
        entityId: r.id,
        kind: "reservation.updated",
        changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]),
      },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    const res = await POST(new NextRequest(`http://localhost/api/reservations/${r.id}/reactivate`, { method: "POST" }), {
      params: Promise.resolve({ id: r.id }),
    });
    expect(res.status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("confirmed");
    expect(vi.mocked(reportError)).toHaveBeenCalledWith("reservation-reactivate-tasks", expect.any(Error));
  });
});
