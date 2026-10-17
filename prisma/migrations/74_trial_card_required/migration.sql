-- Kartla deneme kapisi (kurucu 10-17: "kartla deneme kapisini yap, yuksek riskte oyle bir durum olsun"). Dolu tabloya (Organization)
-- yalniz BOS kolon: acilista patlama yolu yok. Yazici (saatlik is) TRIAL_CARD_GATE_ENABLED arkasinda KAPALI; okuyucu ayrica faturalandirma
-- zorunlulugu ister.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trialCardRequiredAt" TIMESTAMP(3);
