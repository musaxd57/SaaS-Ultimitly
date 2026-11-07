-- V0.6 INGEST EVENT: versioned domain event / transactional outbox. New table only (additive);
-- PII-free by design (no guest text/name, no provider identifiers): tenant, provider, connection,
-- entity type + our own row id, kind, schema version, time. Org delete cascades.

-- CreateTable
CREATE TABLE "IngestEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "IngestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestEvent_organizationId_occurredAt_idx" ON "IngestEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "IngestEvent_entityType_entityId_idx" ON "IngestEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "IngestEvent" ADD CONSTRAINT "IngestEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

