-- Subscription.customerId: the Paddle customer id, stored by the webhook only for
-- events whose org was resolved AUTHORITATIVELY (consent / providerRef). KVKK
-- erasure attributes Paddle-generated customer.* events through THIS (they carry
-- no custom_data), so it can never learn another tenant's customer id.
-- Nullable ADD COLUMN, no default -> metadata-only, safe on a populated table.
ALTER TABLE "Subscription" ADD COLUMN     "customerId" TEXT;

-- Pre-dedup before the unique constraint: keep the OLDEST Invoice per
-- (provider, providerRef) pair (by issuedAt, then id, for determinism). NULL
-- providerRef rows are untouched -- Postgres unique treats NULLs as distinct,
-- and the webhook never creates rows without a providerRef anyway.
DELETE FROM "Invoice" a
USING "Invoice" b
WHERE a."provider" = b."provider"
  AND a."providerRef" = b."providerRef"
  AND a."providerRef" IS NOT NULL
  AND (a."issuedAt" > b."issuedAt" OR (a."issuedAt" = b."issuedAt" AND a."id" > b."id"));

-- One Invoice per provider transaction: DB-level idempotency the webhook's old
-- findFirst-then-create couldn't guarantee under concurrent delivery (D1).
CREATE UNIQUE INDEX "Invoice_provider_providerRef_key" ON "Invoice"("provider", "providerRef");
