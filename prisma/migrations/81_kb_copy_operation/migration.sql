-- Migration 81 (Codex 10-21): bilgi tabanı kopyalama işlem kaydı — işlem başına kalıcı satır (tekrar güvenliği değiştirilebilir alana dayanmasın).
-- Yalnız EKLER: yeni tablo. Geriye doldurma YOK (geçmiş kopyalamalar için kayıt uydurulmaz; kimliksiz / eski istemci bugünkü yolda kalır).

-- CreateTable
CREATE TABLE "KbCopyOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbCopyOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbCopyOperation_createdAt_idx" ON "KbCopyOperation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KbCopyOperation_organizationId_sourceItemId_requestId_key" ON "KbCopyOperation"("organizationId", "sourceItemId", "requestId");

-- AddForeignKey
ALTER TABLE "KbCopyOperation" ADD CONSTRAINT "KbCopyOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
