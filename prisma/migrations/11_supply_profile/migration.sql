-- Per-property supply/linen prep profile (Faz A companion). ADDITIVE: one NULLABLE
-- TEXT column on Property holding a JSON object { supplyItemKey: qtyPerArrival }.
-- No default, no @unique, safe on the populated Property table.

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "supplyProfileJson" TEXT;
