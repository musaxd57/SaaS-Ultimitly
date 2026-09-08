-- Migration 54 — TEMELLENDİRME İZLENEBİLİRLİĞİ (A2, 09-08).
--
-- Neden: bugün bir cevabın neye dayandığını ölçüyoruz ama SAKLAMIYORUZ. Canlıda
-- "AI bilmiyorum dedi / insana devretti" görüldüğünde üç bambaşka sebebi
-- ayırmanın hiçbir yolu yok:
--   · mülkte o konuda HİÇ kalem yok            → bilgi yokluğu (host'a öneri)
--   · kalem VAR ama modele ulaşmadı/kullanılmadı → temellendirme başarısızlığı
--     (yeni kalem eklemek YANLIŞ cevaptır)
--   · kalem VAR ama onay bekliyor (A1 `draft`)   → onay eksiği, bilgi eksiği DEĞİL
--   · kalem adet tavanından düştü                → kapasite sorunu, ayrı kova
--
-- 🚨 `usedSources` TEK BAŞINA BU AYRIMI YAPMAZ (kurucu düzeltmesi 09-08): o
-- MODELİN BEYANIDIR. Modele hiç kalem verilmemiş de olabilir, verilmiş ama model
-- beyan etmemiş de. İkisi de aynı boş listeyi üretir. Ayrımı ancak KODUN bildiği
-- "ne getirildi" ile modelin beyan ettiği "ne kullandım" YAN YANA durursa
-- yapabiliriz — bu migration tam olarak o iki tarafı kaydeder.
--
-- `srcDeclared` ↔ `srcVerified` farkı ayrıca UYDURMA ATIF sinyalidir:
-- `verifyUsedSources` gerçekte var olmayan atıfları zaten sessizce düşürüyordu;
-- düşen sayı bugüne kadar hiçbir yere yazılmıyordu.
--
-- 🚨 HEPSİ NULLABLE VE NULL = "ÖLÇÜLMEDİ", 0 DEĞİL. Mevcut satırlar ve ölçmeyen
-- kod yolları NULL kalır; sıfır yazılsaydı "hiç kalem yoktu" diye okunur ve
-- yanlış bir "bilgi yokluğu" istatistiği üretilirdi.
--
-- PII: yalnız SAYI ve zaman damgası. Kalem KİMLİĞİ bilinçli olarak DIŞARIDA —
-- QR yüzeyinde hangi kalemin misafire gösterildiğini ima edebilirdi (RiskEvent'in
-- "kapalı küme / PII yok" sözleşmesi).
--
-- İŞLETİM: dolu tabloya eklenen altı kolonun hepsi nullable, varsayılansız,
-- UNIQUE/FK/index YOK → tablo yeniden yazılmaz. GERİ ALMA: altısı da DROP
-- edilebilir; okuma yolları kolonsuz eski hâlle aynı sonucu verir (sayılar
-- yalnız teşhis içindir, hiçbir gönderim kararına girmez).

-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN     "kbDropped" INTEGER,
ADD COLUMN     "kbPendingApproval" INTEGER,
ADD COLUMN     "kbRetrieved" INTEGER,
ADD COLUMN     "kbVersionAt" TIMESTAMP(3),
ADD COLUMN     "srcDeclared" INTEGER,
ADD COLUMN     "srcVerified" INTEGER;
