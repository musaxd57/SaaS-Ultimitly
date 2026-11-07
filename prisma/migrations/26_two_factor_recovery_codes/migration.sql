-- FAZ 4 (Codex #20): 2FA single-use recovery codes. NEW TABLE ONLY (additive,
-- populated tables untouched, boot cannot fail). Rows hold sha256 HASHES —
-- plaintext codes exist only in the one-time generation response. usedAt is
-- the atomic single-use burn flag; the User FK cascades on account erasure.

-- CreateTable
CREATE TABLE "TwoFactorRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TwoFactorRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoFactorRecoveryCode_userId_idx" ON "TwoFactorRecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorRecoveryCode_userId_codeHash_key" ON "TwoFactorRecoveryCode"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "TwoFactorRecoveryCode" ADD CONSTRAINT "TwoFactorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
