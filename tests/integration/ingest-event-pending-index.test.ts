import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// MIGRATION 78 — tüketicinin "işlenmemiş olaylar" okuması dizinle (gece-4 S8-04, `docs/arastirma-2026-10-18/S8-performans.md`).
//
// Zekâ tüketicisi (`modules/intelligence/consumer.ts processIngestEvents`) her 2 dakikada kurum başına `dispatchedAt IS NULL` olayları
// `occurredAt, id` sırasıyla okur. IngestEvent hiç silinmez; eski (organizationId, occurredAt) dizini bekleyenleri ayıramadığı için sorgu
// kurumun BÜTÜN işlenmiş geçmişini gezip eliyordu (S8 ölçümü: 20 bin olayda 19.980 satır elendi; 10-18 yeniden ölçüm: 40 bin olayda 40.000
// satır elendi, 3,9 ms → dizinle 0,05 ms).
// Bu dosya planı iki yönde sınar: dizin varken hiçbir satır elenmez ve dizin koşulu `dispatchedAt IS NULL`u taşır; dizin düşürülünce
// (aynı işlemde, geri alınır) işlenmiş geçmiş taranıp elenir — yani farkı yaratan bu dizindir.
// ---------------------------------------------------------------------------

const INDEX = "IngestEvent_organizationId_dispatchedAt_occurredAt_idx";
const DISPATCHED_PER_ORG = 4000;
const PENDING = 5;

type PlanNode = { "Node Type": string; "Index Name"?: string; "Index Cond"?: string; "Rows Removed by Filter"?: number; Plans?: PlanNode[] };
const nodes = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(nodes)];

/**
 * Tüketicinin sorgusunun SQL karşılığı (consumer.ts: where dispatchedAt null + organizationId, orderBy occurredAt/id, take).
 * EXPLAIN bir yardımcı komut: bağlı parametre (`$1`) her sürücüde kabul edilmez → kimlik yalnız cuid karakterleriyse metne gömülür.
 */
async function plan(db: Pick<typeof prisma, "$queryRawUnsafe">, organizationId: string): Promise<PlanNode[]> {
  if (!/^[a-z0-9]+$/.test(organizationId)) throw new Error(`beklenmeyen kimlik: ${organizationId}`);
  const rows = await db.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(
    `EXPLAIN (ANALYZE, FORMAT JSON) SELECT "id" FROM "IngestEvent" WHERE "dispatchedAt" IS NULL AND "organizationId" = '${organizationId}' ORDER BY "occurredAt" ASC, "id" ASC LIMIT 500`,
  );
  const raw = rows[0]["QUERY PLAN"];
  const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>;
  return nodes(parsed[0].Plan);
}
const removed = (ns: PlanNode[]) => ns.reduce((sum, n) => sum + (n["Rows Removed by Filter"] ?? 0), 0);

let orgId = "";

beforeAll(async () => {
  await resetDb();
  const a = await makeOrgWithProperty();
  const b = await makeOrgWithProperty();
  orgId = a.orgId;
  const base = Date.now() - 400 * 86_400_000;
  for (const org of [a.orgId, b.orgId]) {
    await prisma.ingestEvent.createMany({
      data: Array.from({ length: DISPATCHED_PER_ORG }, (_, i) => ({
        organizationId: org,
        provider: "hospitable",
        entityType: "message",
        entityId: `m-${org}-${i}`,
        kind: "message.imported",
        occurredAt: new Date(base + i * 60_000),
        dispatchedAt: new Date(base + i * 60_000 + 1000),
      })),
    });
  }
  await prisma.ingestEvent.createMany({
    data: Array.from({ length: PENDING }, (_, i) => ({
      organizationId: orgId,
      provider: "hospitable",
      entityType: "message",
      entityId: `pending-${i}`,
      kind: "message.imported",
      occurredAt: new Date(Date.now() - (PENDING - i) * 1000),
    })),
  });
  await prisma.$executeRawUnsafe('ANALYZE "IngestEvent"');
});

afterAll(async () => {
  await resetDb();
});

describe("migration 78: bekleyen olay dizini", () => {
  it("dizin var: plan bekleyenleri dizin koşuluyla bulur, işlenmiş geçmiş taranıp elenmez", async () => {
    const ns = await plan(prisma, orgId);
    const scan = ns.find((n) => n["Index Name"] === INDEX);
    expect(scan, JSON.stringify(ns.map((n) => n["Node Type"]))).toBeDefined();
    expect(scan!["Index Cond"]).toMatch(/"dispatchedAt" IS NULL/);
    expect(removed(ns)).toBe(0);
  });

  it("karşı yön: dizin düşürülünce (işlem içinde, geri alınır) kurumun işlenmiş geçmişi taranıp elenir", async () => {
    const rollback = new Error("rollback");
    let without: PlanNode[] = [];
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP INDEX "${INDEX}"`);
        without = await plan(tx, orgId);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(without.some((n) => n["Index Name"] === INDEX)).toBe(false);
    expect(removed(without)).toBeGreaterThanOrEqual(DISPATCHED_PER_ORG);
    // Geri alındı: dizin yerinde.
    const back = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_indexes WHERE indexname = $1`, INDEX);
    expect(Number(back[0].n)).toBe(1);
  });

  it("davranış aynı: tüketicinin okuması yalnız bekleyenleri, en eskiden döndürür", async () => {
    const rows = await prisma.ingestEvent.findMany({
      where: { dispatchedAt: null, organizationId: orgId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { entityId: true },
    });
    expect(rows.map((r) => r.entityId)).toEqual(Array.from({ length: PENDING }, (_, i) => `pending-${i}`));
  });
});
