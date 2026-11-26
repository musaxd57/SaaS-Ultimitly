-- CreateTable
CREATE TABLE "ConversationBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'conversation',
    "itemId" TEXT,
    "sourceMessageId" TEXT,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "openedBy" TEXT NOT NULL DEFAULT 'system',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationBlock_conversationId_status_idx" ON "ConversationBlock"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ConversationBlock_organizationId_status_idx" ON "ConversationBlock"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationBlock_conversationId_kind_sourceMessageId_key" ON "ConversationBlock"("conversationId", "kind", "sourceMessageId");

-- AddForeignKey
ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

