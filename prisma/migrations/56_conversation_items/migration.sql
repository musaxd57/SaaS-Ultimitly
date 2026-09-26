-- 56 — KONUŞMA ÖĞESİ (ConversationItem, 09-26, kurucu kararları; tasarım docs/TASARIM-2026-09-26-konusma-ogeleri.md).
-- YENİ TABLO: dolu hiçbir tabloya kolon/unique/drop eklenmez (boot migrate deploy güvenli). Metin/PII YOK.
-- Geri alma: DROP TABLE "ConversationItem"; (başka tablo bu tabloya bağlı değil).

-- CreateTable
CREATE TABLE "ConversationItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "requestIndex" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'none',
    "riskType" TEXT,
    "sources" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notifiedAt" TIMESTAMP(3),
    "answeredByMessageId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationItem_organizationId_status_idx" ON "ConversationItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ConversationItem_conversationId_status_idx" ON "ConversationItem"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationItem_conversationId_messageId_kind_key" ON "ConversationItem"("conversationId", "messageId", "kind");

-- AddForeignKey
ALTER TABLE "ConversationItem" ADD CONSTRAINT "ConversationItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationItem" ADD CONSTRAINT "ConversationItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

