-- CreateTable
CREATE TABLE "ErasureTombstone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasureTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureTombstone_organizationId_idx" ON "ErasureTombstone"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureTombstone_organizationId_keyHash_key" ON "ErasureTombstone"("organizationId", "keyHash");

-- AddForeignKey
ALTER TABLE "ErasureTombstone" ADD CONSTRAINT "ErasureTombstone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

