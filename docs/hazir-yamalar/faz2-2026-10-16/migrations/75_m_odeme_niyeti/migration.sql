-- CreateTable
CREATE TABLE "CheckoutIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL,
    "openKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_providerRef_key" ON "CheckoutIntent"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_openKey_key" ON "CheckoutIntent"("openKey");

-- CreateIndex
CREATE INDEX "CheckoutIntent_organizationId_createdAt_idx" ON "CheckoutIntent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutIntent_status_expiresAt_idx" ON "CheckoutIntent"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "CheckoutIntent" ADD CONSTRAINT "CheckoutIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutIntent" ADD CONSTRAINT "CheckoutIntent_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "CheckoutConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

