-- Smart operational-task routing from guest messages (Faz A). All ADDITIVE:
--   • Task.sourceMessageId / Task.dedupeKey — two NULLABLE columns (no default),
--     safe on the populated Task table (no required-without-default, no @unique).
--   • Organization.autoTaskFromMessageEnabled — BOOLEAN NOT NULL DEFAULT false, so
--     Postgres backfills existing rows with false (opt-in; OFF = today's behavior).
--   • Task_dedupeKey_idx — plain index for the intra-day dedupe lookup.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "sourceMessageId" TEXT,
ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoTaskFromMessageEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_dedupeKey_idx" ON "Task"("dedupeKey");
