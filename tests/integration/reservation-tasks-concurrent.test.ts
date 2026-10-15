import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { createReservationTasks, removeAutoTasksForCancelledReservation, __reservationTaskHooks } from "@/lib/automation";
import { lockProbe } from "../helpers/lock-probe";
import { pauseFirstCreator, untilPaused, waitingOnReservationLock } from "../helpers/reservation-lock";

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
  afterEach(() => {
    __reservationTaskHooks.afterExistingRead = null;
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

  it("🚨 BELİRLENİMCİ (Opus B8): kilitli bölgeye aynı anda YALNIZ BİR çağrı girer — kilit kaldırılırsa her koşuda ikisi buluşur", async () => {
    const r = await makeReservation();
    const probe = lockProbe();
    __reservationTaskHooks.afterExistingRead = probe.hook;
    const results = await Promise.all([createReservationTasks(r.id), createReservationTasks(r.id), createReservationTasks(r.id)]);
    // En az ikisi kilitli bölgeye girdi (biri hızlı yoldan dönebilir: bağlantı havuzu dar / yük altında birincinin commit'ini görür).
    expect(probe.entries()).toBeGreaterThanOrEqual(2);
    expect(probe.maxInside()).toBe(1);
    expect(results.reduce((a, b) => a + b, 0)).toBe(2);
    expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(2);
  });

  /** Ayrı bir işlemde rezervasyon kilidini tutar; `release()` bırakır. */
  async function holdReservationLock(reservationId: string) {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let acquired: () => void = () => {};
    const ready = new Promise<void>((r) => (acquired = r));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(44, hashtext('${reservationId}'))`);
        acquired();
        await held;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    await ready;
    return { release: async () => { release(); await done; } };
  }
  it("🚨 kilitte bekleyen görev açma, arada İPTAL edilen rezervasyona görev AÇMAZ (rezervasyon kilit altında yeniden okunur — Opus B6)", async () => {
    const r = await makeReservation();
    const lock = await holdReservationLock(r.id);
    let pending: Promise<number>;
    try {
      pending = createReservationTasks(r.id);
      await vi.waitFor(async () => expect(await waitingOnReservationLock(r.id)).toBe(1), { timeout: 5_000 });
      await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
    } finally {
      await lock.release(); // kontrol düşse de kilit bırakılır (ChatGPT 10-15)
    }
    expect(await pending!).toBe(0);
    expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(0);
  });

  it("🚨 iptal temizliği AYNI kilidi alır: süren görev açma bitince temizlik görevleri siler (iptal edilmiş konaklamaya temizlik kalmaz)", async () => {
    const r = await makeReservation();
    await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
    await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", origin: "system", title: "x", dueAt: r.departureDate, status: "todo" } });
    const lock = await holdReservationLock(r.id);
    let pending: Promise<number>;
    try {
      pending = removeAutoTasksForCancelledReservation(r.id);
      await vi.waitFor(async () => expect(await waitingOnReservationLock(r.id)).toBe(1), { timeout: 5_000 });
      expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(1); // kilit tutulurken silmedi
    } finally {
      await lock.release();
    }
    expect(await pending!).toBe(1);
    expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(0);
  });

  it("🚨 İPTAL SIRASI (ChatGPT 10-15): görev açan işlem rezervasyonu 'onaylı' okuyup YAZMADAN önce iptal + temizlik gelir → temizlik kilidi BEKLER, sonunda görev KALMAZ (her iptal yolu ayrıca `cancel-paths-lock-protocol.test.ts`te)", async () => {
    const r = await makeReservation();
    const pause = pauseFirstCreator(r.id); // açan işlem kilit altında: rezervasyon "onaylı" okundu, görevler henüz yazılmadı
    const creating = createReservationTasks(r.id);
    let cleaning: Promise<number> | null = null;
    try {
      await untilPaused(pause, creating);
      await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
      cleaning = removeAutoTasksForCancelledReservation(r.id);
      // Temizlik KİLİTTE beklemeli — o an silinecek görev yok; "görev yok → çık" kısa yolu burada yanılırdı.
      await vi.waitFor(async () => expect(await waitingOnReservationLock(r.id)).toBe(1), { timeout: 5_000 });
    } finally {
      pause.release();
    }
    expect(await creating).toBe(2); // açan işlem kendi gördüğüyle bitti (iki görev yazdı)
    expect(await cleaning!).toBe(2); // temizlik kilidi alınca onları sildi
    expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(0);
  });

  it("aşırı uygulama yok: BAŞKA rezervasyonun kilidi tutulurken bu rezervasyonun görevleri BEKLEMEDEN açılır (Opus B9)", async () => {
    const a = await makeReservation("A");
    const b = await makeReservation("B");
    const lock = await holdReservationLock(a.id);
    try {
      const t0 = Date.now();
      expect(await createReservationTasks(b.id)).toBe(2);
      expect(Date.now() - t0).toBeLessThan(3_000);
    } finally {
      await lock.release();
    }
  });

  it("iptal temizliği hızlı yol: silinecek sistem görevi yoksa işlem açmadan 0 döner; varsa siler", async () => {
    const r = await makeReservation();
    await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
    expect(await removeAutoTasksForCancelledReservation(r.id)).toBe(0);
    await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", origin: "system", title: "x", dueAt: r.departureDate, status: "todo" } });
    await prisma.task.create({ data: { propertyId, reservationId: r.id, type: "cleaning", origin: "manual", title: "elle", dueAt: r.departureDate, status: "todo" } });
    expect(await removeAutoTasksForCancelledReservation(r.id)).toBe(1);
    expect((await prisma.task.findMany({ where: { reservationId: r.id }, select: { origin: true } })).map((t) => t.origin)).toEqual(["manual"]);
  });
});
