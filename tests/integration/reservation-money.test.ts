import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Faz-A Float→Decimal (Codex #26): dual-write on every money writer, Dec-first
// reads, Decimal arithmetic in reports (the ONE real float-accumulation site),
// idempotent cutover healing, and a reconciliation invariant.

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { toAmountDec, reservationAmount, reservationAmountNumber } from "@/lib/money";
import { POST as createReservation } from "@/app/api/reservations/route";
import { getMonthlyReport } from "@/lib/reports";

const noCtx = { params: Promise.resolve({} as Record<string, never>) };

/** The reconciliation invariant (also the prod query): 0 mismatching rows. */
async function reconciliationMismatches(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) n FROM "Reservation"
    WHERE ("totalAmount" IS NOT NULL
           AND "totalAmount" NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)
           AND abs("totalAmount") < 1e10)
      AND ("totalAmountDec" IS NULL OR round("totalAmount"::numeric, 2) <> "totalAmountDec")`;
  return Number(rows[0].n);
}

describe("reservation money Faz-A (Float → Decimal shadow)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toAmountDec: exact shortest-repr parse; NaN/Inf/out-of-capacity → null; 0 stays 0", () => {
    expect(toAmountDec(2537.53)!.toString()).toBe("2537.53"); // no float noise copied in
    expect(toAmountDec(0)!.toString()).toBe("0");
    expect(toAmountDec(100_000_000)!.toString()).toBe("100000000"); // validator cap fits 12,2
    expect(toAmountDec(NaN)).toBeNull();
    expect(toAmountDec(Infinity)).toBeNull();
    expect(toAmountDec(1e10)).toBeNull(); // beyond DECIMAL(12,2) — never silently bent
    expect(toAmountDec(null)).toBeNull();
  });

  it("read preference: Dec wins over a drifted Float; Float-only rows still read", () => {
    const dec = new Prisma.Decimal("100.10");
    expect(reservationAmount({ totalAmount: 999, totalAmountDec: dec })!.toString()).toBe("100.1");
    expect(reservationAmount({ totalAmount: 55.5, totalAmountDec: null })!.toString()).toBe("55.5");
    expect(reservationAmountNumber({ totalAmount: null, totalAmountDec: null })).toBeNull();
  });

  it("WRITER manual POST: dual-writes both columns in one create (negative rejected by zod)", async () => {
    const res = await createReservation(
      new NextRequest("http://localhost/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          guestName: "Ada",
          arrivalDate: daysFromNow(1).toISOString(),
          departureDate: daysFromNow(3).toISOString(),
          channel: "direct",
          status: "confirmed",
          totalAmount: 1617.2,
          currency: "EUR",
        }),
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(row.totalAmount).toBe(1617.2);
    expect(row.totalAmountDec!.toString()).toBe("1617.2");
    expect(await reconciliationMismatches()).toBe(0);

    const neg = await createReservation(
      new NextRequest("http://localhost/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          guestName: "Ada",
          arrivalDate: daysFromNow(1).toISOString(),
          departureDate: daysFromNow(3).toISOString(),
          channel: "direct",
          status: "confirmed",
          totalAmount: -50, // zod min(0) — refunds are not a reservation amount
          currency: "EUR",
        }),
      }),
      noCtx,
    );
    expect(neg.status).toBe(400);
  });

  it("REPORT SUM is exact Decimal arithmetic: 0.1 + 0.2 = 0.3 (red-first vs float loop)", async () => {
    const mk = (amt: number, cur: string) =>
      prisma.reservation.create({
        data: {
          propertyId,
          guestName: "G",
          arrivalDate: new Date(),
          departureDate: daysFromNow(1),
          channel: "direct",
          status: "confirmed",
          totalAmount: amt,
          totalAmountDec: toAmountDec(amt),
          currency: cur,
        },
      });
    await mk(0.1, "TRY");
    await mk(0.2, "TRY");
    await mk(1901.25, "USD"); // currency separation — never mixed into TRY

    const report = await getMonthlyReport(orgId);
    const total = (cur: string) => report.revenueByCurrency.find((r) => r.currency === cur)?.total;
    expect(total("TRY")).toBe(0.3); // EXACT — the old float loop produced 0.30000000000000004
    expect(total("USD")).toBe(1901.25); // currency separation intact
  });

  it("HEALING: a Float-only row written by the OLD deployment gets backfilled idempotently", async () => {
    // Simulate the cutover gap: raw insert bypassing dual-write (old app shape).
    await prisma.$executeRaw`
      INSERT INTO "Reservation"(id,"propertyId","guestName","arrivalDate","departureDate",channel,status,"totalAmount",currency,"updatedAt")
      VALUES ('old-row', ${propertyId}, 'Eski', now(), now() + interval '1 day', 'direct', 'confirmed', 250.5, 'TRY', now())`;
    expect(await reconciliationMismatches()).toBe(1);

    // The exact healing statement the deep-sync pass runs (NaN-safe: PG treats
    // NaN = NaN as TRUE, so non-finites are excluded BY NAME, never by self-equality).
    const heal = () => prisma.$executeRaw`
      UPDATE "Reservation"
      SET "totalAmountDec" = round("totalAmount"::numeric, 2)
      WHERE "totalAmount" IS NOT NULL
        AND "totalAmountDec" IS NULL
        AND "totalAmount" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
        AND abs("totalAmount") < 1e10`;
    expect(await heal()).toBe(1);
    expect(await heal()).toBe(0); // idempotent
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: "old-row" } });
    expect(row.totalAmountDec!.toString()).toBe("250.5");
    expect(await reconciliationMismatches()).toBe(0);
  });

  it("NaN-quirk pin: PG evaluates NaN = NaN as TRUE — the by-name exclusion really filters it", async () => {
    await prisma.$executeRaw`
      INSERT INTO "Reservation"(id,"propertyId","guestName","arrivalDate","departureDate",channel,status,"totalAmount",currency,"updatedAt")
      VALUES ('nan-row', ${propertyId}, 'NaN', now(), now() + interval '1 day', 'direct', 'confirmed', 'NaN'::float8, 'TRY', now())`;
    const trap = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) n FROM "Reservation" WHERE id='nan-row' AND "totalAmount" = "totalAmount"`;
    expect(Number(trap[0].n)).toBe(1); // self-equality does NOT filter NaN in PG
    await prisma.$executeRaw`
      UPDATE "Reservation" SET "totalAmountDec" = round("totalAmount"::numeric, 2)
      WHERE id='nan-row' AND "totalAmount" NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)`;
    // Raw read: the Prisma client itself refuses to deserialize a NaN Float row.
    const rows = await prisma.$queryRaw<{ dec: string | null }[]>`
      SELECT "totalAmountDec"::text AS dec FROM "Reservation" WHERE id='nan-row'`;
    expect(rows[0].dec).toBeNull(); // by-name exclusion held
  });
});
