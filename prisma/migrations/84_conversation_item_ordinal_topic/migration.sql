-- Migration 84 (kurucu 10-23 D, "evet, kanıtıyla"; tasarım docs/TASARIM-2026-10-23-ihtiyac-defteri.md §17).
-- Yalnız ekleme + tekillik GENİŞLETME: eski üçlü (konuşma, mesaj, tür) zaten tekildi → dörtlü (+ ordinal) de tekil; her eski satır
-- ordinal = 0 alır. Satır silinmez, durum / notifiedAt / answeredByMessageId değişmez; mesaj gönderilmez, öğe kapanmaz (yalnız DDL).
-- Tablo küçük (mesaj başına birkaç satır) → düz indeks (CONCURRENTLY gerekmez; yarım kalan INVALID indeks riski daha kötü).

-- DropIndex
DROP INDEX "ConversationItem_conversationId_messageId_kind_key";

-- AlterTable
ALTER TABLE "ConversationItem" ADD COLUMN     "ordinal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topic" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ConversationItem_conversationId_messageId_kind_ordinal_key" ON "ConversationItem"("conversationId", "messageId", "kind", "ordinal");
