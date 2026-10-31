-- Migration 77 (gece-4 S8-01 / S8-05, ölçüm `scratchpad` S8): YALNIZ dizin.
--  · Yabancı anahtar kolonları (Conversation.reservationId, Signal.conversationId / reservationId, SupplyRequest.reservationId) dizinsizdi →
--    rezervasyon / konuşma silinince FK eylemi (SET NULL) her silinen satır için alt tabloyu baştan sona tarıyordu: 20 bin mesajlık bir
--    kurumun silinmesi 15,6 sn → dizinle 89 ms; tek mülk 1,1 sn → 11 ms. Saklama süpürgesi ve dikkat sorguları da dizin kullanır.
--  · AuditLog yalnız (organizationId) dizinliydi: öneri kararları (kurum + eylem + zaman) ve operatör sayfası (en son kayıtlar) tam tarama.
-- Tablolar küçük (prod Railway kapalı; açılışta en büyüğü birkaç on bin satır) → düz CREATE INDEX (CONCURRENTLY işlem içinde çalışmaz;
-- yarım kalırsa INVALID dizin riski daha kötü — CLAUDE.md kuralı). Geri alma: dizinleri düşürmek (veri kaybı yok).

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_reservationId_idx" ON "Conversation"("reservationId");

-- CreateIndex
CREATE INDEX "Signal_conversationId_idx" ON "Signal"("conversationId");

-- CreateIndex
CREATE INDEX "Signal_reservationId_idx" ON "Signal"("reservationId");

-- CreateIndex
CREATE INDEX "SupplyRequest_reservationId_idx" ON "SupplyRequest"("reservationId");

