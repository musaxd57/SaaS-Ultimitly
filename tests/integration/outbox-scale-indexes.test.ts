import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
import { __claimTimeouts, drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// MIGRATION 79 + talep zaman aşımı — kalıcı misafir mesajı kuyruğunun ölçek kalemleri (gece-4 S3-07 / S3-09; sert tasarım ajanı geçici
// PG16'da ölçtü: 20 bin birikimde talep 7,65 sn → 49 ms, sağlık ilerleme okuması ~1 sn → 0,03 ms).
// Planlar iki yönde sınanır (migration 78 testi gibi): dizin varken plan onu kullanır ve geçmiş taranıp elenmez; dizin aynı işlemde düşürülüp
// geri alınınca geçmiş taranır — farkı yaratan bu dizinlerdir. Zaman aşımı: tablo başka oturumda kilitliyken talep sorgusu veritabanı
// tarafında kesilir, geçiş "talep yok" ile döner (eskiden Prisma işlemi düşse de sorgu arkada sürüp talep kilidini tutuyordu). Kapsam yalnız TALEP:
// talepten önceki kurtarma güncellemesi (`recoverStaleClaims`, tek satırlık dizinli UPDATE) dış bir tablo kilidinde yine bekler — Haiku gece-4,
// bilinçli: yavaşlığın kaynağı talep sorgusuydu; tablo kilidini tutan dış iş (migration) zaten her yazmayı durdurur.
// ---------------------------------------------------------------------------

const SENT_INDEX = "MessageOutbox_sentAt_idx";
const CLAIMED_INDEX = "MessageOutbox_claimedAt_idx";
const SENT_PER_ORG = 3000;

type PlanNode = { "Node Type": string; "Index Name"?: string; "Index Cond"?: string; "Rows Removed by Filter"?: number; Plans?: PlanNode[] };
const nodes = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(nodes)];
const removed = (ns: PlanNode[]) => ns.reduce((sum, n) => sum + (n["Rows Removed by Filter"] ?? 0), 0);

/** EXPLAIN bağlı parametre kabul etmez → kimlik yalnız cuid karakterleriyse metne gömülür. */
async function plan(db: Pick<typeof prisma, "$queryRawUnsafe">, sql: string): Promise<PlanNode[]> {
  const rows = await db.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  const raw = rows[0]["QUERY PLAN"];
  const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>;
  return nodes(parsed[0].Plan);
}
const safeId = (id: string) => {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error(`beklenmeyen kimlik: ${id}`);
  return id;
};
/** İşçinin talep sorgusundaki "aynı rezervasyonun son 60 sn denemesi" alt sorgusunun SQL karşılığı (worker.ts claimBatchLocked). */
const recentSql = (orgId: string) =>
  `SELECT count(*) FROM "MessageOutbox" h WHERE h."organizationId" = '${safeId(orgId)}' AND h."externalReservationId" = 'res-7' ` +
  `AND h."externalReservationId" IS NOT NULL AND h."id" <> 'x' AND h."claimedAt" IS NOT NULL AND h."claimedAt" > now() - interval '60 seconds'`;
/** Kuyruk sağlığının "son 15 dk ilerleme" okuması (health.ts queueStallStates — claimedAt OR sentAt). */
const progressSql = `SELECT "id" FROM "MessageOutbox" WHERE ("claimedAt" >= now() - interval '15 minutes' OR "sentAt" >= now() - interval '15 minutes') LIMIT 1`;

let orgId = "";

beforeAll(async () => {
  await resetDb();
  const a = await makeOrgWithProperty();
  const b = await makeOrgWithProperty();
  orgId = a.orgId;
  const old = Date.now() - 3 * 86_400_000;
  for (const org of [a.orgId, b.orgId]) {
    await prisma.messageOutbox.createMany({
      data: Array.from({ length: SENT_PER_ORG }, (_, i) => ({
        organizationId: org,
        channel: "airbnb",
        body: "x",
        idempotencyKey: `sent-${i}`,
        status: "sent",
        externalReservationId: `res-${i % 300}`,
        availableAt: new Date(old + i * 1000),
        claimedAt: new Date(old + i * 1000),
        sentAt: new Date(old + i * 1000 + 500),
      })),
    });
  }
  await prisma.$executeRawUnsafe('ANALYZE "MessageOutbox"');
});

afterAll(async () => {
  await resetDb();
});

afterEach(() => {
  __claimTimeouts.statementMs = 10_000;
  reportErrorMock.mockReset();
});

describe("migration 79: kuyruk ölçek dizinleri", () => {
  it("talep alt sorgusu (rezervasyonun son 60 sn denemesi) claimedAt dizininden yalnız son 60 saniyeyi okur; dizin düşünce işletmenin geçmişi taranır", async () => {
    const ns = await plan(prisma, recentSql(orgId));
    const scan = ns.find((n) => n["Index Name"] === CLAIMED_INDEX);
    expect(scan, JSON.stringify(ns.map((n) => [n["Node Type"], n["Index Name"]]))).toBeDefined();
    expect(scan!["Index Cond"]).toMatch(/"claimedAt" > /);
    expect(removed(ns)).toBe(0);
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP INDEX "${CLAIMED_INDEX}"`);
        const without = await plan(tx, recentSql(orgId));
        expect(without.some((n) => n["Index Name"] === CLAIMED_INDEX)).toBe(false);
        // Dizinsiz: işletmenin bütün satırları (ya da tablonun tamamı) okunup elenir.
        expect(removed(without)).toBeGreaterThanOrEqual(SENT_PER_ORG);
        throw new Error("geri al");
      })
      .catch((err) => {
        if ((err as Error).message !== "geri al") throw err;
      });
    expect(await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM pg_indexes WHERE indexname = '${CLAIMED_INDEX}'`)).toEqual([
      { n: 1n },
    ]);
  });

  it("sağlık ilerleme okuması (claimedAt OR sentAt) iki düz dizinin birleşimi; dizinler düşünce tablo baştan sona taranır", async () => {
    const ns = await plan(prisma, progressSql);
    const names = ns.map((n) => n["Index Name"]).filter(Boolean);
    expect(names, JSON.stringify(ns.map((n) => n["Node Type"]))).toEqual(expect.arrayContaining([SENT_INDEX, CLAIMED_INDEX]));
    expect(ns.some((n) => n["Node Type"] === "Seq Scan")).toBe(false);
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP INDEX "${SENT_INDEX}"`);
        await tx.$executeRawUnsafe(`DROP INDEX "${CLAIMED_INDEX}"`);
        const without = await plan(tx, progressSql);
        expect(without.some((n) => n["Node Type"] === "Seq Scan")).toBe(true);
        expect(removed(without)).toBe(2 * SENT_PER_ORG);
        throw new Error("geri al");
      })
      .catch((err) => {
        if ((err as Error).message !== "geri al") throw err;
      });
  });
});

describe("talep sorgusu veritabanı tarafında kesilir (S3-07)", () => {
  it("🚨 tablo başka oturumda kilitliyken talep tavanında kesilir: geçiş 'talep yok' döner, hata bildirilir, kilit beklenmez", async () => {
    __claimTimeouts.statementMs = 400;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let locked: () => void = () => {};
    const lockTaken = new Promise<void>((r) => (locked = r));
    // Okumaya izin verir, güncellemeyi bekletir (talep bir UPDATE'tir).
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('LOCK TABLE "MessageOutbox" IN EXCLUSIVE MODE');
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await lockTaken;
    const started = Date.now();
    try {
      const res = await drainOutboxOnce({ skipRecover: true, skipHeal: true, send: vi.fn(async () => ({ ok: true, providerMessageId: "never" })) });
      const elapsed = Date.now() - started;
      expect(res.claimed).toBe(0);
      expect(elapsed).toBeLessThan(5_000);
      const claimErr = reportErrorMock.mock.calls.find(([ctx]) => ctx === "outbox-claim");
      expect(claimErr, JSON.stringify(reportErrorMock.mock.calls.map((c) => c[0]))).toBeDefined();
      expect(String((claimErr![1] as Error).message)).toMatch(/statement timeout|57014/i);
    } finally {
      release();
      await holder;
    }
  });

  it("KONTROL: kilit yokken tavan talebi bozmaz (vadesi gelmiş satır talep edilir)", async () => {
    __claimTimeouts.statementMs = 400;
    const due = await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "due-1", status: "pending", availableAt: new Date(Date.now() - 60_000), messageType: "manual" },
    });
    const send: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "p-1" }));
    const res = await drainOutboxOnce({ skipRecover: true, skipHeal: true, send, tokenFor: async () => "t" });
    expect(res.claimed).toBe(1);
    expect(reportErrorMock.mock.calls.find(([ctx]) => ctx === "outbox-claim")).toBeUndefined();
    await prisma.messageOutbox.delete({ where: { id: due.id } });
  });
});
