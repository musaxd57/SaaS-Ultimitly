-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hospitableRefreshTokenEnc" TEXT,
ADD COLUMN     "hospitableTokenExpiresAt" TIMESTAMP(3);

