import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Faz-A money helpers (Codex #26, expand/contract). Reservation.totalAmountDec
// (DECIMAL(12,2)) is the authoritative-in-waiting twin of the legacy Float:
//  * every writer DUAL-WRITES both fields in the SAME create/update (one row
//    write = atomic by construction — no partial money state is possible);
//  * every reader prefers the Decimal and falls back to the Float (rows written
//    by the OLD deployment during cutover, healed later by the deep-sync pass);
//  * arithmetic stays in Prisma.Decimal — converting to Number is allowed ONLY
//    at the final display/serialization boundary, never for math.
// ---------------------------------------------------------------------------

/** Decimal twin for a float amount. `new Decimal(number)` parses the number's
 *  shortest round-trip representation, so 2537.53 becomes exactly "2537.53" —
 *  no float noise is copied in. Non-finite / out-of-DECIMAL(12,2)-range values
 *  yield null (same exclusions as the migration backfill; never silently bent). */
export function toAmountDec(v: number | null | undefined): Prisma.Decimal | null {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= 1e10) return null;
  return new Prisma.Decimal(v).toDecimalPlaces(2);
}

type MoneyRow = { totalAmount: number | null; totalAmountDec: Prisma.Decimal | null };

/** Read-preference: Decimal if present, else the legacy Float (as Decimal). */
export function reservationAmount(r: MoneyRow): Prisma.Decimal | null {
  if (r.totalAmountDec != null) return r.totalAmountDec;
  return toAmountDec(r.totalAmount);
}

/** DISPLAY/SERIALIZATION-ONLY number for UI + e-mail formatting (a 2-dp value
 *  round-trips exactly). NEVER use the result for arithmetic. */
export function reservationAmountNumber(r: MoneyRow): number | null {
  const d = reservationAmount(r);
  return d == null ? null : d.toNumber();
}
