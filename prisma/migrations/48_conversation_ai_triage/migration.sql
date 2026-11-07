-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "aiActionSuggestion" TEXT,
ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiMissingInfoJson" TEXT,
ADD COLUMN     "aiTriageSource" TEXT,
ADD COLUMN     "aiTriageTriggerMessageId" TEXT,
ADD COLUMN     "aiTriagedAt" TIMESTAMP(3);

