import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { createReservationTasks } from "@/lib/automation";

// ---------------------------------------------------------------------------
// YAŞAM DÖNGÜSÜ GÖREVLERİ — EŞ ZAMANLI ÇAĞRI (idempotency denetimi 10-15, P2).
// Ölçülen boşluk: "var mı?" okuması ile yazma arasında kilit yoktu → senkron turu + "Eksik görevleri oluştur" (ya da iki senkron) aynı
// rezervasyonda aynı anda koşunca ikisi de "temizlik yok" görüp İKİ temizlik görevi açıyordu (temizlikçi listesinde çift iş).
// Gerçek PostgreSQL: çağrılar ayrı bağlantılarda gerçekten eş zamanlı koşar.
// ---------------------------------------------------------------------------

describe("createReservationTasks — eş zamanlı çağrı", () => {
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    propertyId = (await makeOrgWithProperty()).propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const makeReservation = (guestName = "Ada Guest") =>
    prisma.reservation.create({
      data: { propertyId, guestName, arrivalDate: daysFromNow(2), departureDate: daysFromNow(4), channel: "airbnb", status: "confirmed" },
    });

  it("🚨 aynı rezervasyona 6 eş zamanlı çağrı → TEK giriş hazırlığı + TEK temizlik; toplam oluşturulan 2", async () => {
    const r = await makeReservation();
    const results = await Promise.all(Array.from({ length: 6 }, () => createReservationTasks(r.id)));
    expect(results.reduce((a, b) => a + b, 0)).toBe(2);
    const tasks = await prisma.task.findMany({ where: { reservationId: r.id }, select: { type: true } });
    expect(tasks.map((t) => t.type).sort()).toEqual(["checkin_prep", "cleaning"]);
  });

  it("aşırı uygulama yok: farklı rezervasyonlar birbirini beklemez ve her biri kendi görevlerini alır", async () => {
    const rs = await Promise.all([makeReservation("A"), makeReservation("B"), makeReservation("C")]);
    await Promise.all(rs.flatMap((r) => [createReservationTasks(r.id), createReservationTasks(r.id)]));
    for (const r of rs) {
      const types = (await prisma.task.findMany({ where: { reservationId: r.id }, select: { type: true } })).map((t) => t.type).sort();
      expect(types).toEqual(["checkin_prep", "cleaning"]);
    }
  });

  it("eksik tür onarımı korunur: yalnız giriş hazırlığı varken eş zamanlı çağrılar TEK temizlik ekler", async () => {
    const r = await makeReservation();
    await prisma.task.create({
      data: { propertyId, reservationId: r.id, type: "checkin_prep", origin: "system", title: "x", dueAt: r.arrivalDate, status: "todo" },
    });
    const results = await Promise.all(Array.from({ length: 4 }, () => createReservationTasks(r.id)));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await prisma.task.count({ where: { reservationId: r.id, type: "cleaning" } })).toBe(1);
    expect(await prisma.task.count({ where: { reservationId: r.id, type: "checkin_prep" } })).toBe(1);
  });
});
