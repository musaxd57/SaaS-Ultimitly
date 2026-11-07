-- CreateIndex
CREATE INDEX "MessageOutbox_conversationId_status_idx" ON "MessageOutbox"("conversationId", "status");

