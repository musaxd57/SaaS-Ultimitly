-- Gecmisten ogren (kurucu 10-15): dort YENI tablo; dolu tabloya dokunulmaz. Tasarim docs/TASARIM-2026-10-15-gecmisten-ogren.md
-- CreateTable
CREATE TABLE "HistoryLearnRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "pairCount" INTEGER NOT NULL DEFAULT 0,
    "draftCount" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "failedCalls" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "HistoryLearnRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryLearnDraft" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "supportConversations" INTEGER NOT NULL DEFAULT 0,
    "newestMonth" TEXT,
    "oldestMonth" TEXT,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "conflictNote" TEXT,
    "flagsJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceMessageIdsJson" TEXT NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL DEFAULT 'pending',
    "kbItemId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryLearnDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyInstruction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'host_note',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "PropertyInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryLearnComparison" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "runId" TEXT,
    "questionMessageId" TEXT NOT NULL,
    "hostAnswerMessageIdsJson" TEXT NOT NULL DEFAULT '[]',
    "aiAnswer" TEXT,
    "wouldAutoSend" BOOLEAN,
    "gateDetail" TEXT,
    "model" TEXT,
    "promptId" TEXT,
    "verdict" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoryLearnComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoryLearnRun_organizationId_createdAt_idx" ON "HistoryLearnRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "HistoryLearnRun_propertyId_status_idx" ON "HistoryLearnRun"("propertyId", "status");

-- CreateIndex
CREATE INDEX "HistoryLearnDraft_runId_idx" ON "HistoryLearnDraft"("runId");

-- CreateIndex
CREATE INDEX "HistoryLearnDraft_propertyId_state_idx" ON "HistoryLearnDraft"("propertyId", "state");

-- CreateIndex
CREATE INDEX "PropertyInstruction_propertyId_status_idx" ON "PropertyInstruction"("propertyId", "status");

-- CreateIndex
CREATE INDEX "PropertyInstruction_organizationId_idx" ON "PropertyInstruction"("organizationId");

-- CreateIndex
CREATE INDEX "HistoryLearnComparison_runId_idx" ON "HistoryLearnComparison"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoryLearnComparison_propertyId_questionMessageId_key" ON "HistoryLearnComparison"("propertyId", "questionMessageId");

-- AddForeignKey
ALTER TABLE "HistoryLearnRun" ADD CONSTRAINT "HistoryLearnRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryLearnRun" ADD CONSTRAINT "HistoryLearnRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryLearnDraft" ADD CONSTRAINT "HistoryLearnDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoryLearnRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryLearnDraft" ADD CONSTRAINT "HistoryLearnDraft_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyInstruction" ADD CONSTRAINT "PropertyInstruction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyInstruction" ADD CONSTRAINT "PropertyInstruction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryLearnComparison" ADD CONSTRAINT "HistoryLearnComparison_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

