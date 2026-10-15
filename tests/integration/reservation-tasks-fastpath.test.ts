import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";

// ---------------------------------------------------------------------------
// HIZLI YOL (Opus 10-15 B5): senkron her turda penceredeki HER rezervasyon için çağırır; geçmiş konaklama ya da görevleri tam rezervasyon
// için işlem + kilit AÇILMAZ (havuz baskısı). Eksik görev varsa kilitli yol aynen koşar. AYRI DOSYA: Prisma istemcisine casus sızmasın.
// ---------------------------------------------------------------------------

describe("createReservationTasks — hızlı yol", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    propertyId = (await makeOrgWithProperty()).propertyId;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const reservation = (arrival: number, departure: number) =>
    prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: daysFromNow(arrival), departureDate: daysFromNow(departure), channel: "airbnb", status: "confirmed" },
    });

  it("geçmiş konaklama → 0, işlem AÇILMAZ", async () => {
    const r = await reservation(-10, -7);
    const tx = vi.spyOn(prisma, "$transaction");
    expect(await createReservationTasks(r.id)).toBe(0);
    expect(tx).not.toHaveBeenCalled();
  });

  it("görevleri tam rezervasyon → 0, işlem AÇILMAZ; eksik görev varsa işlem açılır ve yalnız eksik yazılır", async () => {
    const r = await reservation(2, 4);
    expect(await createReservationTasks(r.id)).toBe(2);
    const tx = vi.spyOn(prisma, "$transaction");
    expect(await createReservationTasks(r.id)).toBe(0);
    expect(tx).not.toHaveBeenCalled();
    await prisma.task.deleteMany({ where: { reservationId: r.id, type: "cleaning" } });
    expect(await createReservationTasks(r.id)).toBe(1);
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it("iptal temizliği: silinecek sistem görevi yoksa işlem AÇILMAZ (senkron zaten iptal edilmiş satırlarda her turda yeniden dener)", async () => {
    const r = await reservation(2, 4);
    await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
    const tx = vi.spyOn(prisma, "$transaction");
    expect(await removeAutoTasksForCancelledReservation(r.id)).toBe(0);
    expect(tx).not.toHaveBeenCalled();
  });
});
