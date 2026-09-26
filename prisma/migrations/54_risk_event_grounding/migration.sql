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
-- 🚨 `kbNewestUpdatedAt` SÜRÜM KİMLİĞİ DEĞİLDİR (kurucu düzeltmesi 09-08), yalnız
-- bir TAZELİK İŞARETİDİR: iki bambaşka kalem kümesi aynı max'ı verebilir. "Bu
-- cevap hangi bilgiye dayandı" sorusunu `kbEvidenceJson` yanıtlar: kalem KİMLİĞİ +
-- o andaki SÜRÜM (`updatedAt`) + doğrulanmış kaynak etiketleri. Biçim deponun
-- yerleşik `PropertyMemory.evidenceJson` deyimidir (yalnız kimlik, İÇERİK YOK) —
-- yeni bir izleme mekanizması icat edilmedi. Bu sütun YETKİLİ İÇ DENETİM içindir;
-- misafire dönen QR yanıtına ASLA girmez (davranışsal pin).
--
-- 🚨 HEPSİ NULLABLE VE NULL = "ÖLÇÜLMEDİ", 0 DEĞİL. Mevcut satırlar ve ölçmeyen
-- kod yolları NULL kalır; sıfır yazılsaydı "hiç kalem yoktu" diye okunur ve
-- yanlış bir "bilgi yokluğu" istatistiği üretilirdi.
--
-- PII: sayı, zaman damgası, KALEM KİMLİĞİ ve doğrulanmış kaynak ETİKETİ. Misafir
-- metni / adı / kalem İÇERİĞİ hiçbirinde YOKTUR. Kalem kimliği bir dönem bilinçli
-- olarak dışarıda tutuluyordu ("QR'da hangi kalemin gösterildiğini ima eder"), ama
-- kurucu 09-08'de bunun tersini şart koştu: kullanılan kaynak kümesi ve kalem
-- sürümleri YETKİLİ İÇ DENETİMDE izlenebilmeli. Denge şöyle kuruldu — kimlik
-- yalnız iç karar günlüğünde durur, misafire dönen yanıta hiçbir yoldan açılmaz
-- (davranışsal pin), ve içerik hâlâ taşınmaz.
--
-- İŞLETİM: dolu tabloya eklenen yedi kolonun hepsi nullable, varsayılansız,
-- UNIQUE/FK/index YOK → tablo yeniden yazılmaz. GERİ ALMA: yedi kolonun hepsi
-- DROP edilebilir; okuma yolları kolonsuz eski hâlle aynı sonucu verir (sayılar
-- ve kanıt yalnız teşhis içindir, hiçbir gönderim kararına girmez).

-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN     "kbDropped" INTEGER,
ADD COLUMN     "kbPendingApproval" INTEGER,
ADD COLUMN     "kbRetrieved" INTEGER,
ADD COLUMN     "kbNewestUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "kbEvidenceJson" TEXT,
ADD COLUMN     "srcDeclared" INTEGER,
ADD COLUMN     "srcVerified" INTEGER;
