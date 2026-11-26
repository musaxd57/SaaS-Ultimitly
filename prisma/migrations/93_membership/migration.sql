-- M-2 ÜYELİK — dilim 1 (kurucu / Codex 11-06 K-2; tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §6.1).
-- Tek kullanıcı, işletme BAŞINA üyelik. Bu migration yalnız TABLO + DOLDURMA ekler; okuyucu yok, davranış değişmez.
-- Dolu tabloya zorunlu sütun / tekil dizin / sütun düşürme YOK: "User"a yalnız isteğe bağlı "lastActiveOrganizationId".
-- "singleMembershipGuard" = GEÇİCİ tek-üyelik bekçisi (her satırda userId; tekil dizin) — dilim 6c'de boşaltılır.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastActiveOrganizationId" TEXT;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL,
    "invitedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "singleMembershipGuard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_singleMembershipGuard_key" ON "Membership"("singleMembershipGuard");

-- CreateIndex
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Membership_invitedById_idx" ON "Membership"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "User_lastActiveOrganizationId_idx" ON "User"("lastActiveOrganizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lastActiveOrganizationId_fkey" FOREIGN KEY ("lastActiveOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Doldurma: her kullanıcıya ANA işletmesindeki üyelik, rolü aynen (Opus M10).
--  · Kimlik BELİRLENİMLİ ('mem_' || md5) — ortamlar arasında aynı, tekrar koşulabilir (ON CONFLICT DO NOTHING).
--  · "createdAt" = kullanıcının oluşturulma anı ("en eski sahip" sıralaması bugünküyle aynı kalsın).
--  · "updatedAt" açıkça yazılır (NOT NULL, varsayılansız — yazılmasa dolu veritabanında açılış düşerdi).
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "status", "epoch", "origin", "singleMembershipGuard", "createdAt", "updatedAt")
SELECT 'mem_' || md5(u."id" || ':' || u."organizationId"), u."id", u."organizationId", u."role", 'active', 0, 'backfill', u."id", u."createdAt", CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT DO NOTHING;
