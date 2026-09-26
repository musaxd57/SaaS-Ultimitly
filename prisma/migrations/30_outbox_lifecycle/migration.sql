-- AlterTable
ALTER TABLE "MessageOutbox" ADD COLUMN     "messageType" TEXT,
ALTER COLUMN "conversationId" DROP NOT NULL;

