-- CreateTable
CREATE TABLE "HostChannelBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "addressEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifyCodeHash" TEXT,
    "verifyExpiresAt" TIMESTAMP(3),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "optInAt" TIMESTAMP(3),
    "optInTextVersion" TEXT,
    "userSessionEpoch" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bindingId" TEXT,
    "kind" TEXT NOT NULL,
    "turnMessageId" TEXT NOT NULL,
    "itemIdsJson" TEXT,
    "decisionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "previewMessageId" TEXT,
    "answerMessageId" TEXT,
    "answerEnc" TEXT,
    "draftEnc" TEXT,
    "draftHash" TEXT,
    "draftLang" TEXT,
    "composeCount" INTEGER NOT NULL DEFAULT 0,
    "resultMessageId" TEXT,
    "fallbackEmailAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HostChannelBinding_organizationId_status_idx" ON "HostChannelBinding"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HostChannelBinding_userId_idx" ON "HostChannelBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HostChannelBinding_provider_addressHash_key" ON "HostChannelBinding"("provider", "addressHash");

-- CreateIndex
CREATE UNIQUE INDEX "HostQuestion_providerMessageId_key" ON "HostQuestion"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "HostQuestion_previewMessageId_key" ON "HostQuestion"("previewMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "HostQuestion_answerMessageId_key" ON "HostQuestion"("answerMessageId");

-- CreateIndex
CREATE INDEX "HostQuestion_organizationId_status_idx" ON "HostQuestion"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HostQuestion_conversationId_status_idx" ON "HostQuestion"("conversationId", "status");

-- CreateIndex
CREATE INDEX "HostQuestion_bindingId_status_idx" ON "HostQuestion"("bindingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HostQuestion_organizationId_idempotencyKey_key" ON "HostQuestion"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "HostChannelBinding" ADD CONSTRAINT "HostChannelBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostChannelBinding" ADD CONSTRAINT "HostChannelBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostQuestion" ADD CONSTRAINT "HostQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostQuestion" ADD CONSTRAINT "HostQuestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

