-- Kurucu I3 (10-17, "migration yapalım"): konuşma başına kuyruk okuması dizinden (yalnız maliyet; davranış değişmez).
-- Kuyruk tablosu küçük (Railway kapalı, canlıda satır yok) → düz dizin (CONCURRENTLY gerekmez; INVALID dizin riski daha kötü).
-- CreateIndex
CREATE INDEX "MessageOutbox_conversationId_status_idx" ON "MessageOutbox"("conversationId", "status");
