-- AlterTable
ALTER TABLE "CalendarSource" ADD COLUMN     "lastFeedEventCount" INTEGER,
ADD COLUMN     "lastReconcileAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "feedFirstMissingAt" TIMESTAMP(3),
ADD COLUMN     "feedLastSeenAt" TIMESTAMP(3),
ADD COLUMN     "feedMissingCount" INTEGER;

