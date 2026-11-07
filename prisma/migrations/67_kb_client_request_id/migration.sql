-- 67: Bilgi tabanı içe aktarım tekrar güvenliği (kurucu 10-14 "İstek kimliği").
-- Yeni NULL'lanabilir kolon (varsayılan yok → mevcut satırlar NULL; dolu tabloya zorunlu kolon EKLENMEDİ).
-- Benzersiz dizin (mülk, kimlik): mevcut satırların HEPSİ NULL ve PostgreSQL'de NULL'lar birbiriyle çakışmaz → açılışta patlamaz.
-- Tablo küçük (canlıda yüzlerce satır: mülk başına plan tavanı 60 AKTİF kalem; pasif kalemler sayılmaz ama azdır) → düz dizin.
-- Dizin kurulurken KB yazmaları kısa süre bekler, okuma etkilenmez; CONCURRENTLY değil (INVALID dizin riski daha kötü).

-- AlterTable
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBaseItem_propertyId_clientRequestId_key" ON "KnowledgeBaseItem"("propertyId", "clientRequestId");
