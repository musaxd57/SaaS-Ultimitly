-- Migration 59 (Host Karar Motoru, Faz 1; kurucu 10-02 akşam: "panelde 'karar bekliyor' kartı ve Onayla / Reddet düğmeleri").
-- Misafirin ev sahibi KARARI gerektiren konaklama isteği (erken giriş / geç çıkış / uzatma / tarih değişikliği) için kart kaydı.
-- YALNIZ YENİ TABLO + iki dizin + bir tekil dizin (boş tabloda) + iki bağlantı: dolu tabloya sütun / tekil kısıt / silme YOK.
-- Metin saklanmaz (misafir metni / adı yok): kimlik + kapalı küme kodlar + saat / gün. Konuşma ya da organizasyon silinince silinir.

-- CreateTable
CREATE TABLE "DecisionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "itemId" TEXT,
    "reservationId" TEXT,
    "kind" TEXT NOT NULL,
    "requestedTime" TEXT,
    "dayKey" TEXT,
    "lang" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,
    "decidedTime" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resultMessageId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionRequest_organizationId_status_idx" ON "DecisionRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DecisionRequest_conversationId_status_idx" ON "DecisionRequest"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRequest_conversationId_messageId_kind_key" ON "DecisionRequest"("conversationId", "messageId", "kind");

-- AddForeignKey
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

