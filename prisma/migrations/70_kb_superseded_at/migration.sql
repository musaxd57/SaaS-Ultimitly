-- L2 (kurucu 10-17): bilgi tabanı kaleminin yerine yenisi konduğu an. Dolu tabloya BOŞ kolon (varsayılansız, NULL'lanabilir) — güvenli.
-- AlterTable
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN     "supersededAt" TIMESTAMP(3);
