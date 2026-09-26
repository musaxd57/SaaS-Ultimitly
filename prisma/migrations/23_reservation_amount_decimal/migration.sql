-- Faz-A (expand) of Float->Decimal for reservation money (Codex #26).
-- ADDITIVE ONLY: the Float column is not dropped or renamed - during the
-- Railway cutover the OLD deployment keeps serving and writing Float rows;
-- new code dual-writes and reads Dec-first with Float fallback. A deep-sync
-- healing pass + reconciliation query close the cutover gap after Active.
-- DECIMAL(12,2): every supported currency is exponent-2 (TRY/EUR/USD), the
-- API validator already caps amounts at 1e8, and 12,2 leaves 100x headroom.
ALTER TABLE "Reservation" ADD COLUMN "totalAmountDec" DECIMAL(12,2);

-- Backfill with an EXPLICIT, preflight-approved round(,2). PG QUIRK: NaN = NaN
-- is TRUE in PostgreSQL, so a self-equality check does NOT filter NaN - the
-- non-finite values are excluded by name. Rows left NULL here (non-finite /
-- out-of-capacity) were counted in preflight and keep serving via the Float
-- fallback read.
UPDATE "Reservation"
SET "totalAmountDec" = round("totalAmount"::numeric, 2)
WHERE "totalAmount" IS NOT NULL
  AND "totalAmount" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
  AND abs("totalAmount") < 1e10;
