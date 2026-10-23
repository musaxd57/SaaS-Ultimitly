-- Migration 85 (kurucu fikri 10-23 gece: doğrulanmış cevap tekrarı; tasarım docs/TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md).
-- YALNIZ yeni tablo: mevcut hiçbir satır değişmez, veri taşınmaz, mesaj gönderilmez. Tablo yalnız gölge kipte
-- (AI_ANSWER_REUSE_SHADOW_ENABLED) yazılır; misafire bu tablodan hiçbir şey GİTMEZ. Mülk / işletme silinince Cascade.

-- CreateTable
CREATE TABLE "VerifiedAnswer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "partText" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "conversationKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shadowHits" INTEGER NOT NULL DEFAULT 0,
    "shadowMismatches" INTEGER NOT NULL DEFAULT 0,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL,
    "lastHitAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerifiedAnswer_propertyId_kind_language_idx" ON "VerifiedAnswer"("propertyId", "kind", "language");

-- CreateIndex
CREATE INDEX "VerifiedAnswer_organizationId_idx" ON "VerifiedAnswer"("organizationId");

-- AddForeignKey
ALTER TABLE "VerifiedAnswer" ADD CONSTRAINT "VerifiedAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedAnswer" ADD CONSTRAINT "VerifiedAnswer_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

