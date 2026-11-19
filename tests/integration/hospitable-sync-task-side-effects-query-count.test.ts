import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// HOSPITABLE SENKRONU — REZERVASYON BAŞINA GÖREV YAN ETKİLERİ TEK KİLİTSİZ OKUMAYLA (O1 optimizasyonu, 11-19).
//
// Senkron her rezervasyon için `createReservationTasks` ve ardından `removeAutoTasksForCancelledReservation` çağırır; ikisinin kilitsiz ön
// okuması AYNI satırın durumunu art arda okuyordu. Temizliğin ön okuması yalnız "iptal DEĞİL → yapılacak iş yok" der (iptal görülürse
// kilitli yol durumu kendisi yeniden okur). Görev oluşturmanın az önceki okuması "iptal değil" dediyse temizlik çağrılmaz; iptal, okunamadı
// ya da satır yok → eskisi gibi çağrılır. Arada gelen iptal, eski yolda da ön okumadan hemen SONRA gelebilen yarıştır (iptal eden yolun kendi
// temizliği koşar; kaçarsa sonraki senkron "zaten iptal" satırını onarır).
// ---------------------------------------------------------------------------

const counter = vi.hoisted(() => ({ on: false, rows: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on(e: string, cb: (e: { query: string }) => void): void }).$on("query", (e) => {
    if (counter.on) counter.rows.push(e.query);
  });
  return { prisma: client };
});
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalReservation } from "../helpers/fake-ingest";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const TOKEN = "tok-side";
const HP = "hp-side";
const fake = new FakeIngestProvider();
const ARR = daysFromNow(5);
const DEP = daysFromNow(9);
const res = (n: number, status: "confirmed" | "cancelled" = "confirmed") =>
  canonicalReservation({ externalId: `res-${n}`, code: `HM${n}`, arrivalDate: ARR, departureDate: DEP, status, guest: { externalId: `g-${n}`, name: `Misafir ${n}`, email: null, phone: null } });

async function setup() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await setOrgHospitableToken(orgId, TOKEN, null);
  fake.addProperty(TOKEN, HP, "Test Property");
  return { orgId, propertyId };
}
const reservationReads = () => counter.rows.filter((q) => /^\s*SELECT/i.test(q) && /FROM\s+"public"\."Reservation"/i.test(q)).length;

describe("syncHospitable — görev yan etkileri tek kilitsiz okumayla", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    resetPrimaryOrgCache();
  });

  it("🚨 4 onaylı rezervasyon, değişiklik yok: rezervasyon başına İKİ okuma (yazma işleminin araması + görev ön okuması; eskiden üç)", async () => {
    const { orgId } = await setup();
    fake.setReservations(HP, [res(1), res(2), res(3), res(4)]);
    await syncHospitable(orgId);
    counter.rows = [];
    counter.on = true;
    const r = await syncHospitable(orgId);
    counter.on = false;
    expect(r).toMatchObject({ reservations: 4 });
    expect(reservationReads()).toBe(8);
  });

  it("aşırı uygulama yok: ZATEN iptal edilmiş rezervasyonun başlanmamış sistem görevi senkronda yine temizlenir (onarım)", async () => {
    const { orgId, propertyId } = await setup();
    fake.setReservations(HP, [res(1)]);
    await syncHospitable(orgId);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
    expect(await prisma.task.count({ where: { reservationId: row.id, origin: "system" } })).toBe(2);
    // Satır başka yoldan iptal edilmiş, temizliği kaçmış (görevler duruyor).
    await prisma.reservation.update({ where: { id: row.id }, data: { status: "cancelled" } });
    fake.setReservations(HP, [res(1, "cancelled")]);
    await syncHospitable(orgId);
    expect(await prisma.task.count({ where: { reservationId: row.id, origin: "system" } })).toBe(0);
  });

  it("aşırı uygulama yok: kanal bu geçişte iptal etti → iptal temizliği (geçiş) aynı geçişte koşar", async () => {
    const { orgId, propertyId } = await setup();
    fake.setReservations(HP, [res(1)]);
    await syncHospitable(orgId);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
    fake.setReservations(HP, [res(1, "cancelled")]);
    await syncHospitable(orgId);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("cancelled");
    expect(await prisma.task.count({ where: { reservationId: row.id, origin: "system" } })).toBe(0);
  });
});
