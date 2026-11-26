-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "priorityNeedsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prioritySource" TEXT;

