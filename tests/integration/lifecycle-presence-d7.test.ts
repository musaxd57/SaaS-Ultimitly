import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { createReservationTasks, backfillReservationTasks } from "@/lib/automation";
import { countReservationsMissingCleaning } from "@/lib/tasks/missing-cleaning";
import { POST as REACTIVATE } from "@/app/api/reservations/[id]/reactivate/route";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";

// ---------------------------------------------------------------------------
// KURUCU D7 (10-15, aynen): "Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin; mevcut söz görevi
// korunsun. Ancak tamamlanmış sistem görevi yalnız aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış
// tarihi sonradan değişmişse eski tamamlanmış işi otomatik olarak yeni tarihin temizliği sayma."
// Görev açma ile "Eksik görevleri oluştur (N)" sayısı AYNI kararı verir.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const atMidnight = (offset: number) => new Date(`${new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
const TZ = "Europe/Istanbul";

describe("yaşam döngüsü görevi 'zaten var mı?' — kurucu D7", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const reservation = (status = "confirmed", arrival = 3, departure = 6) =>
    prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: atMidnight(arrival), departureDate: atMidnight(departure), channel: "airbnb", status, sourceReference: `r-${arrival}-${departure}-${status}` },
    });
  const task = (reservationId: string, over: Record<string, unknown>) =>
    prisma.task.create({ data: { propertyId, reservationId, type: "cleaning", origin: "system", title: "x", status: "todo", ...over } });
  const systemCleanings = (reservationId: string) =>
    prisma.task.findMany({ where: { reservationId, type: "cleaning", origin: "system" }, select: { status: true, dueAt: true } });

  it("🚨 kurucunun örneği: söz görevi varken iptal → 'Yeniden aç' → ÇIKIŞ TEMİZLİĞİ açılır, söz görevi aynen durur", async () => {
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
    const r = await reservation("cancelled");
    const promise = await task(r.id, { origin: "manual", title: "Misafire söz: Temizlik", dueAt: new Date(atMidnight(4).getTime() + 18 * 3_600_000) });
    await prisma.ingestEvent.create({
      data: {
        organizationId: orgId, provider: "hospitable", entityType: "reservation", entityId: r.id, kind: "reservation.updated",
        changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]), occurredAt: new Date(),
      },
    });
    const res = await REACTIVATE(new NextRequest(`http://localhost/api/reservations/${r.id}/reactivate`, { method: "POST" }), { params: Promise.resolve({ id: r.id }) });
    expect(res.status).toBe(200);
    expect(await systemCleanings(r.id)).toEqual([{ status: "todo", dueAt: r.departureDate }]);
    expect(await prisma.task.findUnique({ where: { id: promise.id } })).not.toBeNull();
  });

  it("vadesiz elle temizlik otomatik çıkış temizliğini engellemez; 'Eksik görevleri oluştur' sayısı da onu eksik sayar", async () => {
    const r = await reservation();
    await task(r.id, { origin: "manual", type: "cleaning" });
    await task(r.id, { origin: "system", type: "checkin_prep" });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(1);
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(0);
  });

  it("aşırı uygulama yok: AYNI çıkış gününün BİTMİŞ sistem temizliği ikinci temizliği engeller (sayı 0, yeni görev yok)", async () => {
    const r = await reservation();
    await task(r.id, { status: "done", dueAt: r.departureDate });
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(0);
    expect(await createReservationTasks(r.id)).toBe(0);
    expect(await systemCleanings(r.id)).toHaveLength(1);
  });

  it("🚨 çıkış tarihi değişti: ESKİ günün bitmiş temizliği yeni günü karşılamaz → yeni günün temizliği açılır (sayı da 1 gösterir)", async () => {
    const r = await reservation("confirmed", 3, 8); // çıkış 6 → 8'e uzatıldı
    await task(r.id, { status: "done", dueAt: atMidnight(6) });
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(1);
    const backfill = await backfillReservationTasks(orgId);
    expect(backfill.created).toBe(1); // düğmedeki sayı ile açılan görev sayısı tutar
    expect((await systemCleanings(r.id)).map((t) => [t.status, t.dueAt?.getTime()])).toEqual(
      expect.arrayContaining([["done", atMidnight(6).getTime()], ["todo", atMidnight(8).getTime()]]),
    );
  });

  it("tekrar güvenliği: yeni günün temizliği açıldıktan sonra yeniden çağrı ikinci görev AÇMAZ", async () => {
    const r = await reservation("confirmed", 3, 8);
    await task(r.id, { status: "done", dueAt: atMidnight(6) });
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(await createReservationTasks(r.id)).toBe(0);
    expect(await systemCleanings(r.id)).toHaveLength(2);
  });

  // ── K4 (kurucu 10-17, "önerildiği gibi"): aynı rezervasyonun çıkış gününe elle açılmış temizlik varsa sistem ikincisini açmaz; ara temizlik
  // ve söz görevi yine engellemez. Görev açma ve "Eksik görevleri oluştur (N)" sayısı AYNI kararı verir.
  it("🚨 K4: ev sahibi çıkış gününe elle temizlik açtı → sistem ikincisini AÇMAZ, sayı 0 (eskiden iki görev yan yana)", async () => {
    const r = await reservation();
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    await task(r.id, { origin: "manual", title: "Temizlik (Ayşe)", dueAt: new Date(r.departureDate.getTime() + 9 * 3_600_000) });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(0);
    expect(await createReservationTasks(r.id)).toBe(0);
    expect(await systemCleanings(r.id)).toHaveLength(0);
    expect((await backfillReservationTasks(orgId)).created).toBe(0);
  });

  it("K4 aşırı uygulama yok: ARA temizlik (elle, konaklama ortası) çıkış temizliğini engellemez", async () => {
    const r = await reservation();
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    await task(r.id, { origin: "manual", dueAt: new Date(atMidnight(4).getTime() + 10 * 3_600_000) });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(1);
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(await systemCleanings(r.id)).toEqual([{ status: "todo", dueAt: r.departureDate }]);
  });

  it("K4 aşırı uygulama yok: çıkış gününe düşen SÖZ görevi (misafire verilen söz) çıkış temizliğinin yerini tutmaz", async () => {
    const r = await reservation();
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    const conversation = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Ada", status: "new", lastMessageAt: new Date() },
    });
    const promise = await task(r.id, { origin: "manual", title: "Misafire söz: Temizlik", dueAt: new Date(r.departureDate.getTime() + 8 * 3_600_000) });
    await prisma.guestCommitment.create({
      data: { organizationId: orgId, conversationId: conversation.id, taskId: promise.id, kind: "cleaning", dueAt: promise.dueAt! },
    });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(1);
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(await prisma.task.findUnique({ where: { id: promise.id } })).not.toBeNull();
  });

  it("K4: çıkış tarihi değişti → eski güne açılmış elle temizlik yeni günü karşılamaz (sayı 1, görev açılır)", async () => {
    const r = await reservation("confirmed", 3, 8);
    await task(r.id, { type: "checkin_prep", dueAt: r.arrivalDate });
    await task(r.id, { origin: "manual", status: "done", dueAt: new Date(atMidnight(6).getTime() + 9 * 3_600_000) });
    expect(await countReservationsMissingCleaning(orgId, new Date(), TZ)).toBe(1);
    expect(await createReservationTasks(r.id)).toBe(1);
  });
});
