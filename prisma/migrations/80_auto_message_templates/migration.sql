-- Migration 80 (kurucu T4, 10-21): daire başına otomatik mesaj metni (karşılama · giriş · çıkış) bilgi tabanından AYRI tabloya.
-- Kurucu kararı (aynen özet): geçişte bugün GERÇEKTEN seçilecek metinler aynen taşınsın; geçiş kendi başına mesaj göndermesin, önceki
-- gönderim kayıtları korunsun; bilgi tabanı ekleme / düzenleme ve öğrenilen taslağı onaylama otomatik mesajlara dokunmasın.
-- Yalnız EKLER: yeni tablo + MessageOutbox'a NULL'lanabilir kolon (dolu tabloya zorunlu kolon / benzersizlik / silme YOK).

-- AlterTable
ALTER TABLE "MessageOutbox" ADD COLUMN     "templateRevision" INTEGER;

-- CreateTable
CREATE TABLE "AutoMessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "migratedFromKbItemId" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "lastSkipReason" TEXT,
    "lastSkippedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoMessageTemplate_organizationId_idx" ON "AutoMessageTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoMessageTemplate_propertyId_kind_key" ON "AutoMessageTemplate"("propertyId", "kind");

-- AddForeignKey
ALTER TABLE "AutoMessageTemplate" ADD CONSTRAINT "AutoMessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoMessageTemplate" ADD CONSTRAINT "AutoMessageTemplate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Veri taşıma: göndericinin bugünkü seçimi = (mülk, kategori) başına `isActive` + `reviewState IN ('legacy','approved')` kalemler içinden EN SON
-- `updatedAt` (Prisma `findFirst … orderBy updatedAt desc`). Eşit `updatedAt`te bugünkü sıra KEYFİDİR → burada `id DESC` seçilir ve içerikleri
-- FARKLI eşit adaylar varsa satır `needsReview` işaretlenir (kart ev sahibine "kontrol edin" der; gönderim sürer — bugünkü gibi bir metin gider).
-- Gövde = kalemin `content`i AYNEN (kırpma / ikame gönderim anında, bugünkü gibi). `updatedAt` açıkça yazılır (`@updatedAt`in DB varsayılanı yok).
INSERT INTO "AutoMessageTemplate" ("id", "organizationId", "propertyId", "kind", "body", "revision", "migratedFromKbItemId", "needsReview", "createdAt", "updatedAt")
SELECT
    'amt_' || md5(k."id" || ':' || k."category"),
    p."organizationId",
    k."propertyId",
    k."category",
    k."content",
    1,
    k."id",
    EXISTS (
        SELECT 1 FROM "KnowledgeBaseItem" k2
        WHERE k2."propertyId" = k."propertyId"
          AND k2."category" = k."category"
          AND k2."isActive" = true
          AND k2."reviewState" IN ('legacy', 'approved')
          AND k2."updatedAt" = k."updatedAt"
          AND k2."id" <> k."id"
          AND k2."content" <> k."content"
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON ("propertyId", "category") *
    FROM "KnowledgeBaseItem"
    WHERE "category" IN ('welcome', 'checkin', 'checkout')
      AND "isActive" = true
      AND "reviewState" IN ('legacy', 'approved')
    ORDER BY "propertyId", "category", "updatedAt" DESC, "id" DESC
) k
JOIN "Property" p ON p."id" = k."propertyId";
