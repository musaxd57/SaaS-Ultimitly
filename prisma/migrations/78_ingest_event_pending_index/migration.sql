-- Migration 78 (gece-4 S8-04, `docs/arastirma-2026-10-18/S8-performans.md`): YALNIZ dizin.
--  · Zekâ tüketicisi her 2 dakikada "işlenmemiş olaylar, en eskiden" okur (`dispatchedAt IS NULL`, kurum, `occurredAt` sırası, 500 satır).
--    Mevcut (organizationId, occurredAt) dizini bekleyenleri ayıramadığı için sorgu kurumun BÜTÜN işlenmiş geçmişini gezip eliyordu
--    (ölçüm: 20 bin olayda 19.980 satır elendi); IngestEvent hiç silinmediği için maliyet zamanla sınırsız büyür.
--  · Prisma'nın kendi dizini (kısmi dizin değil): `migrate diff` sapmasız, test veritabanında da aynı dizin. Btree `IS NULL`u dizin koşulu
--    olarak kullanır. Sorgu ve davranış değişmez.
-- Tablo küçük (prod Railway kapalı) → düz CREATE INDEX (CONCURRENTLY işlem içinde çalışmaz; yarım kalırsa INVALID dizin riski daha kötü —
-- CLAUDE.md kuralı). Geri alma: dizini düşürmek (veri kaybı yok).

-- CreateIndex
CREATE INDEX "IngestEvent_organizationId_dispatchedAt_occurredAt_idx" ON "IngestEvent"("organizationId", "dispatchedAt", "occurredAt");
