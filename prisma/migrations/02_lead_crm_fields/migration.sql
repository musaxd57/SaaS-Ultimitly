-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "followUpAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'new';
