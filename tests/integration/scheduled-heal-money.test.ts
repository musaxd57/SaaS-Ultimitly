import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// Codex #26 cutover-healing POSITION proof: our own Hospitable subscription is
// currently inactive (402), so the per-org sync body is skipped — the healing
// pass must run BEFORE any Hospitable/premium/deep gating so Float-only rows
// (written by the OLD deployment during cutover) still get their Decimal twin.

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
// Every org's Hospitable sync fails with the real-world 402 (subscription
// inactive) — exactly today's production state for the primary org.
vi.mock("@/lib/hospitable-sync", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable-sync")>();
  const { HospitableError } = await import("@/lib/hospitable");
  return {
    ...actual,
    syncHospitable: vi.fn(async () => {
      throw new HospitableError("Subscription not active", 402);
    }),
  };
});

import { runScheduledSync } from "@/lib/scheduled-sync";

async function insertFloatOnlyRow(id: string, propertyId: string, amount: number) {
  // Old-deployment shape: raw insert bypassing dual-write (no Decimal column).
  await prisma.$executeRaw`
    INSERT INTO "Reservation"(id,"propertyId","guestName","arrivalDate","departureDate",channel,status,"totalAmount",currency,"updatedAt")
    VALUES (${id}, ${propertyId}, 'Eski', now(), now() + interval '1 day', 'direct', 'confirmed', ${amount}, 'TRY', now())`;
}

async function reconciliationMismatches(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) n FROM "Reservation"
    WHERE ("totalAmount" IS NOT NULL
           AND "totalAmount" NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)
           AND abs("totalAmount") < 1e10)
      AND ("totalAmountDec" IS NULL OR round("totalAmount"::numeric, 2) <> "totalAmountDec")`;
  return Number(rows[0].n);
}

describe("scheduled-sync amount healing runs despite Hospitable 402", () => {
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("402-skipped org still gets healed; a narrow (non-deep) second pass heals too; idempotent; reconciliation 0", async () => {
    await insertFloatOnlyRow("cut-1", propertyId, 250.5);
    expect(await reconciliationMismatches()).toBe(1);

    // PASS 1 (first ever run → claims the deep slot). Org sync throws 402 —
    // healing must have already run before the org loop.
    const first = await runScheduledSync();
    expect(first.ok).toBe(true);
    const r1 = await prisma.reservation.findUniqueOrThrow({ where: { id: "cut-1" } });
    expect(r1.totalAmountDec!.toString()).toBe("250.5");
    expect(await reconciliationMismatches()).toBe(0);

    // PASS 2 is NARROW (deep slot just claimed): a Float-only row appearing
    // between passes must STILL heal — proves the healer is not deep-gated and
    // sits before every early skip. Also proves idempotency on cut-1.
    await insertFloatOnlyRow("cut-2", propertyId, 99.9);
    const second = await runScheduledSync();
    expect(second.ok).toBe(true);
    const r2 = await prisma.reservation.findUniqueOrThrow({ where: { id: "cut-2" } });
    expect(r2.totalAmountDec!.toString()).toBe("99.9");
    // cut-1 untouched (WHERE Dec IS NULL → second pass changed 0 rows for it).
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: "cut-1" } })).totalAmountDec!.toString()).toBe("250.5");
    expect(await reconciliationMismatches()).toBe(0);
  });
});
