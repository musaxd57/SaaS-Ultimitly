-- Gecmisten ogren (Opus 10-15 HL4 F4): serbest talimati operator mu yazdi. Yeni kolon, varsayilanli (dolu tabloda da guvenli). 65 itildikten sonra ayri migration.
-- AlterTable
ALTER TABLE "PropertyInstruction" ADD COLUMN     "byOperator" BOOLEAN NOT NULL DEFAULT false;

