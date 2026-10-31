-- L5 (kurucu 10-17): kanalin bildirdigi gonderen rolu (guest / host / automation / unknown). Dolu ve buyuk tabloya BOS kolon:
-- PostgreSQL 11+ yalniz meta-veri degisikligi, tablo yeniden yazilmaz, dizin yok. Geriye doldurma YOK (NULL = bugunku davranis).
ALTER TABLE "Message" ADD COLUMN "channelSenderRole" TEXT;
