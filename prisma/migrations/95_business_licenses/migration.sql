-- 95 — İŞLETME BELGESİ (Faz 1a; kurucu 11-06 "Faz1a'ya başla, migration onayım var"; tasarım
-- docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md §10). YALNIZ EKLEME: dört YENİ tablo + dizinler + yabancı anahtarlar;
-- dolu hiçbir tabloya sütun / zorunlu alan / eşsizlik eklenmez, hiçbir şey düşürülmez. Geri alma: dört tablo DROP (başka tablo bunlara
-- bağlı değil). Bekçi sütunları (`verifiedGuard`, `lockKey`) boş bırakılabilir `UNIQUE` — kısmi dizin YOK (Membership deseni).
-- CreateTable
CREATE TABLE "LicenseHolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalNameNorm" TEXT NOT NULL,
    "taxIdHash" TEXT NOT NULL,
    "taxIdEnc" TEXT,
    "taxIdLast2" TEXT NOT NULL,
    "verifiedGuard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseHolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessLicense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "numberNorm" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "suspendReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lockKey" TEXT,
    "pendingUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastRegistryOkAt" TIMESTAMP(3),
    "lastRegistrySource" TEXT,
    "registryNameNorm" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseUnit" (
    "licenseId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseUnit_pkey" PRIMARY KEY ("licenseId","propertyId")
);

-- CreateTable
CREATE TABLE "LicenseEvent" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseHolder_verifiedGuard_key" ON "LicenseHolder"("verifiedGuard");

-- CreateIndex
CREATE INDEX "LicenseHolder_taxIdHash_idx" ON "LicenseHolder"("taxIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseHolder_organizationId_taxIdHash_key" ON "LicenseHolder"("organizationId", "taxIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLicense_lockKey_key" ON "BusinessLicense"("lockKey");

-- CreateIndex
CREATE INDEX "BusinessLicense_organizationId_status_idx" ON "BusinessLicense"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BusinessLicense_holderId_idx" ON "BusinessLicense"("holderId");

-- CreateIndex
CREATE INDEX "BusinessLicense_type_numberNorm_idx" ON "BusinessLicense"("type", "numberNorm");

-- CreateIndex
CREATE INDEX "LicenseUnit_propertyId_idx" ON "LicenseUnit"("propertyId");

-- CreateIndex
CREATE INDEX "LicenseEvent_licenseId_createdAt_idx" ON "LicenseEvent"("licenseId", "createdAt");

-- CreateIndex
CREATE INDEX "LicenseEvent_organizationId_createdAt_idx" ON "LicenseEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "LicenseHolder" ADD CONSTRAINT "LicenseHolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessLicense" ADD CONSTRAINT "BusinessLicense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessLicense" ADD CONSTRAINT "BusinessLicense_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "LicenseHolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseUnit" ADD CONSTRAINT "LicenseUnit_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "BusinessLicense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseUnit" ADD CONSTRAINT "LicenseUnit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvent" ADD CONSTRAINT "LicenseEvent_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "BusinessLicense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

