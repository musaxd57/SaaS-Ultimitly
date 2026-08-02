-- CreateTable
CREATE TABLE "PasswordResetChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetChallenge_tokenHash_key" ON "PasswordResetChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetChallenge_userId_createdAt_idx" ON "PasswordResetChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetChallenge_expiresAt_idx" ON "PasswordResetChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordResetChallenge" ADD CONSTRAINT "PasswordResetChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

