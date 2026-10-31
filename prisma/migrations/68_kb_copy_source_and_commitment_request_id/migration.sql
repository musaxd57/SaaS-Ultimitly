-- 68: Kurucu D2 + D3 (10-15).
--  D2 "Eski kopyayı güncelle": bilgi tabanı kopyasının KAYNAĞI (copiedFromId) ve kopyalandığı / son güncellendiği andaki içerik izi
--     (copiedContentHash). Yeniden kopyalamada yalnız bu kaynaktan geldiği doğrulanmış ve yerelde değiştirilmemiş kopya güncellenir.
--  D3 "İstek kimliği şimdi": misafir sözünün istemci işlem kimliği (clientRequestId) + konuşma başına tekil dizin.
-- Hepsi NULL'lanabilir yeni kolon (varsayılan yok → mevcut satırlar NULL; dolu tabloya zorunlu kolon EKLENMEDİ).
-- Tekil dizinler (konuşma, kimlik) ve (mülk, kopya kaynağı): mevcut satırların HEPSİ NULL ve PostgreSQL'de NULL'lar birbiriyle çakışmaz →
-- açılışta patlamaz. (mülk, kaynak) tekilliği daire başına kaynak başına TEK bağlı kopya garantisidir (Opus O9: eşzamanlı iki kopyalama
-- iki bağlı kopya açıyordu); kolon tamamen boşken eklenir — dolu tabloya sonradan tekil dizin açılışta patlayabilirdi.
-- Tablolar küçük (söz: konuşma başına birkaç; bilgi tabanı: mülk başına plan tavanı) → düz dizin (CONCURRENTLY değil; INVALID dizin riski
-- daha kötü). Geri alma: iki kolon + iki dizin düşürülür (veri kaybı yalnız yeni kolonlarda).

-- AlterTable
ALTER TABLE "GuestCommitment" ADD COLUMN     "clientRequestId" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN     "copiedContentHash" TEXT,
ADD COLUMN     "copiedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GuestCommitment_conversationId_clientRequestId_key" ON "GuestCommitment"("conversationId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBaseItem_propertyId_copiedFromId_key" ON "KnowledgeBaseItem"("propertyId", "copiedFromId");
