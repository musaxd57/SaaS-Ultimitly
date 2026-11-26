-- Migration 98 (kurucu onayı 11-18 akşam: "migrationları yapabilirsin") — yalnız EKLEME: boş bırakılabilir sütunlar + iki index.
-- Var olan satırlara dokunmaz; hiçbir sütun zorunlu-varsayılansız değil, hiçbir benzersizlik / silme yok.
--  · WebhookEvent: yeniden işleme vadesi olayın kendi satırında (attemptCount, lastAttemptAt, nextAttemptAt).
--  · MessageOutbox: "dış gönderim başladı" işareti + iptal isteği (iptal ile gönderimi başlatma aynı satırda atomik) + karar kartı bağı.
--  · CheckoutIntent: ödeme–abonelik bağı (subscriptionRef).
--  · Message: giden mesajın gerçek teslim yolu (deliveryPath).
--  · Task: vade hassasiyeti (dueAtPrecision).

-- AlterTable
ALTER TABLE "CheckoutIntent" ADD COLUMN     "subscriptionRef" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveryPath" TEXT;

-- AlterTable
ALTER TABLE "MessageOutbox" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "decisionRequestId" TEXT,
ADD COLUMN     "dispatchStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueAtPrecision" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CheckoutIntent_subscriptionRef_idx" ON "CheckoutIntent"("subscriptionRef");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_nextAttemptAt_idx" ON "WebhookEvent"("provider", "nextAttemptAt");

