-- I1 (kurucu 10-17 "A"): soze kisa KONU (kapali kume kod; ac, faucet, shampoo ...). Dolu tabloya BOS kolon - guvenli; geriye doldurma yok
-- (eski satirin konusu bilinmiyor = NULL). Yalniz oneri yolu yazar; anahtar AI_ACTION_SUGGESTIONS_ENABLED KAPALI.
-- AlterTable
ALTER TABLE "GuestCommitment" ADD COLUMN     "topic" TEXT;

