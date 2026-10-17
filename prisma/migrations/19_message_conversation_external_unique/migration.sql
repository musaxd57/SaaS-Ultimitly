-- The DB becomes the dedupe arbiter for imported provider messages. Prod was
-- cleaned first (1044 exact-duplicate pairs removed, verified 0 remaining).
-- Replaces the plain composite index (redundant under the unique one).
DROP INDEX "Message_conversationId_externalId_idx";
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");
