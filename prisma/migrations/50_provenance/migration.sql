-- V0.4 PROVENANCE (additive, nullable, no default, no FK, no index):
--   Reservation/Conversation/Message.connectionId  = ChannelConnection this row was ingested
--     through (or, for an outbound Message, queued under). NULL = legacy / non-provider ingress.
--   Reservation/Conversation/Message.ingestedAt    = last time an INGRESS wrote the row.
--     NULL = legacy or host-entered. Backfill never invents it.
--   ChannelConnection.provenanceBackfilledAt        = one-shot marker for the legacy backfill.
-- Pure catalog change on a populated table (no rewrite, no default evaluation).

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "provenanceBackfilledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3);
