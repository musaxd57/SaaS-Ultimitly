-- Faz 5 (#14): per-reservation QR concierge PIN. ADDITIVE ONLY — every new
-- column is either nullable or NOT NULL WITH A DEFAULT, so it is safe on the
-- populated Reservation/Organization tables and an old deployment that never
-- writes these columns simply reads NULL / the default. The whole feature is
-- env-gated (QR_PIN_ENABLED, default OFF); the PIN itself is stored ONLY as an
-- HMAC hash (never plaintext) and this migration adds no data.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "qrChatPinRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "chatPinFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "chatPinHash" TEXT,
ADD COLUMN     "chatPinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "chatPinSetAt" TIMESTAMP(3);
