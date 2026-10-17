import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Gece-4 S6-05: rezervasyon SİLİNİRKEN açık sistem yaşam döngüsü görevleri de gider (iptalle aynı küme). `Task.reservationId` SetNull →
// eskiden "Çıkış temizliği - <ad>" bağsız kalıp temizlikçi listesinde duruyordu. Bitmiş / elle açılmış görev kalır; başka kiracı silemez.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { DELETE as deleteReservation } from "@/app/api/reservations/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (id: string) =>
  deleteReservation(new NextRequest(`http://localhost/api/reservations/${id}`, { method: "DELETE" }), ctx(id));

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const made = await makeOrgWithProperty();
  orgId = made.orgId;
  propertyId = made.propertyId;
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterAll(async () => {
  await prisma.$disconnect();
});

const seedReservation = () =>
  prisma.reservation.create({
    data: { propertyId, guestName: "Ada", arrivalDate: daysFromNow(2), departureDate: daysFromNow(5), status: "confirmed", channel: "manual" },
    select: { id: true },
  });
const seedTask = (reservationId: string, o: { type: string; origin: string; status: string }) =>
  prisma.task.create({ data: { propertyId, reservationId, dueAt: daysFromNow(5), title: `${o.type} ${o.origin} ${o.status}`, ...o }, select: { id: true } });

describe("DELETE /api/reservations/[id] — açık otomatik görevler de gider (gece-4 S6-05)", () => {
  it("🚨 açık sistem temizlik + hazırlık silinir; bitmiş sistem, elle açılmış ve bakım görevi kalır", async () => {
    const r = await seedReservation();
    const gone = [
      await seedTask(r.id, { type: "cleaning", origin: "system", status: "todo" }),
      await seedTask(r.id, { type: "checkin_prep", origin: "system", status: "awaiting_review" }),
    ];
    const kept = [
      await seedTask(r.id, { type: "cleaning", origin: "system", status: "done" }),
      await seedTask(r.id, { type: "cleaning", origin: "manual", status: "todo" }),
      await seedTask(r.id, { type: "maintenance", origin: "system", status: "todo" }),
    ];

    const res = await del(r.id);

    expect(res.status).toBe(200);
    expect(await prisma.reservation.findUnique({ where: { id: r.id } })).toBeNull();
    for (const t of gone) expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
    for (const t of kept) expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).reservationId).toBeNull();
  });

  it("başka kiracının rezervasyonu: 404, rezervasyon ve görevleri yerinde", async () => {
    const r = await seedReservation();
    const t = await seedTask(r.id, { type: "cleaning", origin: "system", status: "todo" });
    const other = await makeOrgWithProperty();
    session = { ...session, organizationId: other.orgId };

    const res = await del(r.id);

    expect(res.status).toBe(404);
    expect(await prisma.reservation.findUnique({ where: { id: r.id } })).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).reservationId).toBe(r.id);
  });

  it("olmayan kimlik: 404", async () => {
    expect((await del("yok")).status).toBe(404);
  });
});
