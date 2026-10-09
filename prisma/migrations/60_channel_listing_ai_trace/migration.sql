-- Migration 60 (kurucu onayı 10-09: "tamamını hazırla"; tasarım `docs/TASARIM-2026-10-09-migration-paketi-60.md`).
-- YALNIZ EKLEME: dolu tablolara (ChannelConnection, Reservation) nullable sütun; üç YENİ tablo + adlı indeksler + bağlantılar.
-- Dolu tabloya tekil kısıt / zorunlu sütun / silme YOK. Geri alma: sütunlar / tablolar kullanılmaz kalır (yazıcılar anahtar arkasında).
--   · ChannelListing: bağlantı kapsamlı ilan kimliği (değişmez 3) — `Property.hospitableId` geçiş boyunca durur.
--   · Reservation.sourcePlatform: sağlayıcının ham platform dizesi (değişmez 2) — yalnız gösterim / teşhis.
--   · ChannelConnection.lastRead*: sağlayıcıdan bağımsız bağlantı sağlığı (değişmez 9).
--   · AiGeneration + AiReviewLabel: üretim izi + kurucu kalite konsolu etiketi (talimat 09-07; §D-1: metin Message ile aynı saklamada).
-- 🚨 Push = taze `pg_dump` + kurucunun AÇIK "push et" onayı (CLAUDE.md).

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "lastReadErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastReadErrorKind" TEXT,
ADD COLUMN     "lastReadOkAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "sourcePlatform" TEXT;

-- CreateTable
CREATE TABLE "ChannelListing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "propertyId" TEXT,
    "reservationId" TEXT,
    "triggerMessageId" TEXT,
    "surface" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "retrievalVersion" TEXT,
    "toolContractVersion" INTEGER,
    "kbEvidenceJson" TEXT,
    "toolResultsJson" TEXT,
    "decision" TEXT NOT NULL,
    "gateReason" TEXT,
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "costMicroUsd" INTEGER,
    "draftText" TEXT,
    "sentText" TEXT,
    "contextDiagnosticsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReviewLabel" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReviewLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelListing_propertyId_idx" ON "ChannelListing"("propertyId");

-- CreateIndex
CREATE INDEX "ChannelListing_organizationId_idx" ON "ChannelListing"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelListing_connectionId_externalId_key" ON "ChannelListing"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "AiGeneration_organizationId_createdAt_idx" ON "AiGeneration"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_conversationId_idx" ON "AiGeneration"("conversationId");

-- CreateIndex
CREATE INDEX "AiReviewLabel_generationId_idx" ON "AiReviewLabel"("generationId");

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReviewLabel" ADD CONSTRAINT "AiReviewLabel_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "AiGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

