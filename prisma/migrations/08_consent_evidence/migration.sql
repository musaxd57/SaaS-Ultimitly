-- KVKK consent EVIDENCE: capture which legal version was accepted and the request
-- IP / User-Agent at sign-up, plus a separate privacy-acceptance timestamp. All
-- four columns are NULLABLE (no NOT NULL, no DEFAULT) → safe on the populated
-- "User" table; existing accounts get NULL and stay valid (never blocked at login).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptedIp" TEXT,
ADD COLUMN     "acceptedLegalVersion" TEXT,
ADD COLUMN     "acceptedUserAgent" TEXT,
ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3);
