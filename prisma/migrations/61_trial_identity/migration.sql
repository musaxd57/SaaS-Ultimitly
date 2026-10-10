-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trialIdentityExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "trialEndReason" TEXT;

-- CreateTable
CREATE TABLE "TrialIdentity" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "firstOrganizationId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialIdentity_keyHash_key" ON "TrialIdentity"("keyHash");

-- CreateIndex
CREATE INDEX "TrialIdentity_firstOrganizationId_idx" ON "TrialIdentity"("firstOrganizationId");

-- CreateIndex
CREATE INDEX "TrialIdentity_lastSeenAt_idx" ON "TrialIdentity"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "TrialIdentity" ADD CONSTRAINT "TrialIdentity_firstOrganizationId_fkey" FOREIGN KEY ("firstOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

