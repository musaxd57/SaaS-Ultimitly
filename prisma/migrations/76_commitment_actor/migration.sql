-- Migration 76 (gece-4, Opus F4/F5 + sert itirazcı K1): sözü YAPAN (visit · delivery · NULL) kalıcı yazılır — aynı andaki başka yapanın
-- sözüne birleşme kilit içinde engellenir; bağlam eşleşmesi kaynak mesajı yeniden okuyup sırasına güvenmez. Yalnız ekleme: nullable kolon
-- (PG 11+ meta veri, dolu tabloda güvenli). Geri alma: kolonu düşürmek (veri kaybı yalnız bu alan).

-- AlterTable
ALTER TABLE "GuestCommitment" ADD COLUMN     "actor" TEXT;
