-- CreateTable
CREATE TABLE "ShadowVerdict" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "triggerId" TEXT NOT NULL,
    "gateDecision" TEXT NOT NULL,
    "gateRiskLevel" TEXT,
    "gateRiskType" TEXT,
    "verdict" TEXT,
    "riskType" TEXT,
    "confidence" DOUBLE PRECISION,
    "agrees" BOOLEAN,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShadowVerdict_createdAt_idx" ON "ShadowVerdict"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowVerdict_organizationId_triggerId_key" ON "ShadowVerdict"("organizationId", "triggerId");

-- AddForeignKey
ALTER TABLE "ShadowVerdict" ADD CONSTRAINT "ShadowVerdict_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

