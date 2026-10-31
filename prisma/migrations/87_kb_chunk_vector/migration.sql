-- Migration 87 (kurucu onayı 10-23 "Bilgi tabanı iki yeni tablo ana dala", 10-28 "tamamdır … en uzun vadeli en iyi olacak şekilde"):
-- bilgi tabanı parçalarının anlam vektörleri için KALICI depo. Yalnız YENİ tablo + yeni tablodaki tekil dizin + kaleme yabancı anahtar
-- (cascade) — dolu tabloya dokunulmaz, açılış güvenli. Metin saklanmaz. Anahtar KB_VECTOR_STORE_ENABLED kapalıyken tablo boş kalır.
-- CreateTable
CREATE TABLE "KbChunkVector" (
    "id" TEXT NOT NULL,
    "kbItemId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recipe" TEXT NOT NULL DEFAULT 'c1',
    "kind" TEXT NOT NULL DEFAULT 'chunk',
    "inputHash" TEXT NOT NULL,
    "ord" INTEGER NOT NULL DEFAULT 0,
    "dims" INTEGER NOT NULL,
    "vector" BYTEA NOT NULL,
    "itemUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbChunkVector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbChunkVector_kbItemId_model_recipe_kind_inputHash_ord_key" ON "KbChunkVector"("kbItemId", "model", "recipe", "kind", "inputHash", "ord");

-- AddForeignKey
ALTER TABLE "KbChunkVector" ADD CONSTRAINT "KbChunkVector_kbItemId_fkey" FOREIGN KEY ("kbItemId") REFERENCES "KnowledgeBaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

