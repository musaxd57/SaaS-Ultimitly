-- Opt-in gate + DB-level dedup for guest supply requests.
--   • Organization.autoSupplyRequestEnabled — BOOLEAN NOT NULL DEFAULT false. This
--     is an ALTER TABLE ADD COLUMN on the populated Organization table; with a
--     constant default it is metadata-only (Postgres 11+ backfills lazily) → safe.
--   • Deduplicate any (sourceMessageId, itemKey) rows created before the unique
--     existed (feature shipped ungated for a short window), keeping the earliest,
--     so the unique index below can be created without failing.
--   • Unique index on (sourceMessageId, itemKey). SupplyRequest is a NEW table →
--     safe; NULL sourceMessageId rows stay distinct in Postgres.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoSupplyRequestEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Drop pre-unique duplicates (keep the earliest physical row per key pair).
DELETE FROM "SupplyRequest" a
USING "SupplyRequest" b
WHERE a."sourceMessageId" IS NOT NULL
  AND a."sourceMessageId" = b."sourceMessageId"
  AND a."itemKey" = b."itemKey"
  AND a.ctid > b.ctid;

-- The composite unique's leading column (sourceMessageId) serves the dedup lookup,
-- so the standalone index created in migration 12 is now redundant.
-- DropIndex
DROP INDEX "SupplyRequest_sourceMessageId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SupplyRequest_sourceMessageId_itemKey_key" ON "SupplyRequest"("sourceMessageId", "itemKey");
