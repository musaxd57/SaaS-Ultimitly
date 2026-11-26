import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import { enqueueStorageDeletions } from "@/lib/storage/deletion-queue";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// İNCELEME AJANI b1 (09-30) — GÖREV FOTOĞRAFLARININ YAŞAM DÖNGÜSÜ:
//   · Rezervasyon iptalinde silinen sistem görevlerinin (temizlikçinin yüklediği) fotoğrafları kovada sahipsiz kalıyordu
//     (`removeAutoTasksForCancelledReservation` silme niyeti yazmıyordu; hesap silme de onları bulamaz — satır gitmiş).
//   · Mülk / görev silme, eski (bağlama kuralından önceki) satırlarda BAŞKA bir görevin de gösterdiği nesneyi kuyruğa yazıyordu →
//     B mülkünün görevindeki fotoğraf A silinince kovadan gidiyordu. Artık yalnız hiçbir satırın göstermediği nesne kuyruğa girer.
//   · Kuyruk satırının vadesi uygulama saatiyle yazılır (boşaltıcı o saatle kıyaslar; şema varsayılanı veritabanı saati).
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { DELETE as taskDELETE } from "@/app/api/tasks/[id]/route";
import { DELETE as propertyDELETE } from "@/app/api/properties/[id]/route";
import { removeAutoTasksForCancelledReservation } from "@/lib/automation";

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u-${Math.random()}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "U", sessionEpoch: 0 };
  return { orgId, propertyId, userId: user.id };
}
const queued = async () => (await prisma.storageDeletion.findMany()).map((q) => q.objectKey).sort();

describe("görev fotoğrafları — silme niyeti (inceleme b1)", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("🚨 rezervasyon iptalinde silinen sistem görevinin fotoğrafı kuyruğa girer; bitmiş / elle görevinki girmez", async () => {
    const { orgId, propertyId, userId } = await seed();
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "G", arrivalDate: new Date(Date.now() + 86_400_000), departureDate: new Date(Date.now() + 3 * 86_400_000), status: "cancelled", channel: "airbnb" },
    });
    const sys = await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", title: "Temizlik", status: "in_progress", priority: "standard", origin: "system" } });
    const done = await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", title: "Bitti", status: "done", priority: "standard", origin: "system" } });
    const manual = await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", title: "Elle", status: "todo", priority: "standard", origin: "manual" } });
    const kSys = `org/${orgId}/task/${sys.id}/1-a.png`;
    const kDone = `org/${orgId}/task/${done.id}/2-b.png`;
    const kManual = `org/${orgId}/task/${manual.id}/3-c.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId: sys.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + kSys },
        { taskId: done.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + kDone },
        { taskId: manual.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + kManual },
      ],
    });
    expect(await removeAutoTasksForCancelledReservation(r.id)).toBe(1);
    expect(await prisma.task.count({ where: { id: sys.id } })).toBe(0);
    expect(await queued()).toEqual([kSys]);
  });

  it("🚨 mülk silme: başka mülkün görevinin de gösterdiği (eski satır) nesne kuyruğa GİRMEZ; yalnız ona ait olan girer", async () => {
    const { orgId, propertyId, userId } = await seed();
    const task = await prisma.task.create({ data: { propertyId, type: "cleaning", title: "A", status: "todo", priority: "standard" } });
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "B" } });
    const otherTask = await prisma.task.create({ data: { propertyId: other.id, type: "cleaning", title: "B", status: "todo", priority: "standard" } });
    const shared = `org/${orgId}/task/${task.id}/10-shared.png`;
    const own = `org/${orgId}/task/${task.id}/11-own.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId: task.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + shared },
        { taskId: task.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + own },
        { taskId: otherTask.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + shared }, // eski satır: aynı nesne B'de de görünüyor
      ],
    });
    const res = await propertyDELETE(new NextRequest(`http://localhost/api/properties/${propertyId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(res.status).toBe(200);
    expect(await queued()).toEqual([own]);
  });

  it("🚨 görev silme: aynı kural (paylaşılan nesne kalır, kendine ait olan kuyruğa)", async () => {
    const { orgId, propertyId, userId } = await seed();
    const task = await prisma.task.create({ data: { propertyId, type: "cleaning", title: "A", status: "todo", priority: "standard" } });
    const task2 = await prisma.task.create({ data: { propertyId, type: "cleaning", title: "B", status: "todo", priority: "standard" } });
    const shared = `org/${orgId}/task/${task.id}/20-shared.png`;
    const own = `org/${orgId}/task/${task.id}/21-own.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId: task.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + shared },
        { taskId: task.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + own },
        { taskId: task2.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + shared },
      ],
    });
    const res = await taskDELETE(new NextRequest(`http://localhost/api/tasks/${task.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    expect(await queued()).toEqual([own]);
  });

  it("🚨 kuyruk satırının vadesi UYGULAMA saatiyle yazılır (şema varsayılanı değil)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const future = new Date(Date.now() + 5 * 86_400_000);
    vi.setSystemTime(future);
    await enqueueStorageDeletions(prisma, "o1", ["org/o1/task/t1/a.png"]);
    const row = await prisma.storageDeletion.findFirstOrThrow();
    expect(row.availableAt.getTime()).toBe(future.getTime());
  });
});
