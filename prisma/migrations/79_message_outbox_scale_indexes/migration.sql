-- Migration 79 (gece-4 S3-07 / S3-09, `docs/arastirma-2026-10-18/S8-performans.md`): YALNIZ dizin, kalıcı misafir mesajı kuyruğu.
--  · İşçinin talep sorgusu her aday için "aynı rezervasyonun son 60 sn denemesi" sayar; (organizationId, status) dizini işletmenin BÜTÜN
--    satırlarını gezdiriyordu (sert tasarım ajanı ölçtü, geçici PG16, 2M satır, 20 bin birikim: 7,65 sn). claimedAt dizini son 60 saniyenin
--    taleplerini doğrudan bulur; ajanın önerdiği üç sütunlu (org, rezervasyon, claimedAt) dizin bu dizin varken planlayıcıca seçilmedi → eklenmedi.
--  · Kuyruk sağlığının "son 15 dk ilerleme var mı" okuması (claimedAt OR sentAt; her senkron geçişi + sıkı sağlık yoklaması) tam tablo
--    tarıyordu (~1 sn) → iki düz dizinle BitmapOr (0,03 ms). Teslim etkisi onarıcısı son 48 saatin gönderilmişlerini de sentAt'ten bulur.
--  · Gönderilmiş satırlar silinmez → maliyet zamanla büyür; dizinler katsayıyı düşürür. Sorgu ve davranış değişmez.
-- Adlar Prisma'nın ürettiği adlar: `migrate diff` sapmasız. Kuyruk anahtarı canlıda KAPALI (tablo boş) → düz CREATE INDEX.
-- Geri alma: dizinleri düşürmek (veri kaybı yok).

-- CreateIndex
CREATE INDEX "MessageOutbox_sentAt_idx" ON "MessageOutbox"("sentAt");

-- CreateIndex
CREATE INDEX "MessageOutbox_claimedAt_idx" ON "MessageOutbox"("claimedAt");
