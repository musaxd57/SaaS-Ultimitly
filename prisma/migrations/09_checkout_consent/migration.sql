-- Distance-selling (Mesafeli Satış) consent evidence captured at CHECKOUT: the
-- server-side counterpart to the client checkbox. A brand-NEW table → zero risk
-- to existing tables (no ALTER on a populated table). Cascades away with the org
-- on erasure (like Invoice/Subscription); userId SetNull if that user is removed.

-- CreateTable
CREATE TABLE "CheckoutConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "planCode" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "legalVersion" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutConsent_organizationId_idx" ON "CheckoutConsent"("organizationId");

-- AddForeignKey
ALTER TABLE "CheckoutConsent" ADD CONSTRAINT "CheckoutConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutConsent" ADD CONSTRAINT "CheckoutConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
