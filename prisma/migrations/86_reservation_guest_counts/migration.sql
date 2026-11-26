-- Migration 86 (kurucu onayı 10-23 akşam): rezervasyondaki kişi / evcil hayvan sayıları. Yalnız NULL'a izin veren yeni sütunlar —
-- eski satırlara dokunulmaz, varsayılan yok (NULL = bilinmiyor).
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "guestAdults" INTEGER,
ADD COLUMN     "guestChildren" INTEGER,
ADD COLUMN     "guestInfants" INTEGER,
ADD COLUMN     "guestPets" INTEGER;
