-- Message authorship: a RELIABLE, typed classifier for WHO authored a message,
-- safe to drive security/state decisions off. `senderName` stays DISPLAY/AUDIT only
-- (a host-controlled string that must never decide state). Additive & transition-safe:
-- both columns are NULLABLE (populated table + old-code INSERT compat during a rolling
-- deploy), then a DETERMINISTIC backfill from the existing reliable signals
-- (direction + the legacy senderName markers). Mirrors deriveMessageAuthor().

-- 1) Add the columns — nullable, no default → safe ALTER on a full table.
ALTER TABLE "Message" ADD COLUMN "authorType" TEXT;
ALTER TABLE "Message" ADD COLUMN "systemEventType" TEXT;

-- 2) Backfill. Order matters: the system resume marker is a SUBSET of "outbound",
--    so classify it BEFORE the generic AI / host buckets. Every UPDATE is guarded by
--    `authorType IS NULL`, so the block is idempotent — it can be re-run as healing
--    and never overwrites a value newer code has already written.
UPDATE "Message" SET "authorType" = 'guest'
  WHERE "direction" = 'inbound' AND "authorType" IS NULL;

UPDATE "Message" SET "authorType" = 'system', "systemEventType" = 'guest_chat_ai_resumed'
  WHERE "direction" = 'outbound' AND "senderName" = '__lixus_ai_resumed__' AND "authorType" IS NULL;

UPDATE "Message" SET "authorType" = 'ai'
  WHERE "direction" = 'outbound' AND "senderName" IN ('GuestOps AI', 'Lixus AI') AND "authorType" IS NULL;

UPDATE "Message" SET "authorType" = 'host'
  WHERE "direction" = 'outbound' AND "authorType" IS NULL;
