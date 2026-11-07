-- AlterTable
ALTER TABLE "CheckoutConsent" ADD COLUMN     "legalTextHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptedLegalTextHash" TEXT;

