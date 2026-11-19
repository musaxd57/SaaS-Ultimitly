import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// `upsertCanonicalReservation` — VAR OLAN SATIRDA MÜLK OKUMASI YOK (O1 optimizasyonu, 11-19).
//
// Hospitable senkronu pencerendeki HER rezervasyonu her 2 dakikada kendi yazma işleminde bu fonksiyondan geçirir; olağan hâlde satır var ve
// değişmemiş. Fonksiyon önce "mülk gerçekten var mı?" (yabancı anahtar güvenliği) okuyup SONRA satırı arıyordu. Satır bulunduysa mülk
// zaten vardır: `Reservation.propertyId` yabancı anahtar, mülk silinince rezervasyon da AYNI deyimde silinir (cascade) — görülen satırın
// mülkü aynı anlık görüntüde vardır. Artık önce satır aranır; mülk okuması yalnız YENİ satır yazılacakken (yabancı anahtar güvenliği aynen).
// Yarışta (mülk aynı anda siliniyor) yeni sıra, eski sıranın "silme önce geldi" hâliyle aynı sonucu verir (null → `no_property`).
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

import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { canonicalReservation } from "../helpers/fake-ingest";
import { upsertCanonicalReservation } from "@/lib/ingest/write-service";

const ARR = daysFromNow(5);
const DEP = daysFromNow(9);
const R = (over: Record<string, unknown> = {}) =>
  canonicalReservation({ externalId: "res-q-1", code: "HMQ1", arrivalDate: ARR, departureDate: DEP, ...over });

function op(q: string): string {
  const head = q.trim().split(/\s+/)[0].toUpperCase();
  if (head === "BEGIN" || head === "COMMIT") return head;
  const t = /(?:FROM|INTO|UPDATE)\s+"public"\."(\w+)"/i.exec(q)?.[1] ?? "?";
  return `${head} ${t}`;
}

async function upsertCounted(propertyId: string, organizationId: string, r: ReturnType<typeof R>) {
  const ctx = { organizationId, provider: "hospitable" as const, connectionId: null };
  counter.rows = [];
  counter.on = true;
  try {
    const id = await prisma.$transaction(async (tx) => upsertCanonicalReservation(tx, propertyId, r, ctx));
    return { id, ops: counter.rows.map(op).filter((o) => o !== "BEGIN" && o !== "COMMIT") };
  } finally {
    counter.on = false;
  }
}

describe("upsertCanonicalReservation — sorgu sayısı", () => {
  beforeEach(resetDb);

  it("🚨 var olan, DEĞİŞMEMİŞ satır (senkronun olağan hâli): TEK okuma, mülk okunmaz, yazma yok (eskiden mülk + rezervasyon)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const first = await upsertCounted(propertyId, orgId, R());
    expect(first.id).toBeTruthy();
    const again = await upsertCounted(propertyId, orgId, R());
    expect(again.id).toBe(first.id);
    expect(again.ops).toEqual(["SELECT Reservation"]);
  });

  it("YENİ satır: mülk okuması (yabancı anahtar güvenliği) yazmadan ÖNCE aynen yapılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { id, ops } = await upsertCounted(propertyId, orgId, R());
    expect(id).toBeTruthy();
    expect(ops.slice(0, 3)).toEqual(["SELECT Reservation", "SELECT Property", "INSERT Reservation"]);
  });

  it("mülk YOKSA (silinmiş / yanlış kimlik): null döner, hiçbir şey yazılmaz — eskisiyle aynı", async () => {
    const { orgId } = await makeOrgWithProperty();
    const { id, ops } = await upsertCounted("prop-yok", orgId, R());
    expect(id).toBeNull();
    expect(ops.some((o) => o.startsWith("INSERT") || o.startsWith("UPDATE"))).toBe(false);
    expect(await prisma.reservation.count()).toBe(0);
    expect(await prisma.ingestEvent.count()).toBe(0);
  });

  it("aşırı uygulama yok: var olan satırda DEĞİŞEN alan yine yazılır ve olayı üretilir (mülk okunmadan)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const first = await upsertCounted(propertyId, orgId, R());
    const newDep = daysFromNow(10);
    const changed = await upsertCounted(propertyId, orgId, R({ departureDate: newDep }));
    expect(changed.id).toBe(first.id);
    expect(changed.ops).not.toContain("SELECT Property");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: first.id! } })).departureDate.getTime()).toBe(newDep.getTime());
    expect(await prisma.ingestEvent.count({ where: { entityId: first.id!, kind: "reservation.updated" } })).toBe(1);
  });
});
