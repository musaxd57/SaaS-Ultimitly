-- iCal privacy: hide the guest name in the public calendar feed by default.
-- NOT NULL WITH a DEFAULT → Postgres backfills existing rows with false, so this
-- is safe on the populated Organization table (no required-without-default).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "icalShowGuestName" BOOLEAN NOT NULL DEFAULT false;
