-- AlterTable
ALTER TABLE "CheckoutConsent" ADD COLUMN     "correlationId" TEXT;

-- CreateTable
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "organizationId" TEXT,
    "event" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "dataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalEvent_correlationId_idx" ON "OperationalEvent"("correlationId");

-- CreateIndex
CREATE INDEX "OperationalEvent_organizationId_createdAt_idx" ON "OperationalEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_createdAt_idx" ON "OperationalEvent"("createdAt");

-- CreateIndex
CREATE INDEX "CheckoutConsent_correlationId_idx" ON "CheckoutConsent"("correlationId");

-- AddForeignKey
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Yalnız-ekle (kurucu kararı 10-10 §5): uygulama satırı GÜNCELLEYEMEZ. Silme serbest (saklama süpürgesi + işletme silinmesinin kademesi).
-- Prisma şeması tetikleyiciyi taşımaz → şema farkına girmez (sıfır sapma doğrulaması etkilenmez).
CREATE FUNCTION "operational_event_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OperationalEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationalEvent_append_only" BEFORE UPDATE ON "OperationalEvent"
  FOR EACH ROW EXECUTE FUNCTION "operational_event_append_only"();
