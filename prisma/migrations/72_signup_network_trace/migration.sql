-- K1 (kurucu 10-17: B - otomatik kesme yok; risk puani + IP sinyali). Dolu tabloya (Organization) yalniz BOS kolon + yeni tablo: acilista
-- patlama yolu yok. HAM IP saklanmaz (yalniz anahtarli ozet); yazici SIGNUP_NETWORK_TRACE_ENABLED arkasinda KAPALI.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trialIdentityReusedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SignupNetworkTrace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "ipHash" TEXT,
    "networkHash" TEXT,
    "networkKind" TEXT,
    "keyFp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupNetworkTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignupNetworkTrace_ipHash_createdAt_idx" ON "SignupNetworkTrace"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "SignupNetworkTrace_networkHash_createdAt_idx" ON "SignupNetworkTrace"("networkHash", "createdAt");

-- CreateIndex
CREATE INDEX "SignupNetworkTrace_organizationId_idx" ON "SignupNetworkTrace"("organizationId");

-- CreateIndex
CREATE INDEX "SignupNetworkTrace_expiresAt_idx" ON "SignupNetworkTrace"("expiresAt");

-- AddForeignKey
ALTER TABLE "SignupNetworkTrace" ADD CONSTRAINT "SignupNetworkTrace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

