-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginDisabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StaffChannelBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "addressHash" TEXT,
    "addressEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "optInAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffChannelBinding_codeHash_idx" ON "StaffChannelBinding"("codeHash");

-- CreateIndex
CREATE INDEX "StaffChannelBinding_organizationId_status_idx" ON "StaffChannelBinding"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StaffChannelBinding_userId_idx" ON "StaffChannelBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChannelBinding_organizationId_provider_addressHash_key" ON "StaffChannelBinding"("organizationId", "provider", "addressHash");

-- AddForeignKey
ALTER TABLE "StaffChannelBinding" ADD CONSTRAINT "StaffChannelBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChannelBinding" ADD CONSTRAINT "StaffChannelBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

