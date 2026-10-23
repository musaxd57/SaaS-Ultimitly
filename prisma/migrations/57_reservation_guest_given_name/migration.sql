-- Migration 57 (K10-o, kurucu kararı 09-28): misafirin kanaldan gelen AYRI hitap adı + `guestName`in kaynağı.
-- İki boş olabilir sütun: varsayılan YOK, tekil kısıt YOK, index YOK, geriye dönük doldurma YOK → dolu tabloda güvenli
-- (PostgreSQL'de varsayılansız NULL sütun eklemek yalnız katalog değişikliğidir, tablo yeniden yazılmaz).

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "guestGivenName" TEXT,
ADD COLUMN     "guestNameSource" TEXT;
