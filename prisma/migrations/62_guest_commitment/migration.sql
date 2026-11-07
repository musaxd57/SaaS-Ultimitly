-- CreateTable
CREATE TABLE "GuestCommitment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestCommitment_organizationId_status_dueAt_idx" ON "GuestCommitment"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "GuestCommitment_conversationId_idx" ON "GuestCommitment"("conversationId");

-- CreateIndex
CREATE INDEX "GuestCommitment_taskId_idx" ON "GuestCommitment"("taskId");

-- AddForeignKey
ALTER TABLE "GuestCommitment" ADD CONSTRAINT "GuestCommitment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCommitment" ADD CONSTRAINT "GuestCommitment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCommitment" ADD CONSTRAINT "GuestCommitment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

