import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/reservations/[id]/route";

// ---------------------------------------------------------------------------
// PATCH DURUM YAZIMI KOŞULLU (Opus O2 / O8, 10-15). Spy TEK testte kurulur ve dosyanın tek testidir (Prisma temsilcisindeki spy, geri
// alınsa da sonraki testi bozar — CLAUDE.md; emsal `paddle-webhook-k4-race.test.ts`).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/reservations/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) },
  );

async function seed(status: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  const r = await prisma.reservation.create({
    data: { propertyId, guestName: "Ayşe", sourceReference: null, channel: "ics", status, arrivalDate: new Date(Date.now() + 10 * DAY), departureDate: new Date(Date.now() + 13 * DAY) },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  return { orgId, propertyId, reservationId: r.id };
}

describe("PATCH durum yazımı yarışları", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 O2: okuma 'onaylı' → arada iptal → PATCH 409 (iptal kalır, denetim kaydı yok); O8: okuma 'iptal' → arada yeniden onay → PATCH iptali GEÇİŞTİR (başlanmış görev de silinir)", async () => {
    // Geçiş (`mockResolvedValueOnce` dışındaki çağrılar) GERÇEK fonksiyona — Prisma temsilcisinde spy'ın kendi geçişi bağlamı kaybediyor.
    const real = prisma.reservation.findFirst.bind(prisma.reservation);
    const stale = vi.spyOn(prisma.reservation, "findFirst").mockImplementation(((args: Parameters<typeof real>[0]) => real(args)) as never);
    // O2
    const a = await seed("cancelled");
    stale.mockResolvedValueOnce({ id: a.reservationId, status: "confirmed" } as never);
    const r1 = await patch(a.reservationId, { status: "confirmed", notes: "x" });
    expect(r1.status).toBe(409);
    expect((await r1.json()).code).toBe("stale");
    const rowA = await prisma.reservation.findUniqueOrThrow({ where: { id: a.reservationId } });
    expect([rowA.status, rowA.notes]).toEqual(["cancelled", null]);
    expect(await prisma.auditLog.count({ where: { organizationId: a.orgId, action: "reservation.reactivated" } })).toBe(0);
    // O8
    const b = await seed("confirmed");
    await prisma.task.create({ data: { propertyId: b.propertyId, reservationId: b.reservationId, type: "cleaning", origin: "system", title: "Çıkış temizliği", status: "in_progress" } });
    stale.mockResolvedValueOnce({ id: b.reservationId, status: "cancelled" } as never);
    expect((await patch(b.reservationId, { status: "cancelled" })).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: b.reservationId } })).status).toBe("cancelled");
    expect(await prisma.task.count({ where: { reservationId: b.reservationId, origin: "system" } })).toBe(0);
  });
});
