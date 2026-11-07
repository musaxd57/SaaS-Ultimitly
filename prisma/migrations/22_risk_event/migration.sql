-- RiskEvent (Codex #32): append-only decision history for the AI risk pipeline.
-- One row per FINAL deterministic code decision (gate verdict / keyword
-- escalation) — never raw model output, never guest text/PII. Reports read the
-- last 30 days from here instead of the mutable Conversation snapshot.
-- NO BACKFILL by design: fabricating history from snapshots would be fake data;
-- the report discloses that counting starts at activation.
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "conversationId" TEXT,
    "surface" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "finalDecision" TEXT NOT NULL,
    "riskLevel" TEXT,
    "riskType" TEXT,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- Retry-idempotency, TENANT-SCOPED: a re-run of the same decision for the same
-- trigger cannot double-log; a legitimate later transition (held -> sent) still
-- records. organizationId is part of the key on purpose: triggerId is a cuid
-- today, but a future surface may use provider message ids, and two tenants can
-- legitimately carry the same provider id string.
CREATE UNIQUE INDEX "RiskEvent_organizationId_surface_triggerId_finalDecision_key" ON "RiskEvent"("organizationId", "surface", "triggerId", "finalDecision");

-- Tenant-scoped 30-day report aggregation path.
CREATE INDEX "RiskEvent_organizationId_occurredAt_idx" ON "RiskEvent"("organizationId", "occurredAt");

-- KVKK: account erasure cascades the whole history with the organization.
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
