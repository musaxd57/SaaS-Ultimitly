-- Migration 75 (kurucu 10-17 gece): ev sahibinin mesajındaki söz ONAYSIZ görev olur; saat UYDURULMAZ (açık saat · gün dilimi · yalnız gün);
-- bağlamla saat güncelleme izi; konaklama bitince kapanış sebebi; işletme ayarı (varsayılan AÇIK). Yalnız ekleme: nullable kolonlar +
-- varsayılanlı boolean (PG 11+ meta veri) + küçük tabloda düz dizin. Geri alma: kolonları düşürmek (veri kaybı yalnız bu yeni alanlar).

-- AlterTable
ALTER TABLE "GuestCommitment" ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "dayPart" TEXT,
ADD COLUMN     "duePrecision" TEXT,
ADD COLUMN     "previousDueAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoCommitmentsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "GuestCommitment_organizationId_createdAt_idx" ON "GuestCommitment"("organizationId", "createdAt");
