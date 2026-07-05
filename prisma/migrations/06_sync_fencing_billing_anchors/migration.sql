-- Sync lock fencing token + Paddle billing stable anchors.
-- All additive, nullable columns — safe on the populated Subscription / SystemLock
-- tables (no @unique, no NOT NULL-without-default, no drops).

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "pastDueSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SystemLock" ADD COLUMN     "holder" TEXT;
