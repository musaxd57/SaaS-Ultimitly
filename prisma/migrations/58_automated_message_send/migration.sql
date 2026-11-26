-- Migration 58 (K7, kurucu onayı 09-30): GÖNDERDİĞİMİZ otomatik şablon mesajının izi (karşılama / giriş / çıkış).
-- Senkron aynı mesajı geri getirince "ev sahibi yazdı" sayılmasın diye (`Message.authorType = "automation"`).
-- YALNIZ YENİ TABLO + iki dizin + organizasyon bağlantısı: dolu tabloya sütun / tekil kısıt / silme YOK. Metin saklanmaz
-- (yalnız gövde özeti); satır 14 gün sonra silinir.

-- CreateTable
CREATE TABLE "AutomatedMessageSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "externalReservationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "matchedExternalId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomatedMessageSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomatedMessageSend_organizationId_propertyId_externalRese_idx" ON "AutomatedMessageSend"("organizationId", "propertyId", "externalReservationId");

-- CreateIndex
CREATE INDEX "AutomatedMessageSend_sentAt_idx" ON "AutomatedMessageSend"("sentAt");

-- AddForeignKey
ALTER TABLE "AutomatedMessageSend" ADD CONSTRAINT "AutomatedMessageSend_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

