-- CreateTable
CREATE TABLE "RequestLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "holder" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "resultRef" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestLedger_expiresAt_idx" ON "RequestLedger"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestLedger_organizationId_scope_requestId_key" ON "RequestLedger"("organizationId", "scope", "requestId");

-- AddForeignKey
ALTER TABLE "RequestLedger" ADD CONSTRAINT "RequestLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

