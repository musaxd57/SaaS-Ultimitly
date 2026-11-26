-- Kurucu 11-13 (migration onaylı): taslak ↔ ev sahibinin gönderdiği metin bağı — YALNIZ yeni iki tablo + index (dolu tabloya dokunmaz).
-- Tasarım: docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md

-- CreateTable
CREATE TABLE "ReplyDraftLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "anchorMessageId" TEXT NOT NULL,
    "sentMessageId" TEXT NOT NULL,
    "linkKind" TEXT NOT NULL,
    "intent" TEXT,
    "draftEnc" TEXT,
    "draftHash" TEXT,
    "lexicalSim" DOUBLE PRECISION NOT NULL,
    "tokensAdded" INTEGER NOT NULL,
    "tokensRemoved" INTEGER NOT NULL,
    "valueChanged" BOOLEAN NOT NULL,
    "removedSentence" BOOLEAN NOT NULL,
    "maxAddedRun" INTEGER NOT NULL,
    "diffTruncated" BOOLEAN NOT NULL DEFAULT false,
    "editKindsJson" TEXT NOT NULL,
    "diffEnc" TEXT,
    "outcome" TEXT NOT NULL,
    "classifierVersion" INTEGER NOT NULL,
    "semanticSim" DOUBLE PRECISION,
    "embeddingModel" TEXT,
    "embeddingState" TEXT NOT NULL DEFAULT 'pending',
    "embeddingAttempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "measuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyDraftLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyDraftSpan" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "conversationId" TEXT NOT NULL,
    "textEnc" TEXT NOT NULL,
    "contentTokens" INTEGER NOT NULL,
    "hasSecret" BOOLEAN NOT NULL DEFAULT false,
    "vector" BYTEA,
    "dims" INTEGER,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplyDraftSpan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplyDraftLink_anchorMessageId_key" ON "ReplyDraftLink"("anchorMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyDraftLink_sentMessageId_key" ON "ReplyDraftLink"("sentMessageId");

-- CreateIndex
CREATE INDEX "ReplyDraftLink_organizationId_sentAt_idx" ON "ReplyDraftLink"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "ReplyDraftLink_conversationId_idx" ON "ReplyDraftLink"("conversationId");

-- CreateIndex
CREATE INDEX "ReplyDraftLink_embeddingState_createdAt_idx" ON "ReplyDraftLink"("embeddingState", "createdAt");

-- CreateIndex
CREATE INDEX "ReplyDraftSpan_organizationId_propertyId_createdAt_idx" ON "ReplyDraftSpan"("organizationId", "propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplyDraftSpan_linkId_idx" ON "ReplyDraftSpan"("linkId");

-- AddForeignKey
ALTER TABLE "ReplyDraftLink" ADD CONSTRAINT "ReplyDraftLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraftLink" ADD CONSTRAINT "ReplyDraftLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraftSpan" ADD CONSTRAINT "ReplyDraftSpan_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ReplyDraftLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

