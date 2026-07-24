-- Stock tracking + guest extra-supply requests. All ADDITIVE:
--   • Organization.supplyStockJson — one NULLABLE TEXT column (on-hand stock JSON).
--   • SupplyRequest — a brand-NEW table (no ALTER on a populated table); cascades
--     with the property, reservation link SetNull.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "supplyStockJson" TEXT;

-- CreateTable
CREATE TABLE "SupplyRequest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "itemKey" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyRequest_propertyId_createdAt_idx" ON "SupplyRequest"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyRequest_sourceMessageId_idx" ON "SupplyRequest"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
