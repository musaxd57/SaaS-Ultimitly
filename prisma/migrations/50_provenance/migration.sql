-- V0.4 PROVENANCE (additive, nullable, no default, no FK, no index):
--   Reservation/Conversation/Message.connectionId = the PROVEN ChannelConnection: written at ingest,
--     or filled (NULL -> X only) when a later sync actually observes the row through X. Never
--     X -> Y, never X -> NULL, no inference backfill: legacy rows stay NULL (= unknown).
--   Reservation/Conversation/Message.ingestedAt   = FIRST ingest (row created by an ingress);
--     immutable. NULL = legacy or host-entered. Not a freshness stamp.
-- Pure catalog change on a populated table (no rewrite, no default evaluation).

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);
