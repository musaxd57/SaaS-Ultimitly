-- Migration 99 (kurucu onayı 11-18 akşam: "migrationları yapabilirsin") — yalnız iki YENİ tablo; var olan tabloya kolon / tekil / silme YOK.
--  · InternalNote: ekibin kendi notu (telefon görüşmesi, kapıda söylenen, hatırlatma). Misafire gitmez, mesaj değildir. Konaklamaya bağlanır,
--    konaklama yoksa daireye; conversationId yalnız bağlamdır (konuşma silinince boşalır). Metin misafir verisi sayılır (saklama süresi /
--    silme talebi / dışa aktarma kapsamında). İstek kimliği işletme kapsamında tekil (NULL çakışmaz): çift tıklama ikinci not yazmaz.
--  · SemanticReading: anlam okumasının GÖLGE kaydı — bir mesajı modelin nasıl okuduğu, kodun doğrulaması ve bugünkü kuralın kararıyla kıyas
--    (mesaj + katman başına tek satır). Davranışı değiştirmez. Alıntı metni saklanmaz; modelin kısa nedeni mesajı yeniden anlatabileceği
--    için satır konuşmayla birlikte silinir.
-- NOT: klasörler ad sırasıyla uygulanır; 99'dan sonraki migration `99a_…` biçiminde adlandırılır (`100_` ASLA — docs/MIGRATION-MANIFEST.md).

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "conversationId" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "lexicalDecision" TEXT,
    "modelDecision" TEXT,
    "agreement" TEXT,
    "detailJson" TEXT,
    "model" TEXT,
    "promptId" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalNote_organizationId_propertyId_createdAt_idx" ON "InternalNote"("organizationId", "propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalNote_reservationId_createdAt_idx" ON "InternalNote"("reservationId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalNote_conversationId_idx" ON "InternalNote"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalNote_organizationId_clientRequestId_key" ON "InternalNote"("organizationId", "clientRequestId");

-- CreateIndex
CREATE INDEX "SemanticReading_organizationId_layer_createdAt_idx" ON "SemanticReading"("organizationId", "layer", "createdAt");

-- CreateIndex
CREATE INDEX "SemanticReading_conversationId_idx" ON "SemanticReading"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticReading_messageId_layer_key" ON "SemanticReading"("messageId", "layer");

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticReading" ADD CONSTRAINT "SemanticReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticReading" ADD CONSTRAINT "SemanticReading_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

