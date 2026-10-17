-- Sync skip-check cursor: outbound-immune provider timestamp of the last import.
-- Nullable → safe on a populated table (null = "never synced" → import, never skip).
ALTER TABLE "Conversation" ADD COLUMN "syncCursorAt" TIMESTAMP(3);
