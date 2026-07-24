-- Durable Outbox (#8): a persistent, claim-safe queue for outbound guest-channel
-- sends. Purely ADDITIVE — a new, empty table + its indexes + one FK to Organization
-- (ON DELETE CASCADE = KVKK / account erasure). Nothing existing is touched, so an
-- old deployment that doesn't know this table keeps working unchanged; the outbox is
-- inert until DURABLE_OUTBOX_ENABLED is switched on.

-- CreateTable
CREATE TABLE "MessageOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "reservationId" TEXT,
    "channel" TEXT NOT NULL,
    "externalReservationId" TEXT,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "providerMessageId" TEXT,
    "lastErrorKind" TEXT,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageOutbox_status_availableAt_idx" ON "MessageOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "MessageOutbox_organizationId_status_idx" ON "MessageOutbox"("organizationId", "status");

-- CreateIndex (tenant-scoped idempotency: one outbox row per logical message per tenant)
CREATE UNIQUE INDEX "MessageOutbox_organizationId_idempotencyKey_key" ON "MessageOutbox"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "MessageOutbox" ADD CONSTRAINT "MessageOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
